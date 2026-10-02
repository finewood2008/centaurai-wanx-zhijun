import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceInput } from "./VoiceInput";
import {
  voiceApi,
  type SttCapability,
} from "../../dashboard/src/api/modules/voice";
import { recordedBlobToWav } from "../../dashboard/src/utils/recordedAudio";
import type {
  NativeSpeechBridge,
  NativeSpeechCapability,
} from "./voice-native";

vi.mock("../../dashboard/src/api/modules/voice", () => ({
  voiceApi: { getSttCapability: vi.fn(), transcribe: vi.fn() },
}));
vi.mock("../../dashboard/src/utils/recordedAudio", () => ({
  recordedBlobToWav: vi.fn(),
  pickRecorderMimeType: () => "audio/webm",
}));

const ready: SttCapability = {
  available: true,
  reason: "ready",
  message: null,
  provider_name: "合成测试服务",
  provider_kind: "openai",
  configuration_id: "confirmed-configuration",
  external_processing: true,
  max_audio_bytes: 2 * 1024 * 1024,
};
const stop = vi.fn();
const getUserMedia = vi.fn();
let recording: FakeRecorder;
class FakeRecorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor() {
    recording = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["synthetic recording"], { type: "audio/webm" }),
    });
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.mocked(voiceApi.getSttCapability).mockReset().mockResolvedValue(ready);
  vi.mocked(voiceApi.transcribe)
    .mockReset()
    .mockResolvedValue({ text: "合成语音文字" });
  vi.mocked(recordedBlobToWav)
    .mockReset()
    .mockResolvedValue(new Blob(["synthetic wav"], { type: "audio/wav" }));
  stop.mockReset();
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop }] });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("zhijunSpeech", undefined);
  vi.stubGlobal(
    "SpeechRecognition",
    vi.fn(() => {
      throw new Error("never use browser STT");
    }),
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "使用外部转写服务" });
  fireEvent.click(screen.getByRole("button", { name: "使用外部转写服务" }));
  await screen.findByRole("button", { name: "同意并开始录音" });
}
async function record() {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "同意并开始录音" }));
  await screen.findByRole("button", { name: "完成" });
}

it("asks permission for the named external service before recording; puts text in a draft only", async () => {
  const transcript = vi.fn(),
    busy = vi.fn();
  render(
    <VoiceInput
      contextKey="account/profile/thread"
      onTranscript={transcript}
      onBusyChange={busy}
    />,
  );
  const initial = screen.getByRole("button", { name: "语音输入" });
  expect(initial.textContent).toBe("");
  await open();
  expect(screen.getByText(/合成测试服务/).textContent).toContain("OpenAI 兼容");
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "同意并开始录音" }));
  await screen.findByRole("button", { name: "完成" });
  expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() => expect(transcript).toHaveBeenCalledWith("合成语音文字"));
  expect(voiceApi.transcribe).toHaveBeenCalledWith(
    expect.any(Blob),
    "zh-CN",
    undefined,
    {
      signal: expect.any(AbortSignal),
      expectedConfigurationId: ready.configuration_id,
    },
  );
  expect(stop).toHaveBeenCalled();
  expect(busy).toHaveBeenLastCalledWith(false);
  expect(window.SpeechRecognition).not.toHaveBeenCalled();
});

it("keeps an unavailable microphone button clickable and retries actual status", async () => {
  vi.mocked(voiceApi.getSttCapability).mockResolvedValueOnce({
    ...ready,
    available: false,
    reason: "browser_only",
    configuration_id: null,
    message: "只配置了浏览器识别",
  });
  render(<VoiceInput contextKey="owner" onTranscript={vi.fn()} />);
  expect(screen.queryByText("只配置了浏览器识别")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "使用外部转写服务" });
  expect(voiceApi.getSttCapability).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用外部转写服务" }));
  await screen.findByText("只配置了浏览器识别");
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "语音输入" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
  await screen.findByRole("button", { name: "同意并开始录音" });
});

it("canceling recording stops microphone tracks and discards audio without upload", async () => {
  const transcript = vi.fn();
  render(<VoiceInput contextKey="owner" onTranscript={transcript} />);
  await record();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(stop).toHaveBeenCalled();
  expect(recording.state).toBe("inactive");
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
  expect(transcript).not.toHaveBeenCalled();
});

it("a context change revokes confirmation and drops a stale in-flight transcript", async () => {
  let resolve!: (value: { text: string }) => void;
  vi.mocked(voiceApi.transcribe).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const transcript = vi.fn();
  const view = render(
    <VoiceInput contextKey="first-profile/thread" onTranscript={transcript} />,
  );
  await record();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() => expect(voiceApi.transcribe).toHaveBeenCalled());
  const signal = vi.mocked(voiceApi.transcribe).mock.calls[0][3]?.signal;
  view.rerender(
    <VoiceInput contextKey="second-profile/thread" onTranscript={transcript} />,
  );
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve({ text: "previous account material" }));
  expect(transcript).not.toHaveBeenCalled();
  await open();
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});

