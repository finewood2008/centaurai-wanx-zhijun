import { useEffect, useRef, useState } from "react";
import {
  editContextNode,
  ontologyApi,
  reviewOntologyRelation,
  type ContextEdit,
  type ContextKind,
  type ContextNode,
  type PersonalOntology,
} from "./ontology";
import type { MemoryReference } from "./references";
import { useServerTimezone } from "../../dashboard/src/hooks/useServerTimezone";
import { formatServerIsoDateTime } from "../../dashboard/src/utils/formatMessageTime";
import { emotionLabel } from "./memory";

export const contextKinds: Record<ContextKind, string> = {
  person: "相关人物",
  project: "项目与事情",
  role: "身份与角色",
  goal: "当前目标",
  situation: "当前处境",
  fact: "事实与说法",
  episode: "具体经历",
};
export function contextSource(node: ContextNode): MemoryReference | null {
  const id = node.native_ids[0];
  if (!id) return null;
  if (node.kind === "episode")
    return { layer: "episode", id, path: `/episodes/${id}` };
  if (["person", "project"].includes(node.kind))
    return { layer: "page", id, path: `page/${id}.md` };
  if (node.kind === "fact") return { layer: "atom", id, path: `atom/${id}.md` };
  return null;
}
const active = (n: ContextNode) =>
  n.state === "active" && n.evidence_valid && !n.merged_into;

