import {
  RESPONSE_OPTIONS_NOTICE,
  type ResponseOptions,
} from "./responseOptions";

/** Optional starting points beside the user's own composer, never a send action. */
export function ResponseChoicePanel({
  invitation,
  loading,
  error,
  onClose,
  onRetry,
  onDraft,
}: {
  invitation?: ResponseOptions;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  onDraft: (answer: string) => void;
}) {
  return (
    <section
      id="response-choice-panel"
      className="response-panel"
      aria-label="回应思路"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <span>也可以从这里想起</span>
        <button aria-label="收起回应思路" onClick={onClose}>
          收起
        </button>
      </header>
      {loading && <p role="status">正在整理几个可能的方向…</p>}
      {error && (
        <p role="status">
          {error} <button onClick={onRetry}>重新生成</button>
        </p>
      )}
      {invitation && !loading && (
        <>
          <div className="response-panel-options">
            {invitation.options.map((option) => (
              <button
                key={option.label}
                aria-label={`借用思路：${option.label}`}
                title={`${option.label}：${option.draft}\n放入输入框，再按自己的想法改写`}
                onClick={() => onDraft(option.draft)}
              >
                <strong>{option.label}</strong>
                <span>{option.draft}</span>
              </button>
            ))}
          </div>
          <p className="response-panel-note">{RESPONSE_OPTIONS_NOTICE}</p>
        </>
      )}
    </section>
  );
}
