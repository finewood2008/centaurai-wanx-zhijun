import { useEffect, useState } from "react";
import type { ChatMessage } from "../../dashboard/src/pages/Chat/hooks/sseHelpers";
import { assistantReplyText } from "./responseOptions";

export const turnLabels = {
  waiting: "知君正在接话…",
  thinking: "让我想一想…",
  memory: "我在回看相关记忆…",
  sources: "我在查阅相关资料…",
  working: "我在理一理…",
  replying: "知君正在回应…",
};
export type TurnPhase = keyof typeof turnLabels;

/** Describe only events from the current turn, never inferred progress. */
export function turnActivity(messages: ChatMessage[], preparing = false) {
  let lastUser = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") lastUser = index;
  });
  const current = preparing
    ? []
    : lastUser >= 0
    ? messages.slice(lastUser + 1)
    : messages.filter((message) => message.status === "streaming");
  const hasReply = current.some(
    (message) =>
      message.role === "assistant" &&
      !message.toolData &&
      !message.hitlData &&
      assistantReplyText(message).trim(),
  );
  const activeTool = [...current]
    .reverse()
    .find((message) => message.toolData && message.status === "streaming");
  let phase: TurnPhase = hasReply ? "replying" : "waiting";
  if (activeTool) {
    const name = activeTool.toolData?.name;
    phase = [
      "memory_search",
      "memory_get",
      "zhijun_episode_search",
      "zhijun_episode_get",
    ].includes(name || "")
      ? "memory"
      : [
          "search_knowledge",
          "zhijun_knowledge_get",
          "zhijun_attachment_get",
        ].includes(name || "")
      ? "sources"
      : "working";
  } else if (
    !hasReply &&
    current.some(
      (message) =>
        message.contentBlocks?.some((block) => block.type === "thinking"),
    )
  )
    phase = "thinking";
  return {
    phase,
    hasReply,
    requiresDecision: current.some(
      (message) => message.hitlData?.status === "pending",
    ),
  };
}

export function TurnPresence({
  phase,
  compact,
  preparing,
  startedAt,
  onStop,
  onLayout,
}: {
  phase: TurnPhase;
  compact: boolean;
  preparing: boolean;
  startedAt?: number | null;
  onStop: () => void;
  onLayout?: () => void;
}) {
  const [since] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const slow = !compact && now - (startedAt || since) >= 45000;
  useEffect(() => {
    if (compact) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [compact]);
  useEffect(() => {
    onLayout?.();
  }, [phase, compact, slow, onLayout]);
  return (
    <div className={`turn-presence${compact ? " compact" : ""}`}>
      {!compact && (
        <span className="speaker" aria-hidden="true">
          知
        </span>
      )}
      <div>
        <div
          className="turn-presence-line"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="presence-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{turnLabels[phase]}</span>
        </div>
        {!compact && (
          <p className="turn-presence-note">
            {slow
              ? "这次等待较久。可以继续等，也可以先停止回答。"
              : preparing
              ? "这段交谈正在接上。"
              : "你可以先写下一句。"}
          </p>
        )}
        {slow && !preparing && (
          <button className="turn-stop" onClick={onStop}>
            先停止回答
          </button>
        )}
      </div>
    </div>
  );
}
