import { useEffect, useRef, useState } from "react";
import {
  voiceApi,
  type SttCapability,
} from "../../dashboard/src/api/modules/voice";
import {
  recordedBlobToWav,
  pickRecorderMimeType,
} from "../../dashboard/src/utils/recordedAudio";
import { parseApiError } from "../../dashboard/src/utils/apiError";
import type {
  NativeSpeechBridge,
  NativeSpeechCapability,
} from "./voice-native";

export type VoicePhase =
  | "idle"
  | "checking"
  | "confirmation"
  | "requesting"
  | "recording"
  | "transcribing"
  | "unavailable"
  | "error"
  | "done";

export interface VoiceInputOptions {
  contextKey: string;
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

const BUSY_PHASES = new Set<VoicePhase>([
  "checking",
  "confirmation",
  "requesting",
  "recording",
  "transcribing",
]);
const MAX_RECORDING_MS = 60_000;
const MAX_LOCAL_AUDIO_BYTES = 2 * 1024 * 1024;

type RecordingDestination =
  | { kind: "local"; bridge: NativeSpeechBridge; maxBytes: number }
  | { kind: "external"; capability: SttCapability; maxBytes: number };

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      return "麦克风权限未获允许。请在系统设置中允许知君使用麦克风，然后重试。";
    if (error.name === "NotFoundError") return "没有找到可用的麦克风。";
    if (error.name === "NotReadableError")
      return "麦克风暂时无法使用，请检查是否被其他应用占用。";
  }
  return "未能开始录音，请检查麦克风后重试。";
}

function localSpeechError(error: unknown): string {
  const messages: Record<string, string> = {
    UNSUPPORTED_PLATFORM: "当前系统不支持本机中文语音识别。",
    HELPER_UNAVAILABLE: "本机语音识别组件暂不可用，请重试。",
    PERMISSION_DENIED:
      "系统语音识别权限未获允许，请在系统设置中允许知君使用语音识别后重试。",
    ON_DEVICE_UNAVAILABLE:
      "本机中文语音识别模型暂不可用，请检查系统语音识别状态后重试。",
    RECOGNIZER_UNAVAILABLE: "本机中文语音识别暂不可用，请稍后重试。",
    INVALID_AUDIO: "录音格式无法用于本机识别，请重试或直接输入。",
    AUDIO_TOO_LONG: "录音超过 60 秒，请缩短后重试。",
    BUSY: "本机语音识别仍在处理上一段录音，请稍后重试。",
    CANCELLED: "本机语音识别已取消。",
    TIMEOUT: "本机语音识别超时，请重试或直接输入。",
    NO_SPEECH: "没有识别到文字，可以重新录音或直接输入。",
  };
  const raw = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (typeof code === "string" && messages[code]) return messages[code];
  // Electron may serialize only the Error message. Recognize fixed codes and
  // never display the raw IPC error, which can contain a local helper path.
  for (const [name, text] of Object.entries(messages)) {
    if (new RegExp(`(?:^|\\W)${name}(?:$|\\W)`).test(raw)) return text;
  }
  return "本机语音识别失败，请重试或直接输入。";
}

