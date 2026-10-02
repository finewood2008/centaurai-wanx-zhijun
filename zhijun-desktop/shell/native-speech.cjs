const childProcess = require("node:child_process");
const fileSystem = require("node:fs/promises");
const fileSystemSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60;

function speechError(code, message) {
  return Object.assign(new Error(message), { code, nativeSpeechError: true });
}

// Accept only the canonical format produced by recordedBlobToWav. The renderer
// cannot choose a path, command, recognizer locale, or remote provider.
function validateAudio(audio) {
  if (!(audio instanceof Uint8Array) || audio.byteLength > MAX_AUDIO_BYTES)
    throw speechError("INVALID_AUDIO", "录音格式或大小不符合要求。");
  const data = Buffer.from(audio);
  if (
    data.length < 46 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE" ||
    data.toString("ascii", 12, 16) !== "fmt " ||
    data.toString("ascii", 36, 40) !== "data" ||
    data.readUInt32LE(4) !== data.length - 8 ||
    data.readUInt32LE(16) !== 16 ||
    data.readUInt16LE(20) !== 1 ||
    data.readUInt16LE(22) !== 1 ||
    data.readUInt32LE(24) !== 16000 ||
    data.readUInt32LE(28) !== 32000 ||
    data.readUInt16LE(32) !== 2 ||
    data.readUInt16LE(34) !== 16 ||
    data.readUInt32LE(40) !== data.length - 44 ||
    (data.length - 44) % 2 !== 0
  )
    throw speechError("INVALID_AUDIO", "请使用 16kHz 单声道 WAV 录音。");
  if ((data.length - 44) / 32000 > MAX_AUDIO_SECONDS)
    throw speechError("AUDIO_TOO_LONG", "单次录音不能超过 60 秒。");
  return data;
}

