import { ThreadDeletion } from "./MemoryMaintenance";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CHAT_HISTORY_PAGE_SIZE,
  octopThreadsApi,
  type OctopThread,
} from "../../dashboard/src/api/modules/octopThreads";
import { useServerTimezone } from "../../dashboard/src/hooks/useServerTimezone";
import {
  formatMessageTime,
  formatServerDateTime,
  resolveMessageTimestampMs,
} from "../../dashboard/src/utils/formatMessageTime";
import {
  extractText,
  filterDialogueHistoryMessages,
} from "../../dashboard/src/utils/messageParser";
import { Notice } from "./App";
import { Pages, State, useResource } from "./memoryUi";

import { ActionIcon } from "./ActionIcon";
import { useConversationPreviews } from "./useConversationPreviews";

const channelLabels: Record<string, string> = {
  dashboard: "网页",
  ui: "网页",
  web: "网页",
  weixin: "微信",
  wechat: "微信",
  wecom: "企业微信",
  feishu: "飞书",
  dingtalk: "钉钉",
  telegram: "Telegram",
  slack: "Slack",
  discord: "Discord",
  cli: "命令行",
  cron: "定时任务",
  im: "即时通讯",
};
function channelName(channel: string) {
  return channelLabels[channel] || channel || "未标注渠道";
}

