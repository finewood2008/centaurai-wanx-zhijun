import "./digitalSelf.css";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiErrorMessage } from "../../dashboard/src/utils/apiError";
import { useServerTimezone } from "../../dashboard/src/hooks/useServerTimezone";
import { formatServerIsoDateTime } from "../../dashboard/src/utils/formatMessageTime";
import {
  digitalSelfApi as api,
  readSelfHistory,
  type SelfState,
  type SelfDraft,
  type SelfEntry,
  type SelfCard,
  type SelfHistory,
  type SelfMessage,
  type SelfReply,
  type PublishedEntry,
  type SelfSource,
} from "./digitalSelfApi";
import { Pages, State, useResource } from "./memoryUi";
import { DeleteContent } from "./MemoryMaintenance";
import { VoiceInput } from "./VoiceInput";
import { useTypewriter } from "./useTypewriter";

function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run<T>(action: () => Promise<T>, success: (value: T) => void) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await action();
      if (alive.current) success(value);
      return true;
    } catch (e) {
      if (alive.current)
        setError(apiErrorMessage(e, "操作未完成，请重新读取后核对。"));
      return false;
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return { busy, error, run };
}
function Failure({ error }: { error: string }) {
  return error ? (
    <p className="notice" role="alert">
      {error}
    </p>
  ) : null;
}
function Prose({ text }: { text: string }) {
  return (
    <div className="self-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span className="muted">[{alt || "图片"}]</span>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
const accessLabels: Record<string, string> = {
  none: "需要申请",
  pending: "等待本人审批",
  approved: "可以交流",
  rejected: "申请未通过",
  revoked: "访问已撤销",
};

export function DigitalSelf({ userId }: { userId: number }) {
  const [tab, setTab] = useState<"discover" | "owner">("discover");
  return (
    <section className="digital-self" key={userId}>
      <div className="view-tabs" role="tablist" aria-label="分身浏览方式">
        <button
          role="tab"
          aria-selected={tab === "discover"}
          onClick={() => setTab("discover")}
        >
          发现
        </button>
        <button
          role="tab"
          aria-selected={tab === "owner"}
          onClick={() => setTab("owner")}
        >
          我的分身
        </button>
      </div>
      <p className="muted fine self-network">
        当前可发现同一服务内的知君用户。跨设备发现与交流尚未开放。
      </p>
      {tab === "owner" ? (
        <OwnerSelf key={userId} />
      ) : (
        <DiscoverSelf key={userId} />
      )}
    </section>
  );
}

function SourcePicker({
  onAdd,
  disabled,
}: {
  onAdd: (entry: SelfEntry) => void;
  disabled: boolean;
}) {
  const [kind, setKind] = useState<SelfSource["kind"]>("ontology");
  const [offset, setOffset] = useState(0);
  const [kb, setKb] = useState("");
  const [document, setDocument] = useState("");
  const [start, setStart] = useState(0);
  const resource = useResource(
    `${kind}:${offset}:${kb}:${document}:${start}`,
    () =>
      api.sources({ kind, offset, kb_id: kb, document_id: document, start }),
  );
  return (
    <details className="self-section">
      <summary>从我的资料中选择内容</summary>
      <p className="muted fine">
        只选入你看到的片段。选入不等于发布，每一项表述仍由你改写、认可。
      </p>
      <div className="actions">
        <label>
          来源
          <select
            aria-label="选择分身来源"
            value={kind}
            disabled={disabled}
            onChange={(e) => {
              setKind(e.target.value as SelfSource["kind"]);
              setOffset(0);
              setKb("");
              setDocument("");
              setStart(0);
            }}
          >
            <option value="ontology">个人本体</option>
            <option value="memory">记忆</option>
            <option value="episode">经历</option>
            <option value="knowledge">知识库</option>
          </select>
        </label>
        {kind === "knowledge" && (
          <label>
            资料库
            <select
              value={kb}
              onChange={(e) => {
                setKb(e.target.value);
                setOffset(0);
                setDocument("");
                setStart(0);
              }}
            >
              <option value="">选择资料库</option>
              {resource.data?.libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <State resource={resource} />
      {resource.data?.items.map((source) => (
        <article className="self-source" key={source.id}>
          <h4>{source.title}</h4>
          <p className="muted fine">
            {source.needs_review ? "需要本人审阅与认领" : "本人自述或已核对"}
            {source.total_chars > 0 &&
              ` · 当前片段 ${source.text.length} / ${source.total_chars} 字`}
          </p>
          <details>
            <summary>阅读所选原文</summary>
            <Prose text={source.text} />
          </details>
          <div className="actions">
            <button
              disabled={disabled}
              onClick={() =>
                onAdd({
                  id: crypto.randomUUID(),
                  title: source.title,
                  text: source.text,
                  source,
                  recognized: false,
                })
              }
            >
              选入草稿
            </button>
            {source.next_start != null && (
              <button
                onClick={() => {
                  setDocument(source.id.split(":")[1]);
                  setStart(source.next_start!);
                }}
              >
                继续读后续正文
              </button>
            )}
            {document && (
              <button
                onClick={() => {
                  setDocument("");
                  setStart(0);
                }}
              >
                返回文件列表
              </button>
            )}
          </div>
        </article>
      ))}
      {!resource.loading && !resource.error && !resource.data?.items.length && (
        <p className="muted">
          这个范围还没有可选内容。也可以先写一条自己的方法。
        </p>
      )}
      {!document && (
        <Pages
          offset={offset}
          step={20}
          more={resource.data?.has_more ?? false}
          onChange={setOffset}
        />
      )}
    </details>
  );
}

function OwnerSelf() {
  const [state, setState] = useState<SelfState | null>(null);
  const [draft, setDraft] = useState<SelfDraft | null>(null);
  const [question, setQuestion] = useState("");
  const [preview, setPreview] = useState<SelfReply | null>(null);
  const [visitor, setVisitor] = useState<number | null>(null);
  const [visitorHistory, setVisitorHistory] = useState<SelfHistory | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const task = useTask();
  const timezone = useServerTimezone();
  const accept = (value: SelfState) => {
    setState(value);
    setDraft(structuredClone(value.draft));
  };
  useEffect(() => {
    void task.run(api.me, accept);
  }, []);
  const dirty =
    !!state && !!draft && JSON.stringify(state.draft) !== JSON.stringify(draft);
  const update = (patch: Partial<SelfDraft>) => {
    setDraft((prev) => prev && { ...prev, ...patch });
    setPreview(null);
    setNotice("");
  };
  const edit = (id: string, patch: Partial<SelfEntry>) =>
    update({
      entries: draft!.entries.map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      ),
    });
  const command = (
    action: "save" | "generate" | "publish" | "pause" | "unpublish",
  ) =>
    task.run(
      () =>
        api.update(
          state!.revision,
          action,
          ["save", "generate", "publish"].includes(action) ? draft! : undefined,
        ),
      (value) => {
        accept(value);
        setPreview(null);
        setNotice(
          action === "publish"
            ? "已发布这个版本。之后的新私人记忆不会自动加入。"
            : action === "save"
            ? "草稿已保存，尚未改变对外版本。"
            : action === "generate"
            ? "已形成草稿，请逐项审阅。"
            : action === "pause"
            ? "分身已暂停交流。"
            : "已停止发布。访客仍可清理自己的既有记录。",
        );
      },
    );
  if (!state || !draft)
    return (
      <>
        <Failure error={task.error} />
        <p className="muted">
          {task.busy ? "正在读取我的分身…" : "我的分身尚未读取。"}
        </p>
        <button
          disabled={task.busy}
          onClick={() => void task.run(api.me, accept)}
        >
          重新读取
        </button>
      </>
    );
  const add = (entry: SelfEntry) => {
    if (
      draft.entries.length >= 30 ||
      (entry.source &&
        draft.entries.some(
          (e) =>
            e.source?.id === entry.source?.id &&
            e.source?.version === entry.source?.version,
        ))
    )
      return;
    update({ entries: [...draft.entries, entry] });
  };
  return (
    <div className="self-owner">
      <header className="self-section-heading">
        <div>
          <h3>让经验与判断，成为可交流的分身</h3>
          <p className="muted">
            {state.status === "published"
              ? "已发布"
              : state.status === "paused"
              ? "已暂停"
              : "未发布"}
            {dirty ? " · 草稿有未保存修改" : ""}
          </p>
        </div>
        <button
          className="quiet-action"
          disabled={task.busy}
          onClick={() => void task.run(api.me, accept)}
        >
          {dirty ? "放弃修改并重新读取" : "重新读取"}
        </button>
      </header>
      <p className="muted fine">
        私人聊天与工作区规则始终留在私人档案。发布内容由你逐项认可，访客的话不会写进你的个人本体。
      </p>
      <Failure error={task.error} />
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      <div className="self-fields">
        <label>
          对外名称
          <input
            maxLength={60}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>
        <label>
          简介
          <textarea
            rows={3}
            maxLength={600}
            value={draft.bio}
            onChange={(e) => update({ bio: e.target.value })}
            placeholder="我有哪些经验，能帮助别人讨论什么"
          />
        </label>
        <label>
          擅长话题
          <input
            value={draft.topics.join("、")}
            onChange={(e) =>
              update({
                topics: e.target.value
                  .split(/[、,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 8),
              })
            }
            placeholder="最多八个，用顿号分隔"
          />
        </label>
      </div>
      <details className="self-section">
        <summary>交流方式、范围与推荐问题</summary>
        <div className="self-fields">
          <label>
            希望分身怎样交流
            <textarea
              rows={3}
              maxLength={800}
              value={draft.style}
              onChange={(e) => update({ style: e.target.value })}
            />
          </label>
          <label>
            不回答的范围
            <textarea
              rows={3}
              maxLength={1200}
              value={draft.boundaries}
              onChange={(e) => update({ boundaries: e.target.value })}
            />
          </label>
          <label>
            推荐问题
            <textarea
              rows={3}
              value={draft.questions.join("\n")}
              onChange={(e) =>
                update({
                  questions: e.target.value
                    .split("\n")
                    .filter(Boolean)
                    .slice(0, 3),
                })
              }
              placeholder="一行一个，最多三个；点选后由访客编辑、发送"
            />
          </label>
        </div>
      </details>
      <section className="self-section">
        <div className="self-section-heading">
          <h3>对外内容 · {draft.entries.length} 项</h3>
          <button
            disabled={task.busy || draft.entries.length >= 30}
            onClick={() =>
              add({
                id: crypto.randomUUID(),
                title: "我的方法",
                text: "",
                source: null,
                recognized: false,
              })
            }
          >
            写一条自己的方法
          </button>
        </div>
        <SourcePicker
          onAdd={add}
          disabled={task.busy || draft.entries.length >= 30}
        />
        {draft.entries.map((entry) => (
          <details className="self-entry" key={entry.id} open={!entry.text}>
            <summary>
              {entry.title || "待命名内容"}
              <span className="muted fine">
                {entry.recognized ? "已认可" : "待审阅"}
              </span>
            </summary>
            <div className="self-fields">
              <label>
                标题
                <input
                  maxLength={160}
                  value={entry.title}
                  onChange={(e) =>
                    edit(entry.id, { title: e.target.value, recognized: false })
                  }
                />
              </label>
              <label>
                对外表述
                <textarea
                  rows={5}
                  maxLength={6000}
                  value={entry.text}
                  onChange={(e) =>
                    edit(entry.id, { text: e.target.value, recognized: false })
                  }
                />
              </label>
            </div>
            {entry.source?.kind === "ontology" &&
              entry.source.needs_review &&
              entry.text === entry.source.text && (
                <p className="muted fine">
                  这项理解尚未核对，请先改写成你认可的对外表述。
                </p>
              )}
            {entry.source && (
              <details>
                <summary>
                  核对选入的依据
                  {entry.source.needs_review ? " · 原内容待核对" : ""}
                </summary>
                <Prose text={entry.source.text} />
              </details>
            )}
            <div className="self-section-heading">
              <label className="self-check">
                <input
                  type="checkbox"
                  checked={entry.recognized}
                  disabled={
                    entry.source?.kind === "ontology" &&
                    entry.source.needs_review &&
                    entry.text === entry.source.text
                  }
                  onChange={(e) =>
                    edit(entry.id, { recognized: e.target.checked })
                  }
                />
                我认可这项对外表述及其适用范围
              </label>
              <button
                className="quiet-icon"
                aria-label={`移出草稿：${entry.title}`}
                title="移出草稿；确认发布后对外生效"
                onClick={() =>
                  update({
                    entries: draft.entries.filter((e) => e.id !== entry.id),
                  })
                }
              >
                ×
              </button>
            </div>
          </details>
        ))}
        <p className="muted fine">
          编辑、移除与 AI
          整理只改变草稿。保存后可以试聊，确认发布才更新对外版本。
        </p>
        <div className="actions">
          <button disabled={task.busy} onClick={() => void command("save")}>
            保存草稿
          </button>
          <button
            disabled={task.busy || !draft.entries.length}
            onClick={() => void command("generate")}
          >
            AI 整理表达草稿
          </button>
        </div>
        <p className="muted fine">
          AI 整理与试聊使用你的当前模型；在线模型会处理所选片段。
        </p>
      </section>
      <details className="self-section">
        <summary>以访客身份试聊</summary>
        <label>
          试聊问题
          <textarea
            value={question}
            maxLength={4000}
            rows={3}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <button
          disabled={
            task.busy || dirty || !question.trim() || !draft.entries.length
          }
          onClick={() =>
            void task.run(
              () => api.preview(state.revision, question),
              setPreview,
            )
          }
        >
          试聊已保存的草稿
        </button>
        {dirty && <p className="muted fine">请先保存修改，再试聊。</p>}
        {preview && (
          <>
            <Prose text={preview.answer} />
            <details>
              <summary>
                本次提供的对外内容 ·{" "}
                {(preview.context_sources || preview.sources).length}
              </summary>
              {(preview.context_sources || preview.sources).map((id) => (
                <p key={id}>
                  {draft.entries.find((e) => e.id === id)?.title || id}
                </p>
              ))}
            </details>
          </>
        )}
      </details>
      <details className="self-section" open={!state.publication}>
        <summary>访问规则与额度</summary>
        <div className="self-fields">
          <label>
            访问方式
            <select
              value={draft.access}
              onChange={(e) =>
                update({ access: e.target.value as SelfDraft["access"] })
              }
            >
              <option value="approval">本人审批后交流</option>
              <option value="open">开放交流</option>
            </select>
          </label>
          <label>
            每位访客每日轮数
            <input
              type="number"
              min={1}
              max={10}
              value={draft.visitor_daily_limit}
              onChange={(e) =>
                update({
                  visitor_daily_limit: Math.max(
                    1,
                    Math.min(10, Number(e.target.value)),
                  ),
                })
              }
            />
          </label>
          <label>
            分身每日总轮数
            <input
              type="number"
              min={1}
              max={100}
              value={draft.daily_limit}
              onChange={(e) =>
                update({
                  daily_limit: Math.max(
                    1,
                    Math.min(100, Number(e.target.value)),
                  ),
                })
              }
            />
          </label>
        </div>
        <p className="muted fine">
          免费交流，模型用量由你承担。同一时间接待一位访客。额度按服务端日期统计，请求进入模型前计入，未知结果不自动重试。
        </p>
      </details>
      <div className="actions self-publish">
        <button
          className="primary"
          disabled={
            task.busy ||
            !draft.name.trim() ||
            !draft.bio.trim() ||
            !draft.entries.length ||
            draft.entries.some((e) => !e.recognized || !e.text.trim())
          }
          onClick={() => void command("publish")}
        >
          {state.publication ? "确认发布新版本" : "确认发布"}
        </button>
        {state.publication && (
          <>
            <button
              disabled={task.busy || state.status === "paused"}
              onClick={() => void command("pause")}
            >
              暂停交流
            </button>
            <DeleteContent
              title="停止发布我的分身"
              scope="退出发现，停止之后的回答。不能追回访客已看见或另行保存的内容；私人资料保留。"
              label="停止发布"
              disabled={task.busy}
              onDelete={async () => {
                const value = await api.update(state.revision, "unpublish");
                accept(value);
              }}
            />
          </>
        )}
      </div>
      {state.publication && (
        <p className="muted fine">
          发布于{" "}
          {formatServerIsoDateTime(state.publication.published_at, timezone)} ·
          当前服务内可发现
        </p>
      )}
      <details className="self-section">
        <summary>访问申请与真人接续 · {state.visitors.length}</summary>
        {state.visitors.map((v) => (
          <article className="self-visitor" key={v.visitor_id}>
            <h4>
              访客 {v.visitor_id} · {accessLabels[v.status]}
            </h4>
            <p>{v.note || "未填写介绍"}</p>
            {v.contact && (
              <>
                <p>希望联系本人：{v.contact}</p>
                <p className="muted fine">
                  {
                    {
                      pending: "待决定",
                      accepted: "愿意接续，请按访客留下的方式联系",
                      declined: "暂不接续",
                      none: "",
                    }[v.contact_status]
                  }
                </p>
              </>
            )}
            <div className="actions">
              {(["approve", "reject", "revoke"] as const).map((action) => (
                <button
                  key={action}
                  disabled={
                    task.busy ||
                    (action === "approve" && v.status === "approved")
                  }
                  onClick={() =>
                    void task.run(
                      () => api.review(state.revision, v.visitor_id, action),
                      accept,
                    )
                  }
                >
                  {
                    {
                      approve: "允许交流",
                      reject: "不通过",
                      revoke: "撤销访问",
                    }[action]
                  }
                </button>
              ))}
              <button
                disabled={task.busy}
                onClick={() =>
                  void task.run(
                    () => readSelfHistory(state.id, v.visitor_id),
                    (h) => {
                      setVisitor(v.visitor_id);
                      setVisitorHistory(h);
                    },
                  )
                }
              >
                查看完整交谈
              </button>
              {v.contact && (
                <>
                  <button
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(
                        () =>
                          api.review(
                            state.revision,
                            v.visitor_id,
                            "contact_accept",
                          ),
                        accept,
                      )
                    }
                  >
                    愿意真人接续
                  </button>
                  <button
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(
                        () =>
                          api.review(
                            state.revision,
                            v.visitor_id,
                            "contact_decline",
                          ),
                        accept,
                      )
                    }
                  >
                    暂不接续
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
        {visitorHistory && (
          <section className="self-transcript">
            <div className="self-section-heading">
              <h4>与访客 {visitor} 的交谈</h4>
              <button
                onClick={() => {
                  setVisitor(null);
                  setVisitorHistory(null);
                }}
              >
                收起
              </button>
            </div>
            {visitorHistory.pending_request && (
              <p className="muted">
                有一轮尚未完成 · {visitorHistory.pending_status}
              </p>
            )}
            {visitorHistory.messages.map((m) => (
              <article key={m.id}>
                <small className="muted">
                  {m.role === "user" ? "访客" : "AI 分身"} · 发布版本{" "}
                  {m.publication_version}
                </small>
                <Prose text={m.text} />
                {m.role === "assistant" && (
                  <button
                    className="quiet-action"
                    onClick={() =>
                      add({
                        id: crypto.randomUUID(),
                        title: "复盘后的专业表达",
                        text: m.text,
                        source: null,
                        recognized: false,
                      })
                    }
                  >
                    作为待修改表达加入草稿
                  </button>
                )}
              </article>
            ))}
            <p className="muted fine">
              访客内容不会自动加入你的私人记忆。新增表达需要你改写、审阅并再次发布。
            </p>
            <button
              disabled={task.busy}
              onClick={() =>
                void task.run(
                  () => readSelfHistory(state.id, visitor!),
                  setVisitorHistory,
                )
              }
            >
              重新读取交谈
            </button>
          </section>
        )}
      </details>
      <details className="self-section">
        <summary>使用量</summary>
        {Object.entries(state.usage)
          .filter(([k]) => !k.includes(":"))
          .map(([day, count]) => (
            <p key={day}>
              {day} · {count} 轮 /{" "}
              {state.publication?.draft.daily_limit ?? draft.daily_limit} 轮
            </p>
          ))}
        {!Object.keys(state.usage).length && (
          <p className="muted">还没有访客交流用量。</p>
        )}
      </details>
    </div>
  );
}

function DiscoverSelf() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const resource = useResource(`${search}:${offset}`, () =>
    api.discover(search, offset),
  );
  if (selected)
    return (
      <VisitorSelf
        key={selected}
        id={selected}
        onBack={() => {
          setSelected(null);
          resource.refresh();
        }}
      />
    );
  return (
    <>
      <h3>与一个人的经验和判断，先聊一聊</h3>
      <p className="muted">
        这里展示本人主动发布的 AI 分身。交流不代表本人实时回复或承诺。
      </p>
      <form
        className="actions"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
          setOffset(0);
        }}
      >
        <input
          aria-label="发现分身"
          placeholder="一个话题、一种经验、一个人"
          maxLength={100}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button>查找</button>
        <button type="button" onClick={resource.refresh}>
          刷新
        </button>
      </form>
      <State resource={resource} />
      {resource.data?.items.map((card) => (
        <article className="self-directory-row" key={card.id}>
          <div className="self-section-heading">
            <h3>{card.name}的 AI 分身</h3>
            <span className="muted fine">
              {card.online ? "在线" : "暂不可交流"}
            </span>
          </div>
          <p>{card.bio}</p>
          <p className="muted fine">{card.topics.join(" · ")}</p>
          <button onClick={() => setSelected(card.id)}>了解与交流</button>
        </article>
      ))}
      {resource.data?.items.length === 0 && (
        <p className="muted">
          还没有符合条件的已发布分身。可以在“我的分身”创建第一份。
        </p>
      )}
      {!!resource.data?.unavailable_profiles && (
        <p className="muted fine">部分设备内容尚未读取，目录可能不完整。</p>
      )}
      <Pages
        offset={offset}
        step={20}
        more={resource.data?.has_more ?? false}
        onChange={setOffset}
      />
    </>
  );
}

function VisitorMessage({
  message,
  eligible,
  onSource,
}: {
  message: SelfMessage;
  eligible: boolean;
  onSource: (id: string, version: string) => void;
}) {
  const typing = useTypewriter({
    id: message.id,
    text: message.text,
    streaming: false,
    eligible,
  });
  return (
    <article className={`self-message self-message-${message.role}`}>
      <small className="muted">
        {message.role === "user" ? "我" : "AI 分身"}
      </small>
      <Prose
        text={
          message.role === "assistant" ? typing.displayedText : message.text
        }
      />
      {message.sources.length > 0 && (
        <details>
          <summary>本次参考的发布内容 · {message.sources.length}</summary>
          <p className="muted fine">
            回答版本：{message.publication_version}
            。来源入口只显示当前仍有效的发布内容。
          </p>
          {message.sources.map((id) => (
            <button
              key={id}
              className="quiet-action"
              onClick={() => onSource(id, message.publication_version)}
            >
              查看依据
            </button>
          ))}
        </details>
      )}
    </article>
  );
}

function VisitorSelf({ id, onBack }: { id: string; onBack: () => void }) {
  const [card, setCard] = useState<SelfCard | null>(null);
  const [history, setHistory] = useState<SelfHistory | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [ack, setAck] = useState(false);
  const [assisted, setAssisted] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [liveId, setLiveId] = useState("");
  const [sendFailure, setSendFailure] = useState("");
  const [source, setSource] = useState<PublishedEntry | null>(null);
  const task = useTask();
  const timezone = useServerTimezone();
  const refresh = () =>
    task.run(
      async () => ({
        card: await api.card(id),
        history: await readSelfHistory(id),
      }),
      (value) => {
        setCard(value.card);
        setHistory(value.history);
        setLiveId("");
      },
    );
  useEffect(() => {
    void refresh();
  }, [id]);
  const blocked =
    task.busy ||
    voiceBusy ||
    !card?.online ||
    card.access_status !== "approved" ||
    !ack ||
    !!history?.pending_request;
  const send = async () => {
    if (blocked || !text.trim() || !history || !card) return;
    setSendFailure("");
    const sent = text.trim();
    const ok = await task.run(
      async () => {
        await api.turn(id, {
          request_id: crypto.randomUUID(),
          revision: history.revision,
          publication_version: card.version,
          text: sent,
          acknowledge_owner_visibility: ack,
          assisted,
        });
        return await readSelfHistory(id);
      },
      (value) => {
        setHistory(value);
        setText("");
        setAssisted(false);
        setSource(null);
        setLiveId(value.messages.at(-1)?.id || "");
      },
    );
    if (!ok) {
      setSendFailure(
        "本轮未完成。已尝试恢复记录，保留你的草稿；没有重发问题。",
      );
      // Recover state without repeating the user's request or replacing their draft.
      await task.run(
        () => readSelfHistory(id),
        (value) => {
          setHistory(value);
          setLiveId("");
        },
      );
    }
  };
  const choices =
    history?.messages.at(-1)?.role === "assistant"
      ? history.messages.at(-1)!.options
      : [];
  return (
    <div className="self-consultation">
      <button className="quiet-action" onClick={onBack}>
        返回发现
      </button>
      <Failure error={task.error || sendFailure} />
      {!card ? (
        <button disabled={task.busy} onClick={() => void refresh()}>
          重新读取分身
        </button>
      ) : (
        <>
          <div className="self-section-heading">
            <h3>{card.name}的 AI 分身</h3>
            <span className="muted fine">
              {card.online ? "在线" : "离线或暂停"}
            </span>
          </div>
          <p>{card.bio}</p>
          <p className="muted fine">
            {card.topics.join(" · ")} · 更新于{" "}
            {formatServerIsoDateTime(card.updated_at, timezone)}
          </p>
          <details>
            <summary>代表内容与适合讨论的问题</summary>
            {card.works.map((work, i) => (
              <p key={i}>{work}</p>
            ))}
            {card.questions.map((q, i) => (
              <button
                key={i}
                disabled={task.busy || voiceBusy}
                onClick={() => {
                  setText(q);
                  setAssisted(true);
                }}
              >
                {q}
              </button>
            ))}
          </details>
          <section className="self-disclosure">
            <p>
              这是 AI
              分身。本人可查看你与分身的完整交谈及来往记忆。模型用量由本人承担。
            </p>
            <p className="muted fine">
              当前模型：{card.model || "离线，暂无法核实"}。
              {card.model_local
                ? "模型服务配置在本人设备的本机地址。"
                : "交流内容将交给本人配置的模型服务处理，可能是在线服务。"}
            </p>
            <label className="self-check">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              我已了解，愿意开始交流
            </label>
          </section>
          {card.access_status !== "approved" && (
            <section className="self-section">
              <p>{accessLabels[card.access_status]}</p>
              {!["rejected", "revoked"].includes(card.access_status) && (
                <>
                  <label>
                    向本人介绍你的问题
                    <textarea
                      rows={3}
                      maxLength={600}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={task.busy || !ack}
                    onClick={() =>
                      void task.run(() => api.apply(id, note), setCard)
                    }
                  >
                    提交访问申请
                  </button>
                </>
              )}
            </section>
          )}
          <div className="actions">
            <button
              disabled={task.busy || voiceBusy}
              onClick={() => void refresh()}
            >
              重新读取状态与交谈
            </button>
            {history && (
              <DeleteContent
                title={`与${card.name}分身的交谈和来往记忆`}
                scope="清理后双方在应用中不再看到这些记录，之后的回答也不会使用。不能追回已看见或另行保存的副本。"
                disabled={task.busy || voiceBusy}
                onDelete={async () => {
                  const result = await api.clear(id, history.revision);
                  setHistory(result);
                  setLiveId("");
                }}
              />
            )}
          </div>
          {history?.pending_request && (
            <div className="notice">
              <p>
                上一轮
                {history.pending_status === "running"
                  ? "仍在处理"
                  : history.pending_status === "failed"
                  ? "未完成"
                  : "结果尚未恢复"}
                。没有自动重发。
              </p>
              <p className="muted fine">{history.pending_text}</p>
              <DeleteContent
                title="结束这次未完成请求"
                label="结束请求"
                iconOnly={false}
                scope="仅清除待恢复状态，保留已完成交谈；不重发问题。服务器仍在处理时不会允许结束。"
                onDelete={async () =>
                  setHistory(
                    await api.clear(id, history.revision, "dismiss_pending"),
                  )
                }
              />
            </div>
          )}
          <div className="self-transcript" aria-label="与 AI 分身的对话">
            {history?.messages.map((message) => (
              <VisitorMessage
                key={message.id}
                message={message}
                eligible={message.id === liveId}
                onSource={(entry, version) =>
                  void task.run(() => api.entry(id, entry, version), setSource)
                }
              />
            ))}
            {task.busy && (
              <p className="muted" role="status">
                正在处理…
              </p>
            )}
          </div>
          {source && (
            <section className="self-citation">
              <div className="self-section-heading">
                <h4>{source.title}</h4>
                <button
                  className="quiet-action"
                  onClick={() => setSource(null)}
                >
                  收起依据
                </button>
              </div>
              <Prose text={source.text} />
              <p className="muted fine">
                当前发布版本 · {source.publication_version}
              </p>
            </section>
          )}
          {card.access_status === "approved" && (
            <form
              className="self-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {!!choices?.length && (
                <details>
                  <summary>也可以从这里继续</summary>
                  <div className="self-choices">
                    {choices.map((choice, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={task.busy || voiceBusy}
                        onClick={() => {
                          setText(choice);
                          setAssisted(true);
                        }}
                      >
                        {choice}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={task.busy || voiceBusy}
                      onClick={() => {
                        setText("我还不确定，想先想一想。");
                        setAssisted(true);
                      }}
                    >
                      还不确定
                    </button>
                    <button
                      type="button"
                      disabled={task.busy || voiceBusy}
                      onClick={() => {
                        setText("这个先不展开。");
                        setAssisted(true);
                      }}
                    >
                      先不展开
                    </button>
                  </div>
                  <p className="muted fine">
                    选择只放入草稿，仍由你决定怎么说。
                  </p>
                </details>
              )}
              <textarea
                aria-label="对分身说的话"
                placeholder="说说你的问题，也可以语音输入…"
                rows={3}
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                disabled={task.busy || voiceBusy}
              />
              <div className="actions">
                <VoiceInput
                  contextKey={`digital-self:${id}`}
                  disabled={task.busy}
                  onBusyChange={setVoiceBusy}
                  onTranscript={(value) => {
                    setText((prev) => (prev ? `${prev}\n${value}` : value));
                    setAssisted(false);
                  }}
                />
                <span className="muted fine">建议可改写，发送由你决定</span>
                <button className="primary" disabled={blocked || !text.trim()}>
                  {task.busy ? "等待回答…" : "发送"}
                </button>
              </div>
            </form>
          )}
          {history?.memory.length ? (
            <details className="self-section">
              <summary>这位分身记住的来往 · {history.memory.length}</summary>
              {history.memory.map((fact, i) => (
                <p key={i}>{fact.quote}</p>
              ))}
              <p className="muted fine">
                只属于你与这位分身，可以和交谈记录一起清理。
              </p>
            </details>
          ) : null}
          <details className="self-section">
            <summary>希望联系本人</summary>
            {card.contact_status !== "none" && (
              <p role="status" className="muted">
                {
                  {
                    pending: "介绍已提交，等待本人决定。",
                    accepted: "本人愿意接续，请留意你提供的联系方式。",
                    declined: "本人暂不接续。",
                  }[card.contact_status]
                }
              </p>
            )}
            <p className="muted fine">
              由本人决定是否接续。这里提交介绍，不会自动发送站外消息。
            </p>
            <label>
              介绍、问题与可联系你的方式
              <textarea
                rows={3}
                value={contact}
                maxLength={600}
                onChange={(e) => setContact(e.target.value)}
              />
            </label>
            <button
              disabled={
                task.busy ||
                !ack ||
                !contact.trim() ||
                ["revoked", "rejected"].includes(card.access_status)
              }
              onClick={() =>
                void task.run(() => api.apply(id, note, contact), setCard)
              }
            >
              提交给本人
            </button>
          </details>
        </>
      )}
    </div>
  );
}