export function CurrentSelf({
  doc,
  onSelect,
}: {
  doc: PersonalOntology;
  onSelect: (id: string) => void;
}) {
  const nodes = (doc.nodes || []).filter(active);
  const current = nodes
    .filter((n) => n.core || ["role", "goal", "situation"].includes(n.kind))
    .slice(0, 3);
  const people = nodes
    .filter((n) => ["person", "project"].includes(n.kind))
    .slice(0, 6);
  if (!current.length && !people.length) return null;
  return (
    <section className="context-overview" aria-label="现在的我">
      <h4>现在的我</h4>
      {current.map((n) => (
        <button
          className="context-current"
          key={n.id}
          onClick={() => onSelect(n.id)}
        >
          <small>
            {contextKinds[n.kind]}
            {n.time_scope && ` · ${n.time_scope}`}
          </small>
          <span>{n.statement}</span>
        </button>
      ))}
      {!!people.length && (
        <div className="context-people" aria-label="相关的人和事">
          {people.map((n) => (
            <button key={n.id} onClick={() => onSelect(n.id)}>
              {n.title}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function ContextAssociations({
  doc,
  id,
  onSelect,
  onClaim,
  onChange,
}: {
  doc: PersonalOntology;
  id: string;
  onSelect: (id: string) => void;
  onClaim?: (id: string) => void;
  onChange?: (doc: PersonalOntology) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function review(
    linkId: string,
    version: string,
    action: "confirm" | "dismiss",
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await reviewOntologyRelation(
        linkId,
        doc.revision,
        action,
        version,
      );
      const saved = await ontologyApi.get();
      onChange?.(saved);
      const actual = saved.links?.find((l) => l.id === linkId);
      if (
        result.status !== "ready" ||
        actual?.state !== (action === "confirm" ? "confirmed" : "dismissed")
      )
        setError("这项联系已有变化，请核对当前内容。");
    } catch (e) {
      setError(`尚未核实：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  const links = (doc.links || []).filter(
    (l) => l.state !== "dismissed" && [l.source, l.target].includes(id),
  );
  const nodes = [
    ...new Set(links.map((l) => (l.source === id ? l.target : l.source))),
  ];
  if (!nodes.length) return null;
  return (
    <div className="context-associations" aria-label="相关处境与理解">
      <p className="muted fine">相关处境与理解</p>
      {nodes.map((nid) => {
        const node = doc.nodes?.find((n) => n.id === nid && active(n));
        const claim = doc.claims.find(
          (c) =>
            c.id === nid &&
            c.evidence_valid &&
            ["draft", "confirmed"].includes(c.state),
        );
        const link = links.find((l) => [l.source, l.target].includes(nid))!;
        return node ? (
          <div key={nid}>
            <button onClick={() => onSelect(nid)}>
              <small>
                {contextKinds[node.kind]}
                {link.state === "draft" ? " · 联系待核对" : ""}
              </small>
              <span>{node.statement}</span>
            </button>
            {link.source_kind === "inference" && onChange && (
              <span className="actions">
                <button
                  disabled={busy}
                  onClick={() => void review(link.id, link.version, "confirm")}
                >
                  符合这段经历
                </button>
                <button
                  disabled={busy}
                  onClick={() => void review(link.id, link.version, "dismiss")}
                >
                  不这样联系
                </button>
              </span>
            )}
          </div>
        ) : claim && onClaim ? (
          <button key={nid} onClick={() => onClaim(claim.id)}>
            <small>
              自我理解 · {claim.state === "confirmed" ? "已核对" : "待核对"}
            </small>
            <span>{claim.statement}</span>
          </button>
        ) : null;
      })}
      {error && (
        <p role="status" className="muted fine">
          {error}
        </p>
      )}
    </div>
  );
}

export function PersonalContext({
  doc,
  selected,
  onSelect,
  onChange,
  onSource,
  onDiscuss,
  onClaim,
  standalone = false,
}: {
  doc: PersonalOntology;
  selected: string;
  onSelect: (id: string) => void;
  onChange: (doc: PersonalOntology) => void;
  onSource: (ref: MemoryReference) => void;
  onDiscuss: (text: string) => void;
  onClaim: (id: string) => void;
  standalone?: boolean;
}) {
  const [view, setView] = useState(standalone ? "all" : "fact");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<{
    id: string | null;
    body: ContextEdit;
  } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [purging, setPurging] = useState(false);
  const [merging, setMerging] = useState("");
  const [undo, setUndo] = useState<{ id: string; version: string } | null>(
    null,
  );
  const ref = useRef<HTMLDetailsElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const timezone = useServerTimezone();
  const node = doc.nodes?.find((n) => n.id === selected);
  useEffect(() => {
    if (!selected) return;
    const n = doc.nodes?.find((n) => n.id === selected);
    if (n) {
      if (!standalone) setView(n.kind);
      setHistory(!active(n));
      setPage(0);
      if (ref.current) ref.current.open = true;
      detailRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selected]);
  const visible = (doc.nodes || []).filter(
    (n) =>
      (history ? !active(n) : active(n)) &&
      (view === "all" || n.kind === view) &&
      `${n.statement} ${n.title} ${n.aliases.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pageNodes = visible.slice(page * 12, page * 12 + 12);
  const materialGroups = standalone
    ? [
        { title: "当前重点", kinds: ["role", "goal", "situation"] },
        { title: "记住的事", kinds: ["fact"] },
        { title: "具体经历", kinds: ["episode"] },
        { title: "关键人事物", kinds: ["person", "project"] },
      ]
        .map((group) => ({
          title: group.title,
          items: pageNodes.filter((n) => group.kinds.includes(n.kind)),
        }))
        .filter((group) => group.items.length)
    : [{ title: "", items: pageNodes }];
  function begin(n?: ContextNode) {
    setNote("");
    setPurging(false);
    setConflict(false);
    setEditing({
      id: n?.id || null,
      body: {
        revision: doc.revision,
        expected_version: n?.version,
        action: n ? "correct" : "add",
        request_id: n ? undefined : crypto.randomUUID(),
        kind: n?.kind || "fact",
        title: n?.title || "",
        statement: n?.statement || "",
        conditions: n?.conditions || "",
        time_scope: n?.time_scope || "",
        aliases: n?.aliases || [],
        core: n?.core || false,
        related_ids: [],
      },
    });
  }
  async function perform(id: string | null, body: ContextEdit) {
    if (busy || unknown) return;
    setBusy(true);
    setNote("");
    setConflict(false);
    try {
      const target = doc.nodes?.find((n) => n.id === id);
      const result = await editContextNode(id, {
        ...body,
        revision: doc.revision,
        expected_version: body.expected_version || target?.version,
      });
      if (!alive.current) return;
      if (result.status !== "ready") {
        onChange(result.ontology);
        setConflict(true);
        setNote("这项内容已有修改。你的文字仍保留，请查看当前内容后再保存。");
        return;
      }
      const saved = await ontologyApi.get();
      if (!alive.current) return;
      const actual = saved.nodes?.find((n) => n.id === result.changed_id);
      const expected = result.ontology.nodes?.find(
        (n) => n.id === result.changed_id,
      );
      if (
        (body.action === "purge" && actual) ||
        (body.action !== "purge" && actual?.version !== expected?.version)
      ) {
        onChange(saved);
        setConflict(true);
        setNote("保存后的条目又有变化，请核对当前内容。");
        return;
      }
      onChange(saved);
      setEditing(null);
      setPurging(false);
      setMerging("");
      onSelect(body.action === "purge" ? "" : result.changed_id || "");
      setUndo(
        body.action !== "purge" && result.changed_id && result.previous_version
          ? { id: result.changed_id, version: result.previous_version }
          : null,
      );
      setNote(
        body.action === "purge"
          ? "已删除这项个人上下文及关联。原始记忆保留。"
          : "已更新个人上下文，之后的交谈会使用当前表述。",
      );
    } catch (e) {
      if (alive.current) {
        setUnknown(true);
        setNote(`结果尚未核实：${(e as Error).message}。请重新读取后检查。`);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const content = (
    <>
      {standalone ? (
        <h3>记忆资料</h3>
      ) : (
        <summary>记忆资料 · 事实与来源</summary>
      )}
      <p className="muted fine">
        {standalone
          ? "这里留下事实与线索。想起一件事时，可以回到原话。"
          : "当前事实、人物和经历与本体共用一份上下文。原生提炼可以查证，历史原话始终保留。"}
      </p>
      {standalone && node && (
        <button
          className="quiet-action profile-back"
          onClick={() => {
            onSelect("");
            setEditing(null);
          }}
        >
          ← 记忆资料
        </button>
      )}
      <div className="context-toolbar" hidden={standalone && !!node}>
        <button onClick={() => begin()} disabled={busy}>
          补充一项事实或近况
        </button>
        <button
          aria-pressed={history}
          onClick={() => {
            setHistory(!history);
            setPage(0);
          }}
        >
          {history ? "查看当前" : "历史与已停用"}
        </button>
      </div>
      {!standalone && (
        <div className="memory-view-switch" aria-label="个人上下文浏览方式">
          {(["fact", "person", "project", "episode", "all"] as const).map(
            (kind) => (
              <button
                key={kind}
                aria-pressed={view === kind}
                onClick={() => {
                  setView(kind);
                  setPage(0);
                }}
              >
                {kind === "all" ? "全部" : contextKinds[kind]}
              </button>
            ),
          )}
        </div>
      )}
      <input
        className="context-search"
        aria-label="查找个人上下文"
        placeholder="找一个人、一件事或一段经历"
        value={query}
        hidden={standalone && !!node}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(0);
        }}
      />
      {note && (
        <p role="status" className="context-note">
          {note}
          {undo && (
            <button
              disabled={busy}
              onClick={() =>
                void perform(undo.id, {
                  revision: doc.revision,
                  action: "restore",
                  restore_version: undo.version,
                })
              }
            >
              撤销
            </button>
          )}
        </p>
      )}
      {unknown && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const saved = await ontologyApi.get();
              if (alive.current) {
                onChange(saved);
                setUnknown(false);
                setNote("已重新读取，请核对当前内容。草稿仍保留。");
              }
            } catch (e) {
              setNote(`读取失败：${(e as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          重新读取当前内容
        </button>
      )}
      {conflict && editing && (
        <button
          onClick={() => {
            setEditing({
              ...editing,
              body: {
                ...editing.body,
                revision: doc.revision,
                expected_version: doc.nodes?.find((n) => n.id === editing.id)
                  ?.version,
              },
            });
            setConflict(false);
          }}
        >
          已核对当前内容，继续编辑
        </button>
      )}
      <div className="context-list" hidden={standalone && !!node}>
        {materialGroups.map((group) => (
          <div className="profile-material-group" key={group.title}>
            {group.title && <h4>{group.title}</h4>}
            {group.items.map((n) => (
              <button
                key={n.id}
                className="context-row"
                aria-pressed={n.id === selected}
                onClick={() => {
                  onSelect(n.id);
                  setEditing(null);
                  setPurging(false);
                }}
              >
                <span>{n.statement}</span>
                <small>
                  {contextKinds[n.kind]} ·{" "}
                  {n.source_kind === "self_report" ? "本人自述" : "原生提炼"}
                  {n.changed && " · 发生变化"}
                  {!n.evidence_valid && " · 来源待核验"}
                  {n.merged_into && " · 已合并"}
                </small>
              </button>
            ))}
          </div>
        ))}
        {!visible.length && (
          <p className="muted fine">
            {history
              ? "这个视角还没有历史或停用内容。"
              : "这里暂时没有记录，可以从对话或一句补充开始。"}
          </p>
        )}
      </div>
      {visible.length > 12 && !(standalone && node) && (
        <div className="actions pagination">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>第 {page + 1} 页</span>
          <button
            disabled={(page + 1) * 12 >= visible.length}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {node && (
        <article
          ref={detailRef}
          className="context-detail"
          aria-label="个人上下文详情"
        >
          <div className="ontology-meta">
            <span>{contextKinds[node.kind]}</span>
            <span>
              {node.source_kind === "self_report"
                ? "本人自述"
                : "原生提炼 · 可查证"}
              {node.state === "withdrawn" && " · 已停用"}
            </span>
          </div>
          <h4>{node.title}</h4>
          <p>{node.statement}</p>
          {(node.conditions || node.time_scope) && (
            <p className="muted fine">
              {node.conditions}
              {node.time_scope && ` · ${node.time_scope}`}
            </p>
          )}
          {node.emotion && (
            <p className="muted fine">
              当时记录的感受 · {emotionLabel(node.emotion)} · 标签只读
            </p>
          )}
          {!!node.aliases.length && (
            <p className="muted fine">名称与别名 · {node.aliases.join("、")}</p>
          )}
          {standalone && (
            <details className="profile-details">
              <summary>相关的人与经历</summary>
              <ContextAssociations
                doc={doc}
                id={node.id}
                onSelect={onSelect}
                onClaim={onClaim}
                onChange={onChange}
              />
            </details>
          )}
          {!standalone && (
            <ContextAssociations
              doc={doc}
              id={node.id}
              onSelect={onSelect}
              onClaim={onClaim}
              onChange={onChange}
            />
          )}
          {!!node.evidence.length && (
            <details>
              <summary>原话依据 · {node.evidence.length}</summary>
              {node.evidence.map((e, i) => (
                <div className="ontology-evidence" key={`${e.event_id}:${i}`}>
                  <blockquote>{e.quote}</blockquote>
                  <small>
                    {formatServerIsoDateTime(e.timestamp, timezone)}
                  </small>
                  {e.event_id && (
                    <button
                      onClick={() =>
                        onSource({
                          layer: "raw",
                          id: e.event_id,
                          path: `/raw_events/${e.event_id}`,
                        })
                      }
                    >
                      查看完整原话
                    </button>
                  )}
                </div>
              ))}
            </details>
          )}
          <div className="actions">
            <button disabled={busy} onClick={() => begin(node)}>
              修改当前表述
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void perform(node.id, {
                  revision: doc.revision,
                  action: "pin",
                  core: !node.core,
                })
              }
            >
              {node.core ? "取消核心" : "设为核心"}
            </button>
            <button
              onClick={() =>
                onDiscuss(
                  `我想核对个人上下文 /ontology/context/${node.id}：“${node.statement}”。请查证原话，按这次的处境理解。我想补充的是：`,
                )
              }
            >
              与知君聊聊
            </button>
            {contextSource(node) && (
              <button onClick={() => onSource(contextSource(node)!)}>
                查看原生记录
              </button>
            )}
            <details className="context-menu">
              <summary
                aria-label="管理这项个人上下文"
                title="管理这项个人上下文"
              >
                ···
              </summary>
              <div>
                {node.state === "active" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(node.id, {
                        revision: doc.revision,
                        action: "disable",
                      })
                    }
                  >
                    停止使用并移出
                  </button>
                )}
                {["person", "project", "fact"].includes(node.kind) &&
                  node.state === "active" && (
                    <button onClick={() => setMerging(node.id)}>
                      与另一项合并
                    </button>
                  )}
                <button onClick={() => setPurging(true)}>
                  彻底删除这项上下文
                </button>
              </div>
            </details>
          </div>
          {merging === node.id && (
            <div className="context-confirm">
              <p>
                请选择同一个对象。合并依据是你的明确判断，名称相近不代表同一个人。
              </p>
              <select
                aria-label="合并到另一项"
                defaultValue=""
                onChange={(e) =>
                  setMerging(
                    e.target.value ? `${node.id}|${e.target.value}` : node.id,
                  )
                }
              >
                <option value="">选择保留的对象</option>
                {(doc.nodes || [])
                  .filter(
                    (n) =>
                      active(n) && n.kind === node.kind && n.id !== node.id,
                  )
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
              </select>
              <button onClick={() => setMerging("")}>取消</button>
            </div>
          )}
          {merging.startsWith(`${node.id}|`) && (
            <div className="context-confirm">
              <p>
                确认这是同一个对象：{node.title} →{" "}
                {doc.nodes?.find((n) => n.id === merging.split("|")[1])?.title}
                。保留原话及合并历史。
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  const target = doc.nodes!.find(
                    (n) => n.id === merging.split("|")[1],
                  )!;
                  void perform(node.id, {
                    revision: doc.revision,
                    action: "merge",
                    merge_target: target.id,
                    merge_target_version: target.version,
                  });
                }}
              >
                确认合并
              </button>
              <button onClick={() => setMerging("")}>取消</button>
            </div>
          )}
          {purging && (
            <div className="context-confirm">
              <p>
                将删除“{node.statement}
                ”及本体中的关联，无法恢复。原生对话、资料和记忆原件保留，需在各自来源入口单独管理。
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(node.id, {
                    revision: doc.revision,
                    action: "purge",
                  })
                }
              >
                确认删除这项上下文
              </button>
              <button onClick={() => setPurging(false)}>取消</button>
            </div>
          )}
          {!!node.history.length && (
            <details>
              <summary>变化与恢复 · {node.history.length}</summary>
              {[...node.history].reverse().map((h) => (
                <div className="ontology-version" key={h.version}>
                  <p>{h.value.statement}</p>
                  <small>{formatServerIsoDateTime(h.at, timezone)}</small>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(node.id, {
                        revision: doc.revision,
                        action: "restore",
                        restore_version: h.version,
                      })
                    }
                  >
                    恢复此版本
                  </button>
                </div>
              ))}
            </details>
          )}
        </article>
      )}
      {editing && (
        <form
          className="ontology-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(editing.id, editing.body);
          }}
        >
          <h4>{editing.id ? "修改当前事实与处境" : "补充个人上下文"}</h4>
          {editing.id && (
            <label>
              这次修改
              <select
                value={editing.body.action}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    body: {
                      ...editing.body,
                      action: e.target.value as ContextEdit["action"],
                    },
                  })
                }
              >
                <option value="correct">记录有误</option>
                <option value="scope">只适用于某种情况</option>
                <option value="change">以前如此，现在变了</option>
              </select>
            </label>
          )}
          <label>
            内容类型
            <select
              value={editing.body.kind}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  body: {
                    ...editing.body,
                    kind: e.target.value as ContextKind,
                  },
                })
              }
            >
              {Object.entries(contextKinds)
                .filter(([k]) => k !== "episode")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          <label>
            当前表述
            <textarea
              required
              maxLength={800}
              value={editing.body.statement}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  body: { ...editing.body, statement: e.target.value },
                })
              }
            />
          </label>
          <label>
            简短名称
            <input
              maxLength={120}
              value={editing.body.title}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  body: { ...editing.body, title: e.target.value },
                })
              }
            />
          </label>
          <label>
            适用情境
            <input
              maxLength={300}
              value={editing.body.conditions}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  body: { ...editing.body, conditions: e.target.value },
                })
              }
            />
          </label>
          <label>
            时间范围
            <input
              maxLength={120}
              value={editing.body.time_scope}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  body: { ...editing.body, time_scope: e.target.value },
                })
              }
            />
          </label>
          <label>
            名称与别名
            <input
              value={editing.body.aliases?.join("、")}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  body: {
                    ...editing.body,
                    aliases: e.target.value
                      .split(/[、,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </label>
          <label>
            关联的人或事情
            <select
              multiple
              value={editing.body.related_ids}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  body: {
                    ...editing.body,
                    related_ids: Array.from(
                      e.target.selectedOptions,
                      (option) => option.value,
                    ),
                  },
                })
              }
            >
              {(doc.nodes || [])
                .filter(
                  (n) =>
                    active(n) &&
                    n.id !== editing.id &&
                    ["person", "project", "role", "goal", "situation"].includes(
                      n.kind,
                    ),
                )
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="actions">
            <button disabled={busy || conflict || unknown}>保存当前表述</button>
            <button type="button" onClick={() => setEditing(null)}>
              暂不修改
            </button>
          </div>
        </form>
      )}
      {doc.graph_coverage && !standalone && (
        <p className="muted fine">
          已检查 {doc.graph_coverage.atoms} 条原生记忆、
          {doc.graph_coverage.entities} 个主题、{doc.graph_coverage.episodes}{" "}
          段经历；可查证 {doc.graph_coverage.verifiable_facts} 项事实，合并{" "}
          {doc.graph_coverage.duplicate_sources} 条重复来源。
          {!doc.graph_coverage.complete && "读取尚不完整。"}
          {!!doc.graph_coverage.unavailable_sources &&
            ` ${doc.graph_coverage.unavailable_sources} 条来源暂不可用于当前理解。`}
        </p>
      )}
    </>
  );
  return standalone ? (
    <section className="context-library profile-context">{content}</section>
  ) : (
    <details className="ontology-native context-library" open ref={ref}>
      {content}
    </details>
  );
}
