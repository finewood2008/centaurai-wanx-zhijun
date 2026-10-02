import { useEffect, useState } from "react";
import {
  ontologyApi,
  ontologyContext,
  editOntology,
  verifiedCoreReview,
  coreChanged,
  isCore,
  editContextNode,
  type OntologyContext,
} from "./ontology";
import type { MemoryReference } from "./references";
import { understandingReference } from "./understanding";
import { contextKinds, contextSource } from "./PersonalContext";
export function OntologyTurn({
  threadId,
  reply,
  replyId,
  latest,
  onSource,
}: {
  threadId: string;
  reply: string;
  replyId: string;
  latest: boolean;
  onSource?: (source: MemoryReference) => void;
}) {
  const [snapshot, setSnapshot] = useState<OntologyContext | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    value: string;
    revision: string;
  } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open && !latest) return;
    let alive = true;
    ontologyContext(threadId, reply, replyId, latest)
      .then((value) => {
        if (alive) {
          setSnapshot(value);
          if (value.updates?.some((u) => u.changed_id)) coreChanged();
        }
      })
      .catch(() => {
        if (alive && open) setNote("这次的参考记录暂时读不到，可稍后再试。");
      });
    return () => {
      alive = false;
    };
  }, [threadId, reply, replyId, open, latest]);
  async function update(id: string, statement?: string, version?: string) {
    setBusy(true);
    setNote("");
    try {
      const doc = await ontologyApi.get();
      const current = doc.claims.find((c) => c.id === id);
      const node = doc.nodes?.find((n) => n.id === id);
      const target = current || node;
      if (!version && editing && target?.version !== editing.revision)
        throw new Error("内容已变化，请重新打开后修改");
      if (version && target?.history?.at(-1)?.version !== version)
        throw new Error("这项理解后来又有修改，请在用户画像里查看变化记录");
      if (!target) throw new Error("理解已不存在，请在用户画像中核对");
      const result = node
        ? await editContextNode(
            id,
            version
              ? {
                  revision: doc.revision,
                  expected_version: node.version,
                  action: "restore",
                  restore_version: version,
                }
              : {
                  revision: doc.revision,
                  expected_version: node.version,
                  action: "correct",
                  statement,
                  title: node.title,
                  kind: node.kind,
                  conditions: node.conditions,
                  time_scope: node.time_scope,
                  aliases: node.aliases,
                },
          )
        : current && (version || isCore(current))
        ? await verifiedCoreReview(
            current,
            version
              ? { action: "restore", restore_version: version }
              : {
                  action: "edit_core",
                  statement: statement!,
                  conditions: current.conditions,
                },
          )
        : await editOntology(
            id,
            version
              ? {
                  revision: doc.revision,
                  action: "restore",
                  restore_version: version,
                  expected_version: target.version,
                }
              : {
                  revision: doc.revision,
                  action: "correct",
                  statement,
                  kind: current!.kind,
                  conditions: current!.conditions,
                  exceptions: current!.exceptions,
                  time_scope: current!.time_scope,
                  core: current!.core,
                  expected_version: current!.version,
                },
          );
      if (result.status !== "ready")
        throw new Error("内容刚有变化，请重新核对");
      const saved = await ontologyApi.get();
      const savedTarget =
        saved.claims.find((c) => c.id === id) ||
        saved.nodes?.find((n) => n.id === id);
      const expectedTarget =
        result.ontology.claims.find((c) => c.id === id) ||
        result.ontology.nodes?.find((n) => n.id === id);
      if (!savedTarget || savedTarget.version !== expectedTarget?.version)
        throw new Error("保存结果需要重新核对");
      setEditing(null);
      setNote(version ? "已撤销这次更新" : "已更新理解");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ontology-turn">
      {snapshot?.updates
        ?.filter((u) => u.changed_id && u.previous_version)
        .map((u) => (
          <p key={u.changed_id}>
            {u.core_effect === "candidate"
              ? "已整理到待确认列表"
              : u.core_effect === "stopped"
              ? "已停止使用旧理解"
              : u.core_effect === "admitted"
              ? "已加入本体"
              : "已更新理解"}{" "}
            ·{" "}
            <button
              disabled={busy}
              onClick={() =>
                void update(u.changed_id!, undefined, u.previous_version!)
              }
            >
              撤销
            </button>
          </p>
        ))}
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>这次参考了哪些理解</summary>
        <p>这是提供给知君的上下文记录；修改会用于之后的交谈。</p>
        {!snapshot ? (
          <p>正在读取…</p>
        ) : !snapshot.available ? (
          <p>这次没有可用的参考记录。</p>
        ) : !snapshot.claims.length && !snapshot.nodes?.length ? (
          <p>本次没有装配个人本体条目。</p>
        ) : (
          snapshot.claims.map((c) => (
            <article key={c.id}>
              <p>{c.statement}</p>
              <small>
                {c.source_kind === "self_report"
                  ? "本人自述"
                  : c.state === "confirmed"
                  ? "已核对"
                  : "待核对的推测"}{" "}
                · {c.conditions}
              </small>
              <div>
                <button
                  disabled={busy}
                  onClick={async () => {
                    try {
                      const currentDoc = await ontologyApi.get();
                      const current = currentDoc.claims.find(
                        (n) => n.id === c.id,
                      );
                      if (current)
                        setEditing({
                          id: c.id,
                          value: current.statement,
                          revision: current.version || "legacy",
                        });
                    } catch {
                      setNote("无法读取当前版本，请稍后再试");
                    }
                  }}
                >
                  修正这项理解
                </button>
              </div>
            </article>
          ))
        )}
        {snapshot?.nodes?.map((n) => (
          <article key={n.id}>
            <small>
              {contextKinds[n.kind]} ·{" "}
              {n.source_kind === "self_report"
                ? "本人自述"
                : "原生提炼 · 可查证"}
            </small>
            <p>{n.statement}</p>
            {n.time_scope && <small>{n.time_scope}</small>}
            {onSource && contextSource(n) && (
              <button onClick={() => onSource(contextSource(n)!)}>
                查看来源
              </button>
            )}
            <button
              disabled={busy}
              onClick={async () => {
                try {
                  const currentDoc = await ontologyApi.get();
                  const current = currentDoc.nodes?.find(
                    (item) => item.id === n.id,
                  );
                  if (current)
                    setEditing({
                      id: n.id,
                      value: current.statement,
                      revision: current.version,
                    });
                  else setNote("这项上下文已不存在，请在用户画像中核对");
                } catch {
                  setNote("无法读取当前版本，请稍后再试");
                }
              }}
            >
              修正这项上下文
            </button>
          </article>
        ))}
        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void update(editing.id, editing.value);
            }}
          >
            <textarea
              aria-label="修正理解"
              required
              maxLength={
                snapshot?.nodes?.some((n) => n.id === editing.id) ? 800 : 400
              }
              value={editing.value}
              onChange={(e) =>
                setEditing({ ...editing, value: e.target.value })
              }
            />
            <button disabled={busy}>保存</button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </form>
        )}
        {snapshot?.understanding_lines
          ?.filter((line) => line.source_available !== false)
          .map((line) => (
            <article key={line.id}>
              <small>资料线索 · 待核对</small>
              <p>{line.question}</p>
              <blockquote>{line.quote}</blockquote>
              {onSource && (
                <button
                  onClick={() => onSource(understandingReference(line.source))}
                >
                  原文 · {line.source.filename}
                </button>
              )}
            </article>
          ))}
      </details>
      {note && <p role="status">{note}</p>}
    </div>
  );
}
