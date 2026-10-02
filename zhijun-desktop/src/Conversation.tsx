import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  octopThreadsApi,
  type OctopThread,
} from "../../dashboard/src/api/modules/octopThreads";
import { useChat } from "../../dashboard/src/pages/Chat/hooks/useChat";
import {
  removeSession,
  setFocusedChatSession,
  onStreamEvent,
} from "../../dashboard/src/pages/Chat/hooks/chatStore";
import { useServerTimezone } from "../../dashboard/src/hooks/useServerTimezone";
import { formatServerDateTime } from "../../dashboard/src/utils/formatMessageTime";
import {
  recalledReferences,
  referencesByReply,
  referenceLabel,
  toolReferences,
  type MemoryReference,
} from "./references";
import { Notice } from "./App";
import { useAttachmentDraft, sourceStatus } from "./attachments";
import type { ChatAttachment } from "../../dashboard/src/pages/Chat/hooks/sseHelpers";
import {
  assistantReplyText,
  followUpQuestion,
  responseOptionsApi,
  responseOptionsByReply,
  type ResponseOptions,
} from "./responseOptions";
import { useTypewriter } from "./useTypewriter";
import { VoiceInput } from "./VoiceInput";
import {
  recordAssistedReply,
  coreApi,
  ontologyApi,
  isCandidate,
  isCore,
  type OntologyClaim,
} from "./ontology";
import { useCoreCandidates } from "./CoreCandidates";
import { OntologyTurn } from "./OntologyTurn";
import { ResponseChoicePanel } from "./ResponseChoicePanel";
import { Reverb } from "./Reverb";
import {
  understandingApi,
  understandingReference,
  useUnderstanding,
} from "./understanding";
import { TurnPresence, turnActivity, turnLabels } from "./TurnPresence";