function createNativeSpeech({
  helperPath,
  platform = process.platform,
  spawn = childProcess.spawn,
  fs = fileSystem,
  tmpRoot = os.tmpdir(),
  timeoutMs = 60_000,
}) {
  const requests = new Map();
  const children = new Set();
  let disposed = false;

  function run(args, operation, limit = timeoutMs) {
    if (disposed || operation?.cancelled)
      return Promise.reject(speechError("CANCELLED", "已取消语音转写。"));
    return new Promise((resolve, reject) => {
      let child,
        timer,
        output = "",
        settled = false;
      const entry = { child: null, fail: null };
      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        children.delete(entry);
        if (operation) operation.fail = null;
        if (error) reject(error);
        else resolve(value);
      }
      entry.fail = (error) => {
        child?.kill("SIGKILL");
        finish(error);
      };
      try {
        child = spawn(helperPath, args, {
          shell: false,
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        });
        entry.child = child;
        children.add(entry);
        if (operation) operation.fail = entry.fail;
      } catch {
        finish(speechError("HELPER_UNAVAILABLE", "本机语音助手未能启动。"));
        return;
      }
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 65_536)
          entry.fail(
            speechError("INVALID_RESPONSE", "语音助手返回的结果过大。"),
          );
      });
      child.on("error", () => {
        finish(speechError("HELPER_UNAVAILABLE", "本机语音助手未能启动。"));
      });
      child.on("close", (code) => {
        if (settled) return;
        let result;
        try {
          result = JSON.parse(output);
        } catch {
          finish(
            speechError("INVALID_RESPONSE", "本机语音助手未能返回有效结果。"),
          );
          return;
        }
        if (code !== 0 || result.ok !== true) {
          finish(
            speechError(
              result.code || "RECOGNITION_FAILED",
              result.message || "本机语音转写失败，请重试。",
            ),
          );
          return;
        }
        finish(null, result);
      });
      timer = setTimeout(() => {
        entry.fail(
          speechError("TIMEOUT", "本机语音转写超时，请缩短录音后重试。"),
        );
      }, limit);
    });
  }

  async function status(command) {
    const base = {
      backend: "macos_speech",
      locale: "zh-CN",
      available: false,
      supportsOnDeviceRecognition: false,
      authorizationStatus: "not_determined",
    };
    if (platform !== "darwin")
      return {
        ...base,
        reason: "UNSUPPORTED_PLATFORM",
        message: "本机语音识别当前仅支持 macOS。",
      };
    try {
      const result = await run(
        [command],
        null,
        command === "capability" ? 10_000 : timeoutMs,
      );
      if (
        result.locale !== "zh-CN" ||
        typeof result.available !== "boolean" ||
        typeof result.supportsOnDeviceRecognition !== "boolean" ||
        !["not_determined", "denied", "restricted", "authorized"].includes(
          result.authorizationStatus,
        )
      )
        throw speechError("INVALID_RESPONSE", "本机语音状态无效。");
      return {
        ...base,
        available: result.available,
        supportsOnDeviceRecognition: result.supportsOnDeviceRecognition,
        authorizationStatus: result.authorizationStatus,
        ...(result.reason
          ? { reason: result.reason, message: result.message }
          : {}),
      };
    } catch (error) {
      return {
        ...base,
        reason: error.code || "HELPER_UNAVAILABLE",
        message: error.message,
      };
    }
  }

  function cancel({ requestId } = {}) {
    const operation = requests.get(requestId);
    if (!operation) return { cancelled: false };
    operation.cancelled = true;
    operation.fail?.(speechError("CANCELLED", "已取消语音转写。"));
    return { cancelled: true };
  }

  async function transcribe({ requestId, audio } = {}) {
    if (disposed) throw speechError("CANCELLED", "已取消语音转写。");
    if (platform !== "darwin")
      throw speechError(
        "UNSUPPORTED_PLATFORM",
        "本机语音识别当前仅支持 macOS。",
      );
    if (
      typeof requestId !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(requestId)
    )
      throw speechError("INVALID_REQUEST", "语音请求标识无效。");
    if (requests.size) throw speechError("BUSY", "请等待当前语音转写完成。");
    const data = validateAudio(audio);
    const operation = { cancelled: false, fail: null };
    requests.set(requestId, operation);
    let directory;
    try {
      directory = await fs.mkdtemp(path.join(tmpRoot, "zhijun-speech-"));
      operation.directory = directory;
      const filename = path.join(directory, "audio.wav");
      await fs.writeFile(filename, data, { mode: 0o600 });
      const result = await run(["transcribe", filename], operation);
      if (typeof result.text !== "string" || !result.text.trim())
        throw speechError("NO_SPEECH", "没有识别到可用文字，请重试。");
      return {
        requestId,
        text: result.text.trim(),
        backend: "macos_speech",
        locale: "zh-CN",
      };
    } catch (error) {
      if (error.nativeSpeechError) throw error;
      throw speechError(
        "RECORDING_IO_FAILED",
        "本机录音临时文件无法保存，请检查可用空间后重试。",
      );
    } finally {
      requests.delete(requestId);
      if (directory) {
        try {
          await fs.rm(directory, { recursive: true, force: true });
        } catch {
          throw speechError(
            "RECORDING_IO_FAILED",
            "本机录音临时文件未能清理，请重试。",
          );
        }
      }
    }
  }

  return {
    capability: () => status("capability"),
    authorize: () => status("authorize"),
    transcribe,
    cancel,
    dispose() {
      disposed = true;
      for (const requestId of requests.keys()) cancel({ requestId });
      for (const child of [...children])
        child.fail(speechError("CANCELLED", "已取消语音转写。"));
      // Electron's quit event cannot await the transcription's async finally.
      // Remove only directories this controller created for its active requests.
      for (const operation of requests.values()) {
        if (operation.directory)
          fileSystemSync.rmSync(operation.directory, {
            recursive: true,
            force: true,
          });
      }
    },
  };
}

module.exports = {
  createNativeSpeech,
  validateAudio,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
};
