const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createNativeSpeech,
  validateAudio,
  MAX_AUDIO_BYTES,
} = require("../shell/native-speech.cjs");

function wav(seconds = 1) {
  const bytes = Math.round(seconds * 32000);
  const data = Buffer.alloc(44 + bytes);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(bytes, 40);
  return data;
}

const ready = {
  ok: true,
  locale: "zh-CN",
  available: true,
  supportsOnDeviceRecognition: true,
  authorizationStatus: "not_determined",
};

async function fixture(t, handler, options = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "zhijun-speech-test-"),
  );
  const calls = [];
  const native = createNativeSpeech({
    helperPath: path.join(directory, "fixed-helper"),
    platform: "darwin",
    tmpRoot: directory,
    ...options,
    spawn(command, args, spawnOptions) {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.signals = [];
      child.kill = (signal) => {
        child.signals.push(signal);
        return true;
      };
      const call = { command, args, spawnOptions, child };
      calls.push(call);
      queueMicrotask(() => handler(call));
      return child;
    },
  });
  t.after(async () => {
    native.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { native, calls, directory };
}

function reply(call, value, code = 0) {
  call.child.stdout.end(JSON.stringify(value));
  call.child.emit("close", code);
}

test("capability never requests authorization or creates audio files", async (t) => {
  const { native, calls, directory } = await fixture(t, (call) =>
    reply(call, ready),
  );
  const result = await native.capability();
  assert.equal(result.available, true);
  assert.equal(result.authorizationStatus, "not_determined");
  assert.deepEqual(calls[0].args, ["capability"]);
  assert.equal(calls[0].spawnOptions.shell, false);
  assert.deepEqual(await fs.readdir(directory), []);
});

test("only an explicit authorize call launches the permission command", async (t) => {
  const { native, calls } = await fixture(t, (call) =>
    reply(call, {
      ...ready,
      available: false,
      authorizationStatus: "denied",
      reason: "PERMISSION_DENIED",
      message: "未允许",
    }),
  );
  assert.equal((await native.authorize()).available, false);
  assert.deepEqual(calls[0].args, ["authorize"]);
  assert.equal(calls.length, 1);
});

test("unsupported systems and missing helpers report unavailable without fallback", async (t) => {
  const { native, calls } = await fixture(
    t,
    () => assert.fail("must not spawn"),
    { platform: "win32" },
  );
  assert.equal((await native.capability()).reason, "UNSUPPORTED_PLATFORM");
  assert.equal(calls.length, 0);
  const missing = createNativeSpeech({
    helperPath: "fixed-helper",
    platform: "darwin",
    spawn() {
      throw new Error("missing");
    },
  });
  assert.equal((await missing.capability()).reason, "HELPER_UNAVAILABLE");
  missing.dispose();
});

test("transcribe uses a private generated WAV path and removes it after success", async (t) => {
  let file, captured;
  const { native, calls, directory } = await fixture(t, (call) => {
    file = call.args[1];
    fs.readFile(file).then((data) => {
      captured = data;
      reply(call, { ok: true, text: " 合成转写文字 " });
    });
  });
  const audio = wav();
  const result = await native.transcribe({
    requestId: "synthetic-1",
    audio,
    filename: "ignored-path",
  });
  assert.equal(result.text, "合成转写文字");
  assert.equal(result.requestId, "synthetic-1");
  assert.deepEqual(captured, audio);
  assert.equal(path.basename(file), "audio.wav");
  assert.equal(path.dirname(path.dirname(file)), directory);
  assert.equal(calls[0].args[0], "transcribe");
  assert.deepEqual(await fs.readdir(directory), []);
});

test("malformed, oversized and overlong WAV inputs never launch a helper", async (t) => {
  const { native, calls, directory } = await fixture(t, () =>
    assert.fail("must not spawn"),
  );
  const wrongRate = wav();
  wrongRate.writeUInt32LE(48000, 24);
  for (const audio of [
    "arbitrary/path",
    new Uint8Array(0),
    wrongRate,
    new Uint8Array(MAX_AUDIO_BYTES + 1),
  ]) {
    await assert.rejects(native.transcribe({ requestId: "invalid", audio }), {
      code: "INVALID_AUDIO",
    });
  }
  await assert.rejects(
    native.transcribe({ requestId: "long", audio: wav(60.01) }),
    { code: "AUDIO_TOO_LONG" },
  );
  await assert.rejects(
    native.transcribe({ requestId: "../escape", audio: wav() }),
    { code: "INVALID_REQUEST" },
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(validateAudio(wav(60)).length, 1_920_044);
});

test("cancel kills the correct helper and removes the temporary recording", async (t) => {
  let launched;
  const started = new Promise((resolve) => {
    launched = resolve;
  });
  const { native, calls, directory } = await fixture(t, () => launched());
  const pending = native.transcribe({ requestId: "cancel-1", audio: wav() });
  const rejected = assert.rejects(pending, { code: "CANCELLED" });
  await started;
  assert.deepEqual(native.cancel({ requestId: "other" }), { cancelled: false });
  assert.deepEqual(native.cancel({ requestId: "cancel-1" }), {
    cancelled: true,
  });
  await rejected;
  assert.deepEqual(calls[0].child.signals, ["SIGKILL"]);
  assert.deepEqual(await fs.readdir(directory), []);
});

test("timeout and native failure remove recordings and never return false success", async (t) => {
  const timed = await fixture(t, () => {}, { timeoutMs: 5 });
  await assert.rejects(
    timed.native.transcribe({ requestId: "timeout", audio: wav() }),
    { code: "TIMEOUT" },
  );
  assert.deepEqual(timed.calls[0].child.signals, ["SIGKILL"]);
  assert.deepEqual(await fs.readdir(timed.directory), []);
  const denied = await fixture(t, (call) =>
    reply(
      call,
      { ok: false, code: "ON_DEVICE_UNAVAILABLE", message: "不可用" },
      1,
    ),
  );
  await assert.rejects(
    denied.native.transcribe({ requestId: "failed", audio: wav() }),
    { code: "ON_DEVICE_UNAVAILABLE" },
  );
  assert.equal(denied.calls.length, 1);
  assert.deepEqual(await fs.readdir(denied.directory), []);
});

test("duplicate requests are rejected and disposal cancels the active helper", async (t) => {
  let launched;
  const started = new Promise((resolve) => {
    launched = resolve;
  });
  const { native, directory } = await fixture(t, () => launched());
  const pending = native.transcribe({ requestId: "one", audio: wav() });
  const rejected = assert.rejects(pending, { code: "CANCELLED" });
  await started;
  await assert.rejects(native.transcribe({ requestId: "two", audio: wav() }), {
    code: "BUSY",
  });
  native.dispose();
  assert.deepEqual(fsSync.readdirSync(directory), []);
  await rejected;
  assert.deepEqual(await fs.readdir(directory), []);
});

test("file write failures clean up and do not expose local filesystem paths", async (t) => {
  const brokenFs = {
    ...fs,
    async writeFile(filename) {
      throw new Error(`private path: ${filename}`);
    },
  };
  const { native, calls, directory } = await fixture(
    t,
    () => assert.fail("must not spawn"),
    { fs: brokenFs },
  );
  await assert.rejects(
    native.transcribe({ requestId: "io-failed", audio: wav() }),
    (error) => {
      assert.equal(error.code, "RECORDING_IO_FAILED");
      assert.equal(error.message.includes(directory), false);
      return true;
    },
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(await fs.readdir(directory), []);
});
