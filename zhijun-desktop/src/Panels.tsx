import { MemoryMaintenanceAction } from "./MemoryMaintenance";
import { useState } from "react";
import Markdown from "react-markdown";
import {
  memoryDashboardApi as memory,
  isAtomDeprecated,
  type AtomItem,
  type CandidateItem,
  type RawEventItem,
  type EntityDetail,
} from "../../dashboard/src/api/modules/memoryDashboard";
import { Notice } from "./App";
import { referenceLabel, type MemoryReference } from "./references";
import { AttachmentSource } from "./attachments";
import { KnowledgeSource } from "./KnowledgeLibrary";
import { Pages, State, useResource } from "./memoryUi";
import { EpisodeDetail } from "./MemoryViews";
export {
  MemoryPanel,
  Understanding,
  Review,
  Episodes,
  Preferences,
} from "./MemoryViews";
export { ConversationsPanel } from "./TopicConversations";

export function Sources({
  agentId,
  reference,
  references,
  onSelect,
  onDiscuss,
}: {
  agentId: string;
  reference: MemoryReference | null;
  references: MemoryReference[];
  onSelect: (ref: MemoryReference) => void;
  onDiscuss?: (text: string) => void;
}) {
  const [view, setView] = useState("recalled");
  const [offset, setOffset] = useState(0);
  const all = useResource(`${agentId}:${view}:${offset}`, async () =>
    view === "raw"
      ? memory.listRawEvents(agentId, { limit: 20, offset })
      : null,
  );
  if (reference?.layer === "attachment")
    return (
      <AttachmentSource
        key={reference.path}
        agentId={agentId}
        path={reference.path}
      />
    );
  if (reference?.layer === "knowledge")
    return reference.kbId ? (
      <KnowledgeSource
        key={reference.path}
        kbId={reference.kbId}
        docId={reference.id}
        onDiscuss={onDiscuss}
        sourceVersion={reference.sourceVersion}
        start={reference.start}
        end={reference.end}
      />
    ) : (
      <Notice>资料库来源未核实。</Notice>
    );
  if (reference)
    if (reference.layer === "episode")
      return (
        <EpisodeDetail
          key={reference.path}
          agentId={agentId}
          id={reference.id}
          onDiscuss={onDiscuss}
        />
      );
  if (reference)
    return (
      <SourceDetail
        key={reference.path}
        agentId={agentId}
        reference={reference}
      />
    );
  return (
    <>
      <div className="tabs">
        {[
          ["recalled", "回答依据"],
          ["raw", "原始记录"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={view === key}
            onClick={() => {
              setView(key);
              setOffset(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "recalled" ? (
        <>
          <p className="muted">
            只展示原生工具实际查阅的记忆、文件与资料来源。
          </p>
          {references.length ? (
            references.map((ref) => (
              <button
                className="history-row"
                key={ref.path}
                onClick={() => onSelect(ref)}
              >
                {referenceLabel(ref)}
              </button>
            ))
          ) : (
            <p className="muted">当前对话尚无可打开的召回来源。</p>
          )}
        </>
      ) : (
        <>
          <State resource={all} />
          {all.data?.items.map((row) => (
            <article key={row.id} className="memory-card">
              <small>{row.event_type}</small>
              <p>{row.content}</p>
            </article>
          ))}
          {all.data && (
            <Pages
              offset={offset}
              step={20}
              more={all.data.has_more}
              onChange={setOffset}
            />
          )}
        </>
      )}
    </>
  );
}

function SourceDetail({
  agentId,
  reference,
}: {
  agentId: string;
  reference: MemoryReference;
}) {
  const [mode, setMode] = useState("");
  const [atomId, setAtomId] = useState(reference.id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AtomItem | null>(null);
  const resource = useResource(
    `${agentId}:${reference.path}:${atomId}`,
    async () => {
      if (reference.layer === "atom") {
        const atom = await memory.getAtom(agentId, atomId);
        const candidate = atom.candidate_id
          ? ((await memory.getCandidate(
              agentId,
              atom.candidate_id,
            )) as CandidateItem)
          : null;
        const raw = candidate?.quote_event_id
          ? ((await memory.getRawEvent(
              agentId,
              candidate.quote_event_id,
            )) as RawEventItem)
          : null;
        return { atom, raw, entity: null as EntityDetail | null };
      }
      if (reference.layer === "page")
        return {
          atom: null,
          raw: null,
          entity: await memory.getEntity(agentId, reference.id),
        };
      return {
        atom: null,
        raw: (await memory.getRawEvent(agentId, reference.id)) as RawEventItem,
        entity: null,
      };
    },
  );
  const save = async () => {
    if (!resource.data?.atom || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const old = resource.data.atom;
      if (mode === "replace") {
        const next = await memory.replaceAtom(agentId, old.id, {
          assertion: text.trim(),
        });
        setResult(await memory.getAtom(agentId, next.atom.id));
        setAtomId(next.atom.id);
      } else {
        await memory.deprecateAtom(agentId, old.id, {
          reason: "本人在知君界面弃用",
        });
        const next = await memory.getAtom(agentId, old.id);
        if (!isAtomDeprecated(next)) throw new Error("服务端尚未显示弃用");
        setResult(next);
      }
      setMode("");
      resource.refresh();
    } catch (e) {
      setError(
        `结果尚未核实：${
          (e as Error).message
        }。请重新读取再核对，操作不会自动重试。`,
      );
    } finally {
      setBusy(false);
    }
  };
  const atom = result || resource.data?.atom;
  return (
    <>
      <p className="muted fine">
        {reference.layer === "atom" ? `atom/${atomId}.md` : reference.path}
      </p>
      <State resource={resource} />
      {error && (
        <Notice>
          {error}
          <button
            onClick={() => {
              setResult(null);
              setMode("");
              setError("");
              resource.refresh();
            }}
          >
            重新读取
          </button>
        </Notice>
      )}
      {result && (
        <p className="notice success">
          已读回服务端结果：
          {isAtomDeprecated(result) ? "记忆已弃用" : "修正已保存"}
        </p>
      )}
      {atom && (
        <>
          <small>
            {isAtomDeprecated(atom)
              ? "已弃用 · 历史留存"
              : "原生记忆 · 可以继续核对"}
          </small>
          <h3>{atom.assertion}</h3>
          <h4>引用的原话</h4>
          <blockquote>{atom.verbatim_quote || "此记录没有附带原话"}</blockquote>
          {!isAtomDeprecated(atom) && !mode && (
            <div className="actions">
              <button
                onClick={() => {
                  setMode("replace");
                  setText(atom.assertion);
                }}
              >
                修正理解
              </button>
              <button onClick={() => setMode("deprecate")}>弃用这条</button>
            </div>
          )}
          {mode && (
            <section className="edit-preview">
              <h3>{mode === "replace" ? "核对这次修正" : "弃用前核对"}</h3>
              <p className="muted">原记忆</p>
              <p>{resource.data?.atom?.assertion}</p>
              {mode === "replace" ? (
                <label>
                  改为
                  <textarea
                    aria-label="修正后的文字"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </label>
              ) : (
                <p>
                  本条将从有效记忆中弃用，原始记录与旧会话按 WANX 原生规则保留。
                </p>
              )}
              <div className="actions">
                <button
                  className="primary"
                  disabled={
                    busy || !!error || (mode === "replace" && !text.trim())
                  }
                  onClick={() => void save()}
                >
                  {busy
                    ? "正在核对服务端结果…"
                    : mode === "replace"
                    ? "保存修正"
                    : "弃用"}
                </button>
                <button disabled={busy} onClick={() => setMode("")}>
                  取消
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {resource.data?.entity && (
        <>
          <h3>{resource.data.entity.canonical_name}</h3>
          {resource.data.entity.page?.dirty && (
            <Notice>这份概览正在等待原生重新整理。</Notice>
          )}
          <Markdown
            components={{ a: ({ children }) => <span>{children}</span> }}
          >
            {resource.data.entity.page?.summary_markdown || "尚未形成概览"}
          </Markdown>
          <p className="muted">这是原生整理概览，具体断言仍需核对原始记录。</p>
        </>
      )}
      {resource.data && (
        <>
          <MemoryMaintenanceAction
            kind={
              reference.layer === "atom"
                ? "atom"
                : reference.layer === "page"
                ? "entity"
                : "raw"
            }
            id={reference.id}
          />
          <h4>原始记录</h4>
          <pre className="source-text">
            {resource.data.raw?.content || "此路径未关联可展示的原始记录。"}
          </pre>
          {resource.data.raw && (
            <small className="muted">记录 ID：{resource.data.raw.id}</small>
          )}
        </>
      )}
    </>
  );
}
