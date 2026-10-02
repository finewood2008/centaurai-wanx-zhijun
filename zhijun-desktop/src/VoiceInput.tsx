import { useVoiceInput, type VoiceInputOptions } from "./useVoiceInput";

const SERVICE_TYPES: Record<string, string> = {
  openai: "OpenAI 兼容语音转写服务",
  tencent: "腾讯云语音转写服务",
  mimo: "Mimo 语音转写服务",
};

export function VoiceInput(props: VoiceInputOptions) {
  const voice = useVoiceInput(props);
  const expanded = voice.phase !== "idle";
  const recording = voice.phase === "recording";
  return (
    <div className="voice-input">
      {!voice.busy && (
        <button
          type="button"
          className="voice-input-button"
          aria-label="语音输入"
          title="语音输入"
          disabled={props.disabled}
          onClick={() => void voice.open()}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
          </svg>
        </button>
      )}
      {expanded && (
        <div className="voice-input-panel">
          {voice.phase === "confirmation" && voice.mode === "local" && (
            <>
              <p className="voice-input-status">
                使用 macOS
                本机中文语音识别，录音在本机处理。首次开始会申请系统语音识别和麦克风权限；文字会放入可编辑草稿，不会自动发送。
              </p>
              <div className="voice-input-actions">
                <button
                  type="button"
                  onClick={() => void voice.confirmAndRecord()}
                  disabled={props.disabled}
                >
                  开始本机录音
                </button>
                <button
                  type="button"
                  onClick={() => void voice.openExternal()}
                  disabled={props.disabled}
                >
                  使用外部转写服务
                </button>
                <button type="button" onClick={voice.cancel}>
                  取消
                </button>
              </div>
            </>
          )}
          {voice.phase === "confirmation" &&
            voice.mode === "external" &&
            voice.capability && (
              <>
                <p className="voice-input-status">
                  这段录音将发送到「{voice.capability.provider_name}」（
                  {SERVICE_TYPES[voice.capability.provider_kind || ""] ||
                    "语音转写服务"}
                  ）进行转写。此确认仅用于本次录音；转写文字会放入可编辑草稿，不会自动发送。
                </p>
                <div className="voice-input-actions">
                  <button
                    type="button"
                    onClick={() => void voice.confirmAndRecord()}
                    disabled={props.disabled}
                  >
                    同意并开始录音
                  </button>
                  <button type="button" onClick={voice.cancel}>
                    取消
                  </button>
                </div>
              </>
            )}
          {voice.phase !== "confirmation" && (
            <>
              <p
                className="voice-input-status"
                role="status"
                aria-live="polite"
              >
                {voice.phase === "checking"
                  ? voice.mode === "local"
                    ? "正在读取本机语音识别状态…"
                    : "正在读取转写服务状态…"
                  : voice.phase === "requesting"
                  ? voice.mode === "local"
                    ? "等待系统语音识别和麦克风权限…"
                    : "等待麦克风权限…"
                  : recording
                  ? `${voice.mode === "local" ? "本机" : "正在"}录音 ${
                      voice.seconds
                    } 秒 · 最多 60 秒`
                  : voice.phase === "transcribing"
                  ? voice.mode === "local"
                    ? "正在本机识别，完成后文字将进入草稿…"
                    : "正在转写，完成后文字将进入草稿…"
                  : voice.message}
              </p>
              <div className="voice-input-actions">
                {recording && (
                  <button type="button" onClick={voice.finish}>
                    完成
                  </button>
                )}
                {!voice.busy && voice.phase !== "done" && (
                  <button
                    type="button"
                    onClick={() =>
                      void (voice.mode === "local"
                        ? voice.open()
                        : voice.openExternal())
                    }
                    disabled={props.disabled}
                  >
                    {voice.mode === "local"
                      ? "重新读取本机状态"
                      : "重新读取状态"}
                  </button>
                )}
                {!voice.busy && voice.mode === "local" && (
                  <button
                    type="button"
                    onClick={() => void voice.openExternal()}
                    disabled={props.disabled}
                  >
                    使用外部转写服务
                  </button>
                )}
                <button type="button" onClick={voice.cancel}>
                  {voice.busy ? "取消" : "收起"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
