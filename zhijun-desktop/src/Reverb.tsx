import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import {
  understandingReference,
  type UnderstandingInvitation,
  type UnderstandingState,
} from "./understanding";
import type { MemoryReference } from "./references";
import { ZhijunRobot } from "./ZhijunRobot";
import { CoreCandidates, type useCoreCandidates } from "./CoreCandidates";
import type { OntologyClaim } from "./ontology";

export const REVERB_IDLE_MS = 60_000;
export const REVERB_COOLDOWN_MS = 10 * 60_000;

export function unreadInvitation(item: UnderstandingInvitation) {
  return !item.read_at && !item.reviewed_at;
}

export function Reverb({
  scope,
  state,
  busy,
  error,
  hidden,
  switchingDisabled,
  idleBlocked = false,
  activeInvitationId,
  onReview,
  onDiscuss,
  onSource,
  onRetry,
  coreQueue,
  onCoreDiscuss,
  coreOpenRequest,
}: {
  scope: string;
  state: UnderstandingState | null;
  busy: boolean;
  error: string;
  hidden: boolean;
  switchingDisabled: boolean;
  idleBlocked?: boolean;
  activeInvitationId?: string;
  onReview: (id: string, action: "read" | "later" | "dismiss") => void;
  onDiscuss: (id: string) => Promise<boolean>;
  onSource: (reference: MemoryReference) => void;
  onRetry: () => void;
  coreQueue?: ReturnType<typeof useCoreCandidates>;
  onCoreDiscuss?: (claim: OntologyClaim) => Promise<boolean>;
  coreOpenRequest?: { key: number; id: string };
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [selected, setSelected] = useState("");
  const [coreSelected, setCoreSelected] = useState("");
  const [invitationOffset, setInvitationOffset] = useState(0);
  const [completedLimit, setCompletedLimit] = useState(8);
  const consumedCoreRequest = useRef<number>();
  const [proactive, setProactive] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoringFocus = useRef(false);
  const cancelClose = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const close = () => {
    cancelClose();
    setOpen(false);
    setPinned(false);
    setSelected("");
    setCoreSelected("");
    setProactive(false);
  };
  useEffect(() => {
    close();
  }, [scope, hidden]);
  useEffect(() => () => cancelClose(), []);
  useEffect(() => {
    if (
      !coreOpenRequest ||
      hidden ||
      consumedCoreRequest.current === coreOpenRequest.key
    )
      return;
    consumedCoreRequest.current = coreOpenRequest.key;
    setOpen(true);
    setPinned(true);
    setProactive(false);
    setSelected("");
    setCoreSelected(coreOpenRequest.id);
  }, [coreOpenRequest, hidden]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        restoringFocus.current = document.activeElement !== trigger.current;
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const available = (state?.invitations ?? []).filter(
    (item) =>
      item.source_available !== false &&
      item.status !== "invalid" &&
      item.status !== "dismissed",
  );
  const pending = available
    .filter((item) => item.status !== "resolved")
    .sort(
      (a, b) =>
        Number(unreadInvitation(b)) - Number(unreadInvitation(a)) ||
        (b.created_at ?? b.id).localeCompare(a.created_at ?? a.id),
    );
  const pendingOffset = Math.min(
    invitationOffset,
    Math.floor(Math.max(0, pending.length - 1) / 8) * 8,
  );
  useEffect(() => {
    setInvitationOffset(pendingOffset);
  }, [pendingOffset]);
  useEffect(() => {
    setInvitationOffset(0);
  }, [scope]);
  const completed = available
    .filter((item) => item.status === "resolved")
    .sort((a, b) => (b.created_at ?? b.id).localeCompare(a.created_at ?? a.id));
  const badgeCount =
    pending.filter(
      (i) => !i.snoozed_until || Date.parse(i.snoozed_until) <= Date.now(),
    ).length + (coreQueue?.page?.pending_count || 0);
  const current = available.find((item) => item.id === selected);
  const eligibleId = pending.find(
    (item) =>
      item.id !== activeInvitationId &&
      (!item.snoozed_until || Date.parse(item.snoozed_until) <= Date.now()),
  )?.id;
  const pendingKey = pending
    .map((item) => `${item.id}:${item.snoozed_until || ""}`)
    .join("|");
  useEffect(() => {
    if (
      proactive &&
      (hidden ||
        idleBlocked ||
        switchingDisabled ||
        !current ||
        current.status === "snoozed" ||
        current.status === "resolved")
    )
      close();
  }, [
    hidden,
    idleBlocked,
    switchingDisabled,
    current?.id,
    current?.status,
    proactive,
  ]);
  useEffect(() => {
    if (
      hidden ||
      idleBlocked ||
      switchingDisabled ||
      busy ||
      error ||
      open ||
      !eligibleId
    )
      return;
    let idleTimer: ReturnType<typeof setTimeout>;
    const key = `zhijun:reverb-reminder:${scope}`;
    const arm = () => {
      clearTimeout(idleTimer);
      if (document.visibilityState !== "visible" || !document.hasFocus())
        return;
      let reminded: { at: number; ids: string[] } = { at: 0, ids: [] };
      try {
        reminded =
          JSON.parse(sessionStorage.getItem(key) || "null") || reminded;
      } catch {
        /* A corrupt reminder cache can be rebuilt. */
      }
      const candidate = pending.find(
        (item) =>
          item.id !== activeInvitationId &&
          !reminded.ids.includes(item.id) &&
          (!item.snoozed_until || Date.parse(item.snoozed_until) <= Date.now()),
      );
      if (!candidate) return;
      idleTimer = setTimeout(
        () => {
          if (document.visibilityState !== "visible" || !document.hasFocus())
            return;
          sessionStorage.setItem(
            key,
            JSON.stringify({
              at: Date.now(),
              ids: [...reminded.ids, candidate.id],
            }),
          );
          setSelected(candidate.id);
          setProactive(true);
          setPinned(true);
          setOpen(true);
        },
        Math.max(
          REVERB_IDLE_MS,
          reminded.at ? reminded.at + REVERB_COOLDOWN_MS - Date.now() : 0,
        ),
      );
    };
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "focus",
      "blur",
    ];
    events.forEach((event) => window.addEventListener(event, arm));
    document.addEventListener("visibilitychange", arm);
    arm();
    return () => {
      clearTimeout(idleTimer);
      events.forEach((event) => window.removeEventListener(event, arm));
      document.removeEventListener("visibilitychange", arm);
    };
  }, [
    scope,
    hidden,
    idleBlocked,
    switchingDisabled,
    busy,
    error,
    open,
    eligibleId,
    pendingKey,
    activeInvitationId,
  ]);
  useEffect(() => {
    if (!proactive) return;
    const resume = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", resume);
    window.addEventListener("pointerdown", resume);
    window.addEventListener("blur", close);
    const visibility = () => {
      if (document.visibilityState !== "visible") close();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", resume);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("blur", close);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [proactive]);
  const choose = (item: UnderstandingInvitation) => {
    cancelClose();
    setPinned(true);
    setCoreSelected("");
    setSelected(item.id);
    setProactive(false);
    if (unreadInvitation(item)) onReview(item.id, "read");
  };
  const row = (item: UnderstandingInvitation) => (
    <button
      key={item.id}
      className="reverb-row"
      disabled={busy}
      onClick={() => choose(item)}
    >
      <span className="reverb-row-title">
        {unreadInvitation(item) && item.status !== "resolved" && (
          <i aria-label="未读" />
        )}
        {item.title}
      </span>
      <small>
        {item.source.filename}
        {item.status === "snoozed" ? " · 稍后聊" : ""}
      </small>
      <span className="reverb-row-arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
  if (hidden) return null;
  return (
    <div
      ref={root}
      className={`reverb${proactive ? " reverb-inviting" : ""}`}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={() => {
        if (!pinned) timer.current = setTimeout(() => setOpen(false), 220);
      }}
      onBlur={(event) => {
        if (!pinned && !root.current?.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="reverb-trigger"
        aria-label={`回响 · 知君小机器人${
          badgeCount ? `，${badgeCount} 项待处理` : ""
        }`}
        aria-expanded={open}
        aria-controls="reverb-panel"
        aria-haspopup="dialog"
        onFocus={() => {
          if (restoringFocus.current) {
            restoringFocus.current = false;
            return;
          }
          cancelClose();
          setOpen(true);
        }}
        onClick={() => {
          if (pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        <ZhijunRobot />
        <span>知君</span>
        {badgeCount > 0 && (
          <b className="reverb-badge">{badgeCount > 99 ? "99+" : badgeCount}</b>
        )}
      </button>
      {open && (
        <section
          id="reverb-panel"
          className="reverb-panel"
          role="dialog"
          aria-label="回响 · 理解与思考"
        >
          <header>
            <div>
              <small className="reverb-eyebrow">回响 · 理解与思考</small>
              <h2>{proactive ? "这会儿，想和你聊聊" : "有些话，想听你说"}</h2>
              <p>
                {proactive
                  ? "你有空的话，我们接着说这一件。"
                  : "值得留下的理解，由你来确认。"}
              </p>
            </div>
            <button aria-label="关闭回响" onClick={close}>
              ×
            </button>
          </header>
          <div className="reverb-content">
            {current ? (
              <div className="reverb-detail">
                {proactive && (
                  <p className="reverb-greeting" role="status">
                    我读到一处想问问你的地方。愿意聊聊吗？
                  </p>
                )}
                <button className="reverb-back" onClick={() => setSelected("")}>
                  ← 所有回响
                </button>
                <small className="reverb-source-label">
                  读到 · {current.source.filename}
                </small>
                <h3>{current.title}</h3>
                <p className="reverb-question">{current.question}</p>
                <details key={current.id}>
                  <summary>这段思考的原文</summary>
                  <blockquote>
                    <Markdown>{current.quote}</Markdown>
                  </blockquote>
                  <button
                    onClick={() =>
                      onSource(understandingReference(current.source))
                    }
                  >
                    查看完整来源 ↗
                  </button>
                </details>
                <div className="reverb-detail-actions">
                  <button
                    className="primary"
                    disabled={busy || switchingDisabled}
                    onClick={async () => {
                      setProactive(false);
                      if (await onDiscuss(current.id)) close();
                    }}
                  >
                    {current.discussion_thread_id ? "继续聊聊" : "聊聊"}
                  </button>
                  {current.status !== "resolved" && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => onReview(current.id, "later")}
                      >
                        稍后
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => onReview(current.id, "dismiss")}
                      >
                        不再提醒
                      </button>
                    </>
                  )}
                </div>
                {switchingDisabled && (
                  <small>这段对话或录音结束后，就可以打开话题。</small>
                )}
              </div>
            ) : (
              <>
                {coreQueue && onCoreDiscuss && (
                  <CoreCandidates
                    key={scope}
                    queue={coreQueue}
                    selectedId={coreSelected}
                    onSelect={setCoreSelected}
                    onDiscuss={async (claim) => {
                      const ok = await onCoreDiscuss(claim);
                      if (ok) close();
                      return ok;
                    }}
                    onSource={onSource}
                    switchingDisabled={switchingDisabled}
                  />
                )}
                {!coreSelected && (
                  <>
                    <div className="reverb-list-heading">
                      <span>值得聊聊</span>
                      <small>{pending.length} 条</small>
                    </div>
                    {pending.slice(pendingOffset, pendingOffset + 8).map(row)}
                    {pending.length > 8 && (
                      <div className="actions pagination">
                        <button
                          disabled={!pendingOffset}
                          onClick={() =>
                            setInvitationOffset(Math.max(0, pendingOffset - 8))
                          }
                        >
                          上一页
                        </button>
                        <span>第 {Math.floor(pendingOffset / 8) + 1} 页</span>
                        <button
                          disabled={pendingOffset + 8 >= pending.length}
                          onClick={() => setInvitationOffset(pendingOffset + 8)}
                        >
                          下一页
                        </button>
                      </div>
                    )}
                    {!pending.length && (
                      <p className="reverb-empty">
                        知君读到值得聊的思考，会留在这里。
                        <br />
                        你可以在想聊的时候再来。
                      </p>
                    )}
                    {completed.length > 0 && (
                      <details className="reverb-completed">
                        <summary>已交流 · {completed.length} 条</summary>
                        {completed.slice(0, completedLimit).map(row)}
                        {completedLimit < completed.length && (
                          <button
                            className="quiet"
                            onClick={() =>
                              setCompletedLimit((value) => value + 8)
                            }
                          >
                            查看更多已交流 ↗
                          </button>
                        )}
                      </details>
                    )}
                  </>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="reverb-error">
                {error}
                <button onClick={onRetry} disabled={busy}>
                  重新读取
                </button>
              </p>
            )}
            {!state && !error && <p className="reverb-empty">正在读取回响…</p>}
          </div>
        </section>
      )}
    </div>
  );
}