it("canceling while microphone permission is pending stops tracks when they arrive", async () => {
  let resolve!: (value: { getTracks: () => { stop: typeof stop }[] }) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<VoiceInput contextKey="owner" onTranscript={vi.fn()} />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "同意并开始录音" }));
  await screen.findByText("等待麦克风权限…");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () => resolve({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalled();
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
});

it("shows permission denial and unsupported format without cloud fallback", async () => {
  getUserMedia.mockRejectedValueOnce(
    new DOMException("denied", "NotAllowedError"),
  );
  render(<VoiceInput contextKey="owner" onTranscript={vi.fn()} />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "同意并开始录音" }));
  await screen.findByText(/麦克风权限未获允许/);
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
  vi.mocked(recordedBlobToWav).mockImplementation(async (blob) => blob);
  await record();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await screen.findByText(/无法转换/);
  expect(stop).toHaveBeenCalled();
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
});

it("rejects changed configuration and requires a fresh confirmation", async () => {
  vi.mocked(voiceApi.transcribe).mockRejectedValueOnce(
    new Error(
      '409: {"error":{"code":"VOICE_CONFIGURATION_CHANGED","message":"服务已变更，请重新确认"}}',
    ),
  );
  const transcript = vi.fn();
  render(<VoiceInput contextKey="owner" onTranscript={transcript} />);
  await record();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await screen.findByText("服务已变更，请重新确认");
  expect(transcript).not.toHaveBeenCalled();
  await open();
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});

it("unmounting stops an active microphone", async () => {
  const view = render(<VoiceInput contextKey="owner" onTranscript={vi.fn()} />);
  await record();
  view.unmount();
  expect(stop).toHaveBeenCalled();
  expect(recording.state).toBe("inactive");
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
});

function nativeBridge(
  authorizationStatus: NativeSpeechCapability["authorizationStatus"] = "authorized",
) {
  const capability: NativeSpeechCapability = {
    backend: "macos_speech",
    locale: "zh-CN",
    available: true,
    supportsOnDeviceRecognition: true,
    authorizationStatus,
  };
  const bridge: NativeSpeechBridge = {
    capability: vi.fn().mockResolvedValue(capability),
    authorize: vi
      .fn()
      .mockResolvedValue({ ...capability, authorizationStatus: "authorized" }),
    transcribe: vi.fn().mockImplementation(async ({ requestId }) => ({
      requestId,
      text: "本机合成语音文字",
      backend: "macos_speech",
      locale: "zh-CN",
    })),
    cancel: vi.fn().mockResolvedValue({ cancelled: true }),
  };
  vi.stubGlobal("zhijunSpeech", bridge);
  // jsdom Blob lacks arrayBuffer; native Chromium supplies it. No actual audio is recorded.
  vi.mocked(recordedBlobToWav).mockResolvedValue({
    type: "audio/wav",
    size: 48,
    arrayBuffer: async () => new Uint8Array(48).buffer,
  } as Blob);
  return bridge;
}

it("checks on-device readiness without authorization; first local start explicitly authorizes and only returns a draft", async () => {
  const bridge = nativeBridge("not_determined");
  const transcript = vi.fn();
  render(
    <VoiceInput contextKey="native/profile/thread" onTranscript={transcript} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "开始本机录音" });
  expect(screen.getByText(/录音在本机处理/)).toBeTruthy();
  expect(bridge.authorize).not.toHaveBeenCalled();
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(voiceApi.getSttCapability).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "开始本机录音" }));
  await screen.findByRole("button", { name: "完成" });
  expect(bridge.authorize).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() =>
    expect(transcript).toHaveBeenCalledWith("本机合成语音文字"),
  );
  expect(bridge.transcribe).toHaveBeenCalledWith({
    requestId: expect.any(String),
    audio: expect.any(Uint8Array),
  });
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
  expect(window.SpeechRecognition).not.toHaveBeenCalled();
});

it("an authorized local recognizer records on a user microphone click", async () => {
  const bridge = nativeBridge();
  render(<VoiceInput contextKey="native" onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "完成" });
  expect(bridge.authorize).not.toHaveBeenCalled();
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(stop).toHaveBeenCalled();
  expect(bridge.transcribe).not.toHaveBeenCalled();
  expect(voiceApi.getSttCapability).not.toHaveBeenCalled();
});