export function Conversation({
  agentId,
  scope,
  blocked,
  prefill,
  selectedThread,
  onThread,
  onStreaming,
  onReferences,
  onSource,
  onAttachment,
  auxiliaryOpen = false,
}: {
  agentId: string;
  scope: string;
  blocked: boolean;
  prefill: {
    text: string;
    key: number;
    knowledge?: { id: string; name: string };
  } | null;
  selectedThread: { id: string | null; key: number } | null;
  onThread: (id: string | null) => void;
  onStreaming: (value: boolean) => void;
  onReferences: (refs: MemoryReference[]) => void;
  onSource: (ref: MemoryReference) => void;
  onAttachment?: (attachment: ChatAttachment) => void;
  auxiliaryOpen?: boolean;
}) {
  const [thread, setThread] = useState<OctopThread | null>(null);
  const [listing, setListing] = useState(true);
  const [listReady, setListReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [knowledge, setKnowledge] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [expressionNote, setExpressionNote] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [readingEarlier, setReadingEarlier] = useState(false);
  const [invitationId, setInvitationId] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const understanding = useUnderstanding(scope);
  const coreQueue = useCoreCandidates(scope);
  const [coreOpenRequest, setCoreOpenRequest] = useState<{
    key: number;
    id: string;
  }>();
  const [topicCore, setTopicCore] = useState<OntologyClaim | null>(null);
  useEffect(() => {
    const open = (e: Event) =>
      setCoreOpenRequest({
        key: Date.now(),
        id: (e as CustomEvent<string>).detail || "",
      });
    window.addEventListener("zhijun-open-core-queue", open);
    return () => window.removeEventListener("zhijun-open-core-queue", open);
  }, []);
  useEffect(() => {
    setCoreOpenRequest(undefined);
    setTopicCore(null);
  }, [scope]);
  useEffect(() => {
    let alive = true;
    if (!thread) setTopicCore(null);
    if (thread)
      void ontologyApi
        .get()
        .then((doc) => {
          if (alive)
            setTopicCore(
              doc.claims.find(
                (c) =>
                  c.discussion_thread_id === thread.thread_id &&
                  (isCandidate(c) || isCore(c)),
              ) || null,
            );
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [scope, thread?.thread_id, coreQueue.page?.revision]);
  const [returnThread, setReturnThread] = useState<{
    thread: OctopThread | null;
  } | null>(null);
  const navigation = useRef("");
  navigation.current = `${scope}:${selectedThread?.key ?? ""}:${
    thread?.thread_id ?? "new"
  }`;
  useEffect(() => {
    setReturnThread(null);
  }, [scope]);
  const [readyReply, setReadyReply] = useState<string | null>(null);
  const [choice, setChoice] = useState<{
    key: string;
    loading: boolean;
    invitation?: ResponseOptions;
    error: string;
  } | null>(null);
  const [openChoice, setOpenChoice] = useState<string | null>(null);
  const choiceRequest = useRef<AbortController | null>(null);
  const attemptedChoices = useRef(new Set<string>());
  const currentChoiceKey = useRef("");
  const mayOpenChoice = useRef(false);
  const liveTurn = useRef<{ threadId: string; priorIds: Set<string> } | null>(
    null,
  );
  const newThreadWithTurn = useRef<string | null>(null);
  const [, invalidateLiveReply] = useState(0);
  useEffect(
    () =>
      onStreamEvent((event) => {
        if (
          event.kind === "streamResume" &&
          event.sessionId === liveTurn.current?.threadId
        ) {
          liveTurn.current = null;
          invalidateLiveReply((value) => value + 1);
        }
      }),
    [],
  );
  const sending = useRef(false);
  const assistedDraft = useRef("");
  const visited = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const id of visited.current) removeSession(id);
    },
    [],
  );
  const flow = useRef<HTMLElement>(null);
  const following = useRef(true);
  const followReply = useCallback(() => {
    const node = flow.current;
    if (node && following.current) node.scrollTop = node.scrollHeight;
  }, []);
  const input = useRef<HTMLTextAreaElement>(null);
  const focusDraft = useRef(false);
  useEffect(() => {
    if (!openChoice && focusDraft.current) {
      focusDraft.current = false;
      input.current?.focus();
    }
  }, [openChoice, text]);
  const fileInput = useRef<HTMLInputElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!adding) return;
    const dismiss = (event: PointerEvent) => {
      if (!addMenu.current?.contains(event.target as Node)) setAdding(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAdding(false);
        addMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [adding]);
  const files = useAttachmentDraft(
    agentId,
    `${scope}:${thread?.thread_id ?? "new"}`,
  );
  const timezone = useServerTimezone();
  const chat = useChat(thread?.thread_id ?? null, agentId);
  const refs = useMemo(
    () => recalledReferences(thread ? chat.messages : []),
    [chat.messages, thread],
  );
  const replyRefs = useMemo(
    () => referencesByReply(thread ? chat.messages : []),
    [chat.messages, thread],
  );
  const threadKey = `zhijun:thread:${scope}`;
  const draftKey = `zhijun:draft:${scope}:${thread?.thread_id ?? "new"}`;
  const knowledgeKey = `${draftKey}:knowledge`;
  const invitationKey = `${draftKey}:invitation`;
  const loadHistory = chat.loadHistory;
  useEffect(() => {
    setReadingEarlier(false);
    let alive = true;
    setListing(true);
    setListReady(false);
    void octopThreadsApi
      .list(
        agentId,
        selectedThread || localStorage.getItem(threadKey) ? 10000 : 100,
      )
      .then(
        (rows) => {
          if (!alive) return;
          const savedId = localStorage.getItem(threadKey);
          const id = selectedThread ? selectedThread.id : savedId;
          const existing = id
            ? rows.find((row) => row.thread_id === id)
            : selectedThread || savedId !== null
            ? undefined
            : rows.find((row) => row.channel_type === "web");
          if (id && !existing) {
            setError("这段会话未找到，请在「对话」重新读取。");
            return;
          }
          setThread(existing ?? null);
          if (!existing) localStorage.setItem(threadKey, "");
          setListReady(true);
          setError("");
        },
        (e) => {
          if (alive) setError(e.message);
        },
      )
      .finally(() => {
        if (alive) setListing(false);
      });
    return () => {
      alive = false;
    };
  }, [agentId, threadKey, selectedThread, retry]);
  useEffect(() => {
    following.current = true;
    onThread(thread?.thread_id ?? null);
    if (thread) {
      visited.current.add(thread.thread_id);
      localStorage.setItem(threadKey, thread.thread_id);
      setFocusedChatSession(thread.thread_id);
      if (newThreadWithTurn.current === thread.thread_id)
        newThreadWithTurn.current = null;
      else {
        liveTurn.current = null;
        void loadHistory(thread.thread_id);
      }
    }
    return () => setFocusedChatSession(null);
  }, [thread?.thread_id, threadKey, loadHistory, onThread]);
  useEffect(() => {
    setText(localStorage.getItem(draftKey) || "");
    setInvitationId(localStorage.getItem(invitationKey) || "");
    setInvitationError("");
    assistedDraft.current = localStorage.getItem(`${draftKey}:origin`) || "";
    try {
      const stored = JSON.parse(localStorage.getItem(knowledgeKey) || "null");
      setKnowledge(
        stored &&
          typeof stored.id === "string" &&
          typeof stored.name === "string"
          ? stored
          : null,
      );
    } catch {
      setKnowledge(null);
    }
  }, [draftKey]);
  const topicInvitation = understanding.data?.invitations.find(
    (item) =>
      !!thread &&
      !!item.discussion_thread_id &&
      item.discussion_thread_id === thread.thread_id &&
      item.source_available !== false,
  );
  const boundInvitation = understanding.data?.invitations.find(
    (item) =>
      (item.id === invitationId || item.id === topicInvitation?.id) &&
      item.status === "active" &&
      item.source_available !== false,
  );
  const removeInvitation = () => {
    setInvitationId("");
    setInvitationError("");
    localStorage.removeItem(invitationKey);
  };
  useEffect(() => {
    if (!invitationId || !understanding.data) return;
    const current = understanding.data.invitations.find(
      (item) => item.id === invitationId,
    );
    if (
      !current ||
      current.status !== "active" ||
      current.source_available === false
    ) {
      setInvitationId("");
      localStorage.removeItem(invitationKey);
      setInvitationError("这条资料邀请已变化，已移除背景。你的草稿仍保留。");
    }
  }, [understanding.data, invitationId, invitationKey]);
  const reviewInvitation = async (
    id: string,
    action: "read" | "later" | "dismiss",
  ) => {
    if (!understanding.data || understanding.busy) return;
    await understanding.mutate(() =>
      understandingApi.review(id, understanding.data!.revision, action),
    );
  };
  const discussInvitation = async (id: string) => {
    if (
      !understanding.data ||
      understanding.busy ||
      blocked ||
      voiceBusy ||
      chat.isStreaming ||
      creating ||
      listing
    )
      return false;
    const intent = navigation.current;
    const origin = thread;
    let destination: OctopThread | null = null;
    const value = await understanding.mutate(async () => {
      const result = await understandingApi.conversation(
        id,
        understanding.data!.revision,
      );
      destination = result.thread;
      return result.state;
    });
    if (!value || !destination || navigation.current !== intent) return false;
    if (!topicInvitation) setReturnThread({ thread: origin });
    setInvitationError("");
    setOpenChoice(null);
    setThread(destination);
    return true;
  };
  const discussCore = async (claim: OntologyClaim) => {
    if (blocked || voiceBusy || chat.isStreaming || creating || listing)
      return false;
    const intent = navigation.current;
    const origin = thread;
    try {
      const result = await coreApi.conversation(claim);
      if (navigation.current !== intent) return false;
      if (!topicCore && !topicInvitation) setReturnThread({ thread: origin });
      setOpenChoice(null);
      setThread(result.thread);
      setTopicCore(result.claim);
      return true;
    } catch (e) {
      if (navigation.current === intent) setError((e as Error).message);
      return false;
    }
  };
  const draft = (value: string) => {
    if (!value.trim()) {
      assistedDraft.current = "";
      localStorage.removeItem(`${draftKey}:origin`);
    }
    setOpenChoice(null);
    setText(value);
    setExpressionNote("");
    localStorage.setItem(draftKey, value);
  };
  const chooseExpression = (value: string) => {
    if (sending.current) return;
    if (text.trim() || files.items.length || knowledge) {
      setExpressionNote("输入框里还有文字或资料，先处理它，再借用这个思路。");
      input.current?.focus();
      return;
    }
    focusDraft.current = true;
    draft(value);
    assistedDraft.current = value;
    localStorage.setItem(`${draftKey}:origin`, value);
  };
  useEffect(() => {
    if (blocked || chat.historyLoading || chat.historyRefreshing)
      liveTurn.current = null;
  }, [blocked, chat.historyLoading, chat.historyRefreshing]);
  useEffect(() => {
    if (!prefill) return;
    if (text.trim()) {
      setError("输入框已有草稿，请先处理它。待聊的话：" + prefill.text);
      return;
    }
    draft(prefill.text);
    removeInvitation();
    setKnowledge(prefill.knowledge ?? null);
    if (prefill.knowledge)
      localStorage.setItem(knowledgeKey, JSON.stringify(prefill.knowledge));
    else localStorage.removeItem(knowledgeKey);
    input.current?.focus();
  }, [prefill]);
  useEffect(() => {
    onStreaming(chat.isStreaming);
  }, [chat.isStreaming, onStreaming]);
  useEffect(() => {
    onReferences(refs);
  }, [refs, onReferences]);
  useEffect(() => {
    followReply();
  }, [chat.messages, creating, followReply]);
  const submit = async () => {
    const value = text.trim();
    const readyFiles = files.ready;
    if (
      (!value && !readyFiles.length) ||
      files.unresolved ||
      blocked ||
      voiceBusy ||
      sending.current ||
      chat.isStreaming ||
      chat.historyLoading ||
      chat.historyError ||
      !listReady ||
      listing
    )
      return;
    sending.current = true;
    following.current = true;
    setReadingEarlier(false);
    setCreating(true);
    setError("");
    try {
      const sendingInvitationId = boundInvitation?.id || invitationId;
      if (sendingInvitationId) {
        const actual = await understandingApi.get();
        if (
          !actual.invitations.some(
            (item) =>
              item.id === sendingInvitationId &&
              item.status === "active" &&
              item.source_available !== false,
          )
        ) {
          await understanding.refresh();
          throw new Error("资料邀请已变化，请核对后重新发送。你的草稿仍保留。");
        }
      }
      let target = thread;
      if (!target) {
        const row = await octopThreadsApi.create(agentId);
        target = {
          ...row,
          title: (value || readyFiles[0]?.filename || "一份资料").slice(0, 40),
          channel_type: "web",
          created_at: Date.now() / 1000,
          last_active: Date.now() / 1000,
        };
        newThreadWithTurn.current = target.thread_id;
        setThread(target);
      }
      liveTurn.current = {
        threadId: target.thread_id,
        priorIds: new Set(chat.messages.map((message) => message.id)),
      };
      choiceRequest.current?.abort();
      setOpenChoice(null);
      if (assistedDraft.current && value)
        await recordAssistedReply(
          target.thread_id,
          assistedDraft.current,
          value,
        );
      const args = [
        value,
        target.session_key,
        agentId,
        readyFiles.length ? readyFiles : undefined,
        target.thread_id,
      ] as const;
      if (sendingInvitationId) {
        chat.sendMessage(
          ...args,
          undefined,
          undefined,
          knowledge ? [knowledge.id] : undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          sendingInvitationId,
        );
      } else if (knowledge)
        chat.sendMessage(...args, undefined, undefined, [knowledge.id]);
      else chat.sendMessage(...args);
      draft("");
      setKnowledge(null);
      localStorage.removeItem(knowledgeKey);
      files.clear();
      removeInvitation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setCreating(false);
    }
  };
  const visible = thread ? chat.messages : [];
  const showWelcome =
    listReady &&
    !listing &&
    !thread &&
    !topicCore &&
    !topicInvitation &&
    !creating &&
    !error;
  const activity = turnActivity(visible, creating && !chat.isStreaming);
  const turnBusy =
    (creating || chat.isStreaming) && !activity.requiresDecision && !blocked;
  const optionsByReply = useMemo(
    () => responseOptionsByReply(visible),
    [chat.messages, thread],
  );
  const lastReply = [...visible]
    .reverse()
    .find(
      (message) =>
        message.role === "user" ||
        (message.role === "assistant" &&
          !message.toolData &&
          !message.hitlData &&
          assistantReplyText(message).trim()),
    );
  const choiceKey = `${scope}:${thread?.thread_id}:${lastReply?.id}`;
  currentChoiceKey.current = choiceKey;
  const canOfferChoices =
    lastReply?.role === "assistant" &&
    lastReply.status === "done" &&
    !blocked &&
    !voiceBusy &&
    !chat.isStreaming &&
    !creating &&
    !listing &&
    listReady &&
    !chat.historyLoading &&
    !chat.historyRefreshing &&
    !chat.historyError;
  const activeChoice = choice?.key === choiceKey ? choice : null;
  mayOpenChoice.current =
    !!canOfferChoices && !text.trim() && !files.items.length && !knowledge;
  useEffect(() => {
    followReply();
  }, [openChoice, activeChoice?.loading, followReply]);
  const nativeOptions = lastReply && optionsByReply.get(lastReply.id);
  const generateChoices = async (manual: boolean) => {
    if (!canOfferChoices || !thread || !lastReply) return;
    if (manual && (text.trim() || files.items.length || knowledge)) {
      setExpressionNote("输入框里还有文字或资料，先处理它，再借用这个思路。");
      input.current?.focus();
      return;
    }
    if (manual) setOpenChoice(choiceKey);
    if (activeChoice?.loading) return;
    if (nativeOptions || activeChoice?.invitation) {
      setChoice({
        key: choiceKey,
        loading: false,
        invitation: nativeOptions || activeChoice!.invitation,
        error: "",
      });
      if (!manual) setOpenChoice(choiceKey);
      return;
    }
    const controller = new AbortController();
    choiceRequest.current?.abort();
    choiceRequest.current = controller;
    setChoice({ key: choiceKey, loading: true, error: "" });
    try {
      const result = await responseOptionsApi.generate(
        thread.thread_id,
        assistantReplyText(lastReply),
        manual,
        controller.signal,
      );
      if (controller.signal.aborted || currentChoiceKey.current !== choiceKey)
        return;
      if (result.status === "ready" && result.invitation) {
        setChoice({
          key: choiceKey,
          loading: false,
          invitation: result.invitation,
          error: "",
        });
        if (!manual && mayOpenChoice.current && following.current)
          setOpenChoice(choiceKey);
      } else {
        const message =
          result.status === "not_needed"
            ? "这次先自由说说就好。"
            : result.status === "stale"
            ? "对话已经有了变化，请回到最新回答再试。"
            : "选项暂时没准备好，你可以自己说，也可以重试。";
        setChoice({ key: choiceKey, loading: false, error: message });
      }
    } catch (e) {
      if (!controller.signal.aborted && currentChoiceKey.current === choiceKey)
        setChoice({
          key: choiceKey,
          loading: false,
          error: (e as Error).message || "选项生成失败，请重试。",
        });
    }
  };
  useEffect(() => {
    return () => choiceRequest.current?.abort();
  }, [choiceKey]);
  useEffect(() => {
    if (
      !canOfferChoices ||
      !lastReply ||
      readyReply !== lastReply.id ||
      !liveTurn.current ||
      liveTurn.current.threadId !== thread?.thread_id ||
      liveTurn.current.priorIds.has(lastReply.id) ||
      attemptedChoices.current.has(choiceKey) ||
      (!nativeOptions && !followUpQuestion(assistantReplyText(lastReply)))
    )
      return;
    attemptedChoices.current.add(choiceKey);
    if (!text.trim() && !files.items.length && !knowledge && following.current)
      void generateChoices(false);
  }, [
    choiceKey,
    canOfferChoices,
    readyReply,
    text,
    knowledge,
    files.items.length,
  ]);
  const tools = visible.filter(
    (message) => message.toolData || message.role === "tool",
  );
  return (
    <>
      <Reverb
        scope={scope}
        coreQueue={coreQueue}
        onCoreDiscuss={discussCore}
        coreOpenRequest={coreOpenRequest}
        state={understanding.data}
        busy={understanding.busy}
        error={understanding.error}
        hidden={auxiliaryOpen}
        switchingDisabled={
          blocked || voiceBusy || chat.isStreaming || creating || listing
        }
        idleBlocked={
          !!text.trim() ||
          !!files.items.length ||
          !!knowledge ||
          adding ||
          !!openChoice ||
          readingEarlier
        }
        activeInvitationId={topicInvitation?.id}
        onReview={(id, action) => void reviewInvitation(id, action)}
        onDiscuss={discussInvitation}
        onSource={onSource}
        onRetry={() => void understanding.refresh()}
      />
      <main
        ref={flow}
        className="stream"
        aria-label="与知君的对话"
        onScroll={(event) => {
          const node = event.currentTarget;
          following.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 120;
          setReadingEarlier(!following.current);
        }}
      >
        {listing && <p className="muted">正在恢复往日对话…</p>}
        {error && (
          <Notice>
            {error}{" "}
            <button onClick={() => setRetry((n) => n + 1)}>重新读取</button>
          </Notice>
        )}
        {chat.historyError && (
          <Notice>
            历史未恢复，暂时不能发送。
            <button onClick={() => void chat.retryHistory()}>恢复历史</button>
          </Notice>
        )}
        {topicCore && !listing && (
          <article className="reverb-topic" aria-label="本体候选话题">
            <div className="reverb-topic-heading">
              <small>
                {isCore(topicCore)
                  ? "回响 · 已加入本体的理解"
                  : "回响 · 一项待你核对的理解"}
              </small>
              {returnThread && (
                <button
                  className="quiet"
                  onClick={() => {
                    setThread(returnThread.thread);
                    setReturnThread(null);
                    setTopicCore(null);
                  }}
                >
                  ← 返回原对话
                </button>
              )}
            </div>
            <h2>{topicCore.statement}</h2>
            <p className="muted">{topicCore.conditions}</p>
            <p className="muted fine">
              {isCore(topicCore)
                ? "已按你的确认加入本体。想调整时，可以继续在这里说。"
                : "先聊清楚最终表述，在这段对话里确认后，就会加入本体。"}
            </p>
          </article>
        )}
        {topicInvitation && !listing && (
          <article className="reverb-topic" aria-label="回响话题">
            <div className="reverb-topic-heading">
              <small>回响 · 来自资料的思考</small>
              {returnThread && (
                <button
                  disabled={chat.isStreaming || voiceBusy || creating}
                  onClick={() => {
                    if (returnThread.thread === null)
                      localStorage.setItem(threadKey, "");
                    setThread(returnThread.thread);
                    setReturnThread(null);
                    setInvitationError("");
                  }}
                >
                  ← 返回原对话
                </button>
              )}
            </div>
            <h2>{topicInvitation.title}</h2>
            <p>{topicInvitation.question}</p>
            <details>
              <summary>原文 · {topicInvitation.source.filename}</summary>
              <blockquote>
                <Markdown remarkPlugins={[remarkGfm]}>
                  {topicInvitation.quote}
                </Markdown>
              </blockquote>
              <button
                onClick={() =>
                  onSource(understandingReference(topicInvitation.source))
                }
              >
                查看完整来源 ↗
              </button>
            </details>
          </article>
        )}
        {showWelcome && (
          <div className="welcome conversation-welcome">
            <p className="eyebrow">知君 · 听你说</p>
            <h1>从此刻在意的事，聊起。</h1>
            <p>
              有些话，需要一个记得过去的地方。
              <br />
              今天发生了什么？
            </p>
            <div className="starters">
              <button onClick={() => draft("最近有一件事，我想和你慢慢聊聊。")}>
                说说近况
              </button>
              <button
                onClick={() =>
                  draft("我正在考虑一个重要选择，想一起看看我在意什么。")
                }
              >
                一起拿主意
              </button>
            </div>
          </div>
        )}
        {thread && chat.historyHasMore && (
          <button
            className="earlier"
            disabled={chat.historyLoadingMore}
            onClick={() => void chat.loadMoreHistory()}
          >
            更早的对话
          </button>
        )}
        {visible.map((message, index) => {
          const date = formatServerDateTime(
            message.timestamp / 1000,
            timezone,
          ).split(" ")[0];
          const previousDate = index
            ? formatServerDateTime(
                visible[index - 1].timestamp / 1000,
                timezone,
              ).split(" ")[0]
            : "";
          const content = !message.toolData ? assistantReplyText(message) : "";
          const live =
            liveTurn.current?.threadId === thread?.thread_id &&
            !liveTurn.current?.priorIds.has(message.id);
          if (message.hitlData?.status === "pending")
            return (
              <article key={message.id} className="hitl">
                <p>这一步需要你决定是否允许</p>
                {message.hitlData.action_requests.map((action, i) => (
                  <pre key={i}>
                    {action.name}
                    {"\n"}
                    {JSON.stringify(action.args, null, 2)}
                  </pre>
                ))}
                <button
                  onClick={() =>
                    chat.resumeHitl(
                      message.hitlData!.action_requests.map(() => ({
                        type: "approve",
                      })),
                      thread?.thread_id,
                    )
                  }
                >
                  允许本次
                </button>
                <button
                  onClick={() =>
                    chat.resumeHitl(
                      message.hitlData!.action_requests.map(() => ({
                        type: "reject",
                        message: "本人未允许本次操作",
                      })),
                      thread?.thread_id,
                    )
                  }
                >
                  不允许
                </button>
              </article>
            );
          if (message.toolData || message.role === "tool") return null;
          if (
            !content &&
            !message.attachments?.length &&
            message.status !== "error"
          )
            return null;
          return (
            <section key={message.id}>
              {date !== previousDate && (
                <div className="day-divider">{date}</div>
              )}
              <article className={`message ${message.role}`}>
                <span className="speaker">
                  {message.role === "user" ? "我" : "知"}
                </span>
                <div>
                  <ReplyText
                    id={message.id}
                    text={content}
                    streaming={message.status === "streaming"}
                    eligible={message.role === "assistant" && !!live}
                    onReady={
                      lastReply?.id === message.id
                        ? () => setReadyReply(message.id)
                        : undefined
                    }
                    onLayout={followReply}
                  />
                  {message.attachments?.map((attachment, i) => (
                    <button
                      key={`${attachment.workspacePath}:${i}`}
                      className="message-file"
                      onClick={() => onAttachment?.(attachment)}
                    >
                      {attachment.filename || "文件"} · 查看来源
                    </button>
                  ))}
                  {thread &&
                    message.role === "assistant" &&
                    message.status !== "streaming" &&
                    message.status !== "error" && (
                      <OntologyTurn
                        key={`${agentId}:${thread.thread_id}:${message.id}`}
                        threadId={thread.thread_id}
                        reply={content}
                        replyId={message.id}
                        latest={lastReply?.id === message.id}
                        onSource={onSource}
                      />
                    )}
                  {message.status === "error" && (
                    <Notice>
                      本次交谈未完成。先恢复历史核对，消息不会自动重发。
                      <button onClick={() => void chat.refreshHistory()}>
                        核对历史
                      </button>
                    </Notice>
                  )}
                  {replyRefs.get(message.id)?.length ? (
                    <details
                      className="reply-evidence"
                      aria-label="这次回答查阅的来源"
                    >
                      <summary>
                        查看依据 · {replyRefs.get(message.id)!.length}
                      </summary>
                      <div className="reply-sources">
                        {replyRefs.get(message.id)!.map((ref) => (
                          <button key={ref.path} onClick={() => onSource(ref)}>
                            {referenceLabel(ref)}
                          </button>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </article>
            </section>
          );
        })}
        {tools.length > 0 && (
          <details className="tool process">
            <summary>
              查看查阅过程
              {tools.some((message) => message.status === "error")
                ? " · 有步骤未完成"
                : ""}
            </summary>
            {tools.map((message) => (
              <details key={message.id}>
                <summary>
                  {message.toolData?.displayName ||
                    message.toolData?.name ||
                    "原生工具"}
                  {message.status === "error" ? " · 未完成" : ""}
                </summary>
                <pre>
                  {message.toolData?.output || message.content || "正在执行…"}
                </pre>
                <div className="reply-sources">
                  {toolReferences(message).map((ref) => (
                    <button key={ref.path} onClick={() => onSource(ref)}>
                      {referenceLabel(ref)}
                    </button>
                  ))}
                </div>
              </details>
            ))}
          </details>
        )}
        {turnBusy && (
          <TurnPresence
            phase={activity.phase}
            compact={activity.hasReply}
            preparing={creating && !chat.isStreaming}
            startedAt={chat.thinkingStartedAt}
            onStop={chat.cancelStream}
            onLayout={followReply}
          />
        )}
      </main>
      <div className="composer-wrap">
        {readingEarlier && (
          <div className="return-to-conversation">
            {turnBusy && (
              <span role="status">{turnLabels[activity.phase]}</span>
            )}
            <button
              onClick={() => {
                following.current = true;
                setReadingEarlier(false);
                followReply();
              }}
            >
              回到最新对话 ↓
            </button>
          </div>
        )}
        <div className="composer">
          {!boundInvitation && invitationError && (
            <p role="status" className="expression-note">
              {invitationError}
            </p>
          )}
          {canOfferChoices &&
            openChoice === choiceKey &&
            !text.trim() &&
            !files.items.length &&
            !knowledge && (
              <ResponseChoicePanel
                key={choiceKey}
                invitation={activeChoice?.invitation}
                loading={activeChoice?.loading ?? true}
                error={activeChoice?.error || ""}
                onClose={() => {
                  setOpenChoice(null);
                  choiceRequest.current?.abort();
                  if (activeChoice?.loading) setChoice(null);
                  input.current?.focus();
                }}
                onRetry={() => void generateChoices(true)}
                onDraft={chooseExpression}
              />
            )}
          {expressionNote && (
            <p className="expression-note" role="status">
              {expressionNote}
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="选择对话文件"
            onChange={(event) => {
              if (event.target.files?.length) files.add(event.target.files);
              event.target.value = "";
            }}
          />
          {files.items.length > 0 && (
            <div className="attachment-drafts" aria-label="待发送文件">
              {files.items.map((row) => (
                <article className="attachment-draft" key={row.id}>
                  <span>{row.file.name}</span>
                  <small>
                    {row.state === "uploading"
                      ? "正在上传…"
                      : row.state === "failed"
                      ? "上传未完成"
                      : "已上传 · 尚未发送"}
                  </small>
                  {row.extractionStatus && (
                    <small>
                      {sourceStatus[row.extractionStatus] ||
                        row.extractionStatus}
                    </small>
                  )}
                  {row.error && <span role="alert">{row.error}</span>}
                  <div className="actions">
                    {row.state === "failed" && (
                      <button onClick={() => files.retry(row)}>
                        重试上传 {row.file.name}
                      </button>
                    )}
                    <button
                      aria-label={`移除 ${row.file.name}`}
                      onClick={() => files.remove(row.id)}
                    >
                      移除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {knowledge && (
            <div className="draft-knowledge">
              <span>这次参考 · {knowledge.name}</span>
              <button
                aria-label="移除本次资料库"
                onClick={() => {
                  setKnowledge(null);
                  localStorage.removeItem(knowledgeKey);
                }}
              >
                ×
              </button>
            </div>
          )}
          <textarea
            ref={input}
            aria-label="想说的话"
            placeholder="慢慢说，我在听…"
            rows={2}
            value={text}
            readOnly={voiceBusy || creating}
            onChange={(e) => draft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="composer-foot">
            <div className="add-menu" ref={addMenu}>
              <button
                className="composer-icon"
                aria-label="添加到对话"
                aria-expanded={adding}
                aria-controls="conversation-add-menu"
                title="添加到对话"
                disabled={
                  blocked ||
                  voiceBusy ||
                  creating ||
                  listing ||
                  !listReady ||
                  chat.isStreaming
                }
                onClick={() => setAdding((v) => !v)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              {adding && (
                <div className="add-options" id="conversation-add-menu">
                  <button
                    onClick={() => {
                      setAdding(false);
                      fileInput.current?.click();
                    }}
                  >
                    <span>添加附件</span>
                    <small>带着一份资料，接着聊</small>
                  </button>
                </div>
              )}
            </div>
            {canOfferChoices && (
              <button
                className="choice-trigger"
                aria-label="帮我选着说"
                aria-controls="response-choice-panel"
                aria-expanded={openChoice === choiceKey}
                title="给我几个思路，仍由我自己表达"
                onClick={() => {
                  if (openChoice === choiceKey) {
                    setOpenChoice(null);
                    choiceRequest.current?.abort();
                    if (activeChoice?.loading) setChoice(null);
                  } else void generateChoices(true);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m4 7 2 2 3-4M12 7h8m-16 9 2 2 3-4m3 2h8" />
                </svg>
                {activeChoice?.loading ? "正在准备选项…" : "选着说"}
              </button>
            )}
            <VoiceInput
              contextKey={draftKey}
              disabled={
                blocked ||
                creating ||
                listing ||
                !listReady ||
                chat.historyLoading ||
                !!chat.historyError ||
                chat.isStreaming
              }
              onBusyChange={setVoiceBusy}
              onTranscript={(value) => {
                draft(text.trim() ? `${text}\n${value}` : value);
                input.current?.focus();
              }}
            />
            {chat.isStreaming ? (
              <button
                className="send"
                aria-label="停止回答"
                title="停止回答"
                onClick={chat.cancelStream}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="8" height="8" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                className="send"
                aria-label="发送"
                disabled={
                  (!text.trim() && !files.ready.length) ||
                  files.unresolved ||
                  blocked ||
                  voiceBusy ||
                  creating ||
                  listing ||
                  chat.historyLoading ||
                  !listReady ||
                  !!chat.historyError
                }
                onClick={() => void submit()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 19V5m-6 6 6-6 6 6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function ReplyText({
  id,
  text,
  streaming,
  eligible,
  onReady,
  onLayout,
}: {
  id: string;
  text: string;
  streaming: boolean;
  eligible: boolean;
  onReady?: () => void;
  onLayout?: () => void;
}) {
  const typing = useTypewriter({ id, text, streaming, eligible });
  useEffect(() => {
    onLayout?.();
  }, [typing.displayedText, typing.isRevealing, onLayout]);
  useEffect(() => {
    if (!streaming && !typing.isRevealing) onReady?.();
  }, [streaming, typing.isRevealing, onReady]);
  return (
    <>
      <div className="reply-body">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{ a: ({ children }) => <span>{children}</span> }}
        >
          {typing.displayedText}
        </Markdown>
        {typing.isRevealing && (
          <span className="typing-cursor" aria-hidden="true" />
        )}
      </div>
      {typing.isRevealing && (
        <button className="reveal-reply" onClick={typing.revealAll}>
          立即显示
        </button>
      )}
    </>
  );
}
