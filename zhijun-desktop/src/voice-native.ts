export interface NativeSpeechCapability {
  backend: "macos_speech";
  locale: "zh-CN";
  available: boolean;
  supportsOnDeviceRecognition: boolean;
  authorizationStatus:
    | "not_determined"
    | "denied"
    | "restricted"
    | "authorized";
  reason?: string;
  message?: string;
}

export interface NativeSpeechBridge {
  capability: () => Promise<NativeSpeechCapability>;
  authorize: () => Promise<NativeSpeechCapability>;
  transcribe: (input: { requestId: string; audio: Uint8Array }) => Promise<{
    requestId: string;
    text: string;
    backend: "macos_speech";
    locale: "zh-CN";
  }>;
  cancel: (input: { requestId: string }) => Promise<{ cancelled: boolean }>;
}

declare global {
  interface Window {
    zhijunSpeech?: NativeSpeechBridge;
  }
}