export function ConversationRecords({
  agentId,
  current = null,
  onSelect,
  onNew,
  disabled = false,
  onDeleted,
}: {
  agentId: string;
  current?: string | null;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  disabled?: boolean;
  onDeleted?: (id: string) => void;
}) {
  const [limit, setLimit] = useState(100);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<OctopThread | null>(null);
  const timezone = useServerTimezone();
  const data = useResource(`${agentId}:${limit}`, () =>
    octopThreadsApi.list(agentId, limit),
  );
  const channels = [
    ...new Set((data.data || []).map((row) => channelName(row.channel_type))),
  ];
  const rows = (data.data || [])
    .filter(
      (row) =>
        (!channel || channelName(row.channel_type) === channel) &&
        (row.title || "未命名对话")
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => b.last_active - a.last_active);
  const visible = rows.slice(offset, offset + 10);
  useEffect(() => {
    if (data.data && offset > 0 && offset >= rows.length)
      setOffset(Math.max(0, Math.floor((rows.length - 1) / 10) * 10));
  }, [data.data, rows.length, offset]);
  const preview = useConversationPreviews(
    agentId,
    selected ? [] : visible,
    data.data,
  );
  if (selected)
    return (
      <ConversationRecordHistory
        key={`${agentId}:${selected.thread_id}`}
        agentId={agentId}
        thread={selected}
        onBack={() => setSelected(null)}
        onSelect={onSelect}
        disabled={disabled}
      />
    );
  return (
    <section className="conversation-records" aria-label="聊过的对话">
      <p className="panel-intro">聊过的事，随时回来接着说。</p>
      <div className="conversation-toolbar">
        {onNew && (
          <button className="primary" disabled={disabled} onClick={onNew}>
            开启新对话
          </button>
        )}
        <button
          className="quiet-icon"
          aria-label="刷新对话"
          title="刷新对话"
          disabled={data.loading}
          onClick={data.refresh}
        >
          <ActionIcon name="refresh" />
        </button>
      </div>
      {disabled && (
        <p className="muted fine">稍后再开启或切换对话，原文仍可回看。</p>
      )}
      <div className="record-toolbar">
        <input
          aria-label="查找对话"
          placeholder="输入标题中的字词"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <select
          aria-label="对话渠道"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">全部渠道</option>
          {channels.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <State resource={data} />
      {data.data && (
        <>
          <p className="muted fine">
            {query || channel ? `找到 ${rows.length} 段对话` : "最近聊过"}
          </p>
          <div className="record-list">
            {visible.map((row) => {
              const excerpt = preview(row);
              const title = row.title || "未命名对话";
              return (
                <article
                  className={`record-row${
                    row.thread_id === current ? " is-current" : ""
                  }`}
                  key={row.thread_id}
                >
                  <div className="record-row-title">
                    {onSelect ? (
                      <button
                        className="conversation-title"
                        aria-label={`接着聊：${title}`}
                        aria-pressed={row.thread_id === current}
                        disabled={disabled}
                        onClick={() => onSelect(row.thread_id)}
                      >
                        <span>{title}</span>
                        <span
                          className="conversation-continue"
                          aria-hidden="true"
                        >
                          接着聊 ↗
                        </span>
                      </button>
                    ) : (
                      <h3>{title}</h3>
                    )}
                    <div className="conversation-excerpt">
                      {row.has_messages === false ? (
                        "还没开始说，随时可以聊起。"
                      ) : excerpt?.status === "ready" ? (
                        <>
                          <span>
                            {excerpt.role === "user" ? "你说：" : "知君："}
                          </span>
                          <Markdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => <>{children}</>,
                              a: ({ children }) => <span>{children}</span>,
                              img: ({ alt }) => (
                                <span>[图片：{alt || "附件"}]</span>
                              ),
                            }}
                          >
                            {excerpt.text}
                          </Markdown>
                        </>
                      ) : excerpt?.status === "pending" ? (
                        "原文正在整理，稍后可回看。"
                      ) : excerpt ? (
                        "打开原文，找回当时的对话。"
                      ) : (
                        "正在读上次聊到的话…"
                      )}
                    </div>
                  </div>
                  <div className="conversation-meta">
                    <span className="record-channel">
                      {channelName(row.channel_type)}
                    </span>
                    {row.thread_id === current && (
                      <span className="conversation-current">正在聊</span>
                    )}
                    <time>
                      {formatServerDateTime(
                        row.last_active || row.created_at,
                        timezone,
                      )}
                    </time>
                    <button
                      aria-label={`查看原文：${title}`}
                      onClick={() => setSelected(row)}
                    >
                      查看原文
                    </button>
                  </div>
                  <ThreadDeletion
                    agentId={agentId}
                    id={row.thread_id}
                    title={title}
                    disabled={disabled}
                    onDeleted={() => {
                      data.refresh();
                      onDeleted?.(row.thread_id);
                      if (row.thread_id === current) onNew?.();
                    }}
                  />
                </article>
              );
            })}
          </div>
          {!rows.length && (
            <p className="muted">
              {query || channel
                ? "已读取的对话中没有找到，换个词试试，或读取更早的对话。"
                : "还没有聊过的事，从眼下在意的开始吧。"}
            </p>
          )}
          {rows.length > 10 && (
            <Pages
              offset={offset}
              step={10}
              more={offset + 10 < rows.length}
              onChange={setOffset}
            />
          )}
          {data.data.length >= limit && (
            <button
              disabled={data.loading}
              onClick={() => setLimit((n) => n + 100)}
            >
              读取更早的对话
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ConversationRecordHistory({
  agentId,
  thread,
  onBack,
  onSelect,
  disabled,
}: {
  agentId: string;
  thread: OctopThread;
  onBack: () => void;
  onSelect?: (id: string) => void;
  disabled?: boolean;
}) {
  const timezone = useServerTimezone();
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const data = useResource(
    `${agentId}:${thread.thread_id}:${page}`,
    async () => {
      const result = await octopThreadsApi.history(agentId, thread.thread_id, {
        limit: CHAT_HISTORY_PAGE_SIZE,
        offset: page * CHAT_HISTORY_PAGE_SIZE,
        cursor: cursors[page],
      });
      if (result.thread_id !== thread.thread_id)
        throw new Error("对话归属未核实，请重新读取。");
      return result;
    },
  );
  const pending =
    data.data?.history_loading && data.data.history_status !== "failed";
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(
      data.refresh,
      data.data?.history_retry_after_ms || 1500,
    );
    return () => window.clearTimeout(timer);
  }, [pending, data.data]);
  const messages = filterDialogueHistoryMessages(data.data?.messages || []);
  return (
    <section className="record-history" aria-label="对话记录内容">
      <button className="panel-back" onClick={onBack}>
        ← 返回对话
      </button>
      <header className="record-history-head">
        <span className="record-channel">
          {channelName(thread.channel_type)}
        </span>
        <h3>{thread.title || "未命名对话"}</h3>
        {onSelect && (
          <button
            className="primary"
            disabled={disabled}
            onClick={() => onSelect(thread.thread_id)}
          >
            接着聊
          </button>
        )}
      </header>
      <div className="actions record-history-actions">
        <button
          disabled={data.loading || page === 0}
          onClick={() => setPage((n) => n - 1)}
        >
          较近的记录
        </button>
        <button
          disabled={data.loading || !!pending || !data.data?.has_more}
          onClick={() => {
            setCursors((values) => {
              const next = [...values];
              next[page + 1] = data.data!.next_cursor || null;
              return next;
            });
            setPage((n) => n + 1);
          }}
        >
          更早的记录
        </button>
        <span className="muted fine">第 {page + 1} 段记录</span>
        <button disabled={data.loading} onClick={data.refresh}>
          刷新内容
        </button>
      </div>
      <State resource={data} />
      {pending && <p className="muted">正在读取这段对话的历史记录…</p>}
      {data.data?.history_status === "failed" && (
        <Notice>历史记录尚未整理完成，请稍后重新读取。</Notice>
      )}
      {data.data && !pending && data.data.history_status !== "failed" && (
        <>
          {messages.map((message, index) => {
            const text = extractText(message.content);
            const timestamp = resolveMessageTimestampMs(message.timestamp);
            return (
              <article
                className="record-message"
                data-role={message.role}
                key={message.id || `${page}:${index}`}
              >
                <header>
                  <span>{message.role === "user" ? "我" : "知君"}</span>
                  {timestamp > 0 && (
                    <time>{formatMessageTime(timestamp, timezone)}</time>
                  )}
                </header>
                {text ? (
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({ alt }) => <span>[图片：{alt || "附件"}]</span>,
                    }}
                  >
                    {text}
                  </Markdown>
                ) : (
                  <p className="muted">这条记录包含图片或文件附件。</p>
                )}
              </article>
            );
          })}
          {!messages.length && (
            <p className="muted">这段记录中没有对话正文。</p>
          )}
        </>
      )}
    </section>
  );
}