it("local permission denial does not open microphone or fall back to an external service", async () => {
  const bridge = nativeBridge("not_determined");
  vi.mocked(bridge.authorize).mockResolvedValueOnce({
    backend: "macos_speech",
    locale: "zh-CN",
    available: false,
    supportsOnDeviceRecognition: true,
    authorizationStatus: "denied",
    reason: "denied",
    message: "系统语音识别权限被拒绝",
  });
  render(<VoiceInput contextKey="native" onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "开始本机录音" });
  fireEvent.click(screen.getByRole("button", { name: "开始本机录音" }));
  await screen.findByText("系统语音识别权限被拒绝");
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(voiceApi.getSttCapability).not.toHaveBeenCalled();
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用外部转写服务" }));
  await screen.findByRole("button", { name: "同意并开始录音" });
  expect(getUserMedia).not.toHaveBeenCalled();
});

it("missing on-device support is shown truthfully and never enables network speech implicitly", async () => {
  const bridge = nativeBridge();
  vi.mocked(bridge.capability).mockResolvedValueOnce({
    backend: "macos_speech",
    locale: "zh-CN",
    available: true,
    supportsOnDeviceRecognition: false,
    authorizationStatus: "authorized",
    message: "本机中文识别模型不可用",
  });
  render(<VoiceInput contextKey="native" onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByText("本机中文识别模型不可用");
  expect(bridge.authorize).not.toHaveBeenCalled();
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(voiceApi.getSttCapability).not.toHaveBeenCalled();
});

it("a local transcription error leaves the draft unchanged and does not switch to the cloud", async () => {
  const bridge = nativeBridge();
  vi.mocked(bridge.transcribe).mockRejectedValueOnce(
    new Error("NATIVE_SPEECH_UNAVAILABLE"),
  );
  const transcript = vi.fn();
  render(<VoiceInput contextKey="native" onTranscript={transcript} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "完成" });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await screen.findByText(/本机语音识别失败/);
  expect(transcript).not.toHaveBeenCalled();
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
  expect(voiceApi.getSttCapability).not.toHaveBeenCalled();
});

it("account or thread changes cancel native recognition and discard its late result", async () => {
  const bridge = nativeBridge();
  let resolve!: (
    result: Awaited<ReturnType<NativeSpeechBridge["transcribe"]>>,
  ) => void;
  vi.mocked(bridge.transcribe).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const transcript = vi.fn();
  const view = render(
    <VoiceInput contextKey="first/thread" onTranscript={transcript} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "完成" });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await waitFor(() => expect(bridge.transcribe).toHaveBeenCalled());
  const requestId = vi.mocked(bridge.transcribe).mock.calls[0][0].requestId;
  view.rerender(
    <VoiceInput contextKey="second/thread" onTranscript={transcript} />,
  );
  expect(bridge.cancel).toHaveBeenCalledWith({ requestId });
  await act(async () =>
    resolve({
      requestId,
      text: "previous profile material",
      backend: "macos_speech",
      locale: "zh-CN",
    }),
  );
  expect(transcript).not.toHaveBeenCalled();
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
});

it("cancel while native authorization is pending prevents microphone access after permission arrives", async () => {
  const bridge = nativeBridge("not_determined");
  let resolve!: (result: NativeSpeechCapability) => void;
  vi.mocked(bridge.authorize).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<VoiceInput contextKey="native" onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "开始本机录音" });
  fireEvent.click(screen.getByRole("button", { name: "开始本机录音" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () =>
    resolve({
      backend: "macos_speech",
      locale: "zh-CN",
      available: true,
      supportsOnDeviceRecognition: true,
      authorizationStatus: "authorized",
    }),
  );
  expect(getUserMedia).not.toHaveBeenCalled();
});

it("a native result for another request cannot fill the current draft", async () => {
  const bridge = nativeBridge();
  vi.mocked(bridge.transcribe).mockResolvedValueOnce({
    requestId: "wrong-request",
    text: "must not use",
    backend: "macos_speech",
    locale: "zh-CN",
  });
  const transcript = vi.fn();
  render(<VoiceInput contextKey="native" onTranscript={transcript} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "完成" });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await screen.findByText(/结果无法核对/);
  expect(transcript).not.toHaveBeenCalled();
});

it("shows fixed native timeout copy without leaking IPC paths or trying cloud STT", async () => {
  const bridge = nativeBridge();
  vi.mocked(bridge.transcribe).mockRejectedValueOnce(
    new Error(
      "Error invoking remote method: Error: TIMEOUT /private/synthetic/helper-path",
    ),
  );
  render(<VoiceInput contextKey="native" onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await screen.findByRole("button", { name: "完成" });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  await screen.findByText("本机语音识别超时，请重试或直接输入。");
  expect(screen.queryByText(/helper-path/)).toBeNull();
  expect(voiceApi.transcribe).not.toHaveBeenCalled();
  expect(voiceApi.getSttCapability).not.toHaveBeenCalled();
});