/** Prefer on-device speech; external STT requires a separate, explicit choice. */
export function useVoiceInput(options: VoiceInputOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [capability, setCapability] = useState<SttCapability | null>(null);
  const [localCapability, setLocalCapability] =
    useState<NativeSpeechCapability | null>(null);
  const [mode, setMode] = useState<"local" | "external">("local");
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativeRequest = useRef<{
    requestId: string;
    bridge: NativeSpeechBridge;
  } | null>(null);
  const busy = BUSY_PHASES.has(phase);

  function stopTimers() {
    if (finishTimer.current !== null) clearTimeout(finishTimer.current);
    if (tickTimer.current !== null) clearInterval(tickTimer.current);
    finishTimer.current = tickTimer.current = null;
  }

  function dispose() {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    if (nativeRequest.current) {
      void nativeRequest.current.bridge
        .cancel({ requestId: nativeRequest.current.requestId })
        .catch(() => {});
      nativeRequest.current = null;
    }
    stopTimers();
    const current = recorder.current;
    recorder.current = null;
    if (current) {
      current.ondataavailable = current.onstop = current.onerror = null;
      if (current.state !== "inactive") current.stop();
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }

  function cancel() {
    dispose();
    setCapability(null);
    setLocalCapability(null);
    setMode("local");
    setMessage("");
    setSeconds(0);
    setPhase("idle");
  }

  useEffect(() => {
    cancel();
    return () => {
      dispose();
      latest.current.onBusyChange?.(false);
    };
    // Context changes revoke consent and discard pending audio/results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.contextKey]);

  useEffect(() => {
    latest.current.onBusyChange?.(busy);
  }, [busy]);

  async function open() {
    if (options.disabled || busy) return;
    dispose();
    const id = generation.current;
    setMode("local");
    setCapability(null);
    setLocalCapability(null);
    setMessage("");
    setPhase("checking");
    const bridge = window.zhijunSpeech;
    if (!bridge) {
      setMessage(
        "当前环境没有本机语音识别，请使用 macOS 知君桌面应用，或主动选择已配置的外部转写服务。",
      );
      setPhase("unavailable");
      return;
    }
    try {
      const result = await bridge.capability();
      if (id !== generation.current) return;
      setLocalCapability(result);
      if (!result.available || !result.supportsOnDeviceRecognition) {
        setMessage(
          result.message || "本机中文语音识别暂不可用，可以重试或直接输入。",
        );
        setPhase("unavailable");
      } else if (!canRecord()) {
        setMessage("当前运行环境不支持麦克风录音。");
        setPhase("unavailable");
      } else if (result.authorizationStatus === "authorized") {
        await beginRecording(
          { kind: "local", bridge, maxBytes: MAX_LOCAL_AUDIO_BYTES },
          id,
        );
      } else {
        // Capability checks never trigger the macOS authorization dialog.
        setPhase("confirmation");
      }
    } catch {
      if (id !== generation.current) return;
      setMessage("暂时无法读取本机语音识别状态，请重试。");
      setPhase("error");
    }
  }

  function canRecord() {
    return Boolean(
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof MediaRecorder !== "undefined",
    );
  }

  async function openExternal() {
    if (
      options.disabled ||
      (busy && !(phase === "confirmation" && mode === "local"))
    )
      return;
    dispose();
    const id = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setMode("external");
    setLocalCapability(null);
    setCapability(null);
    setMessage("");
    setPhase("checking");
    try {
      const result = await voiceApi.getSttCapability(abort.signal);
      if (id !== generation.current) return;
      setCapability(result);
      if (!result.available || !result.configuration_id) {
        setMessage(result.message || "当前没有可用的语音转写服务。");
        setPhase("unavailable");
      } else if (!canRecord()) {
        setMessage(
          "当前运行环境不支持麦克风录音，请使用支持录音的知君桌面应用。",
        );
        setPhase("unavailable");
      } else {
        setPhase("confirmation");
      }
    } catch (error) {
      if (id !== generation.current) return;
      setMessage(
        parseApiError(error)?.message || "暂时无法读取语音转写状态，请重试。",
      );
      setPhase("error");
    }
  }

  function finish() {
    const current = recorder.current;
    if (!current || current.state === "inactive") return;
    stopTimers();
    setPhase("transcribing");
    current.stop();
  }

  async function confirmAndRecord() {
    if (phase !== "confirmation" || options.disabled) return;
    const id = generation.current;
    if (mode === "local") {
      const bridge = window.zhijunSpeech;
      if (
        !bridge ||
        !localCapability?.available ||
        !localCapability.supportsOnDeviceRecognition
      )
        return;
      setPhase("requesting");
      try {
        const authorized = await bridge.authorize();
        if (id !== generation.current) return;
        setLocalCapability(authorized);
        if (
          !authorized.available ||
          !authorized.supportsOnDeviceRecognition ||
          authorized.authorizationStatus !== "authorized"
        ) {
          setMessage(
            authorized.message ||
              "本机语音识别权限未获允许。请在系统设置中允许知君使用语音识别后重试。",
          );
          setPhase("unavailable");
          return;
        }
        await beginRecording(
          { kind: "local", bridge, maxBytes: MAX_LOCAL_AUDIO_BYTES },
          id,
        );
      } catch {
        if (id !== generation.current) return;
        setMessage("未能取得本机语音识别权限，请检查系统设置后重试。");
        setPhase("error");
      }
      return;
    }
    if (!capability?.configuration_id) return;
    await beginRecording(
      { kind: "external", capability, maxBytes: capability.max_audio_bytes },
      id,
    );
  }

  async function beginRecording(destination: RecordingDestination, id: number) {
    setPhase("requesting");
    let tracks: MediaStream | null = null;
    try {
      tracks = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (id !== generation.current) {
        tracks.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = tracks;
      const mimeType = pickRecorderMimeType();
      const current = new MediaRecorder(
        tracks,
        mimeType ? { mimeType } : undefined,
      );
      recorder.current = current;
      let chunks: Blob[] = [];
      let bytes = 0;
      current.ondataavailable = (event) => {
        if (id !== generation.current || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > destination.maxBytes) {
          dispose();
          setMessage("录音超过语音转写大小限制，请缩短后重试。");
          setPhase("error");
          chunks = [];
          return;
        }
        chunks.push(event.data);
      };
      current.onerror = () => {
        if (id !== generation.current) return;
        dispose();
        chunks = [];
        setMessage("录音未能完成，请重试。");
        setPhase("error");
      };
      current.onstop = () => {
        stopTimers();
        tracks?.getTracks().forEach((track) => track.stop());
        stream.current = null;
        recorder.current = null;
        if (id !== generation.current) return;
        setPhase("transcribing");
        const blob = new Blob(chunks, { type: current.mimeType || mimeType });
        chunks = [];
        void transcribe(blob, destination, id);
      };
      current.start(1000);
      setSeconds(0);
      setPhase("recording");
      tickTimer.current = setInterval(
        () => setSeconds((value) => value + 1),
        1000,
      );
      finishTimer.current = setTimeout(finish, MAX_RECORDING_MS);
    } catch (error) {
      tracks?.getTracks().forEach((track) => track.stop());
      if (id !== generation.current) return;
      dispose();
      setMessage(microphoneError(error));
      setPhase("error");
    }
  }

  async function transcribe(
    blob: Blob,
    destination: RecordingDestination,
    id: number,
  ) {
    try {
      if (!blob.size) throw new Error("empty_recording");
      const wav = await recordedBlobToWav(blob, MAX_RECORDING_MS / 1000);
      if (id !== generation.current) return;
      if (!wav.type.toLowerCase().includes("wav"))
        throw new Error("unsupported_recording");
      if (wav.size > destination.maxBytes)
        throw new Error("recording_too_large");
      let text: string;
      if (destination.kind === "local") {
        const audio = new Uint8Array(await wav.arrayBuffer());
        if (id !== generation.current) return;
        const requestId = crypto.randomUUID();
        nativeRequest.current = { requestId, bridge: destination.bridge };
        try {
          const result = await destination.bridge.transcribe({
            requestId,
            audio,
          });
          if (
            result.requestId !== requestId ||
            result.backend !== "macos_speech" ||
            result.locale !== "zh-CN"
          )
            throw new Error("local_result_mismatch");
          text = result.text.trim();
        } finally {
          if (nativeRequest.current?.requestId === requestId)
            nativeRequest.current = null;
        }
      } else {
        const result = await voiceApi.transcribe(wav, "zh-CN", undefined, {
          signal: controller.current?.signal,
          expectedConfigurationId:
            destination.capability.configuration_id || undefined,
        });
        text = result.text.trim();
      }
      if (id !== generation.current) return;
      if (!text) {
        setMessage("没有识别到文字，可以重新录音或直接输入。");
        setPhase("error");
        return;
      }
      latest.current.onTranscript(text);
      setCapability(null);
      setLocalCapability(null);
      setMessage("文字已放入草稿，可编辑后发送。");
      setPhase("done");
    } catch (error) {
      if (id !== generation.current) return;
      const known: Record<string, string> = {
        empty_recording: "没有录到声音，请重试。",
        unsupported_recording: "录音无法转换为支持的格式，请重试或直接输入。",
        recording_too_large: "录音超过语音转写大小限制，请缩短后重试。",
        local_result_mismatch: "本机语音识别返回的结果无法核对，请重试。",
      };
      setCapability(null);
      setMessage(
        parseApiError(error)?.message ||
          (error instanceof Error && known[error.message]) ||
          (destination.kind === "local"
            ? localSpeechError(error)
            : "语音转写失败，请重试或直接输入。"),
      );
      setPhase("error");
    }
  }

  return {
    phase,
    mode,
    capability,
    localCapability,
    message,
    seconds,
    busy,
    open,
    openExternal,
    cancel,
    finish,
    confirmAndRecord,
  };
}
