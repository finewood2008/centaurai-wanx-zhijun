import { useCallback, useEffect, useRef, useState } from "react";
import {
  coreApi,
  ontologyApi,
  verifiedCoreReview,
  type CorePage,
  type OntologyClaim,
  type CoreCommand,
} from "./ontology";
import { CoreEvidence } from "./CoreEvidence";
import { Pages } from "./memoryUi";
import type { MemoryReference } from "./references";

export function useCoreCandidates(scope: string, processed = false) {
  const [page, setPage] = useState<CorePage | null>(null);
  const [pageOwner, setPageOwner] = useState(scope);
  const [cursor, setCursor] = useState({ scope, offset: 0 });
  const offset = cursor.scope === scope ? cursor.offset : 0;
  const setOffset = (value: number) => setCursor({ scope, offset: value });
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++epoch.current;
    try {
      const value = await coreApi.list(offset, processed);
      if (token !== epoch.current) return false;
      const lastOffset = Math.floor(Math.max(0, value.total - 1) / 8) * 8;
      if (offset > lastOffset) {
        setCursor({ scope, offset: lastOffset });
        return false;
      }
      setPageOwner(scope);
      setPage(value);
      setError("");
      return true;
    } catch (e) {
      if (token === epoch.current) {
        setPageOwner(scope);
        setError((e as Error).message);
      }
      return false;
    }
  }, [scope, offset, processed]);
  useEffect(() => {
    setPage(null);
    setError("");
    void refresh();
    const pull = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const timer = setInterval(pull, 15000);
    window.addEventListener("zhijun-memory-changed", pull);
    window.addEventListener("focus", pull);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener("zhijun-memory-changed", pull);
      window.removeEventListener("focus", pull);
    };
  }, [refresh]);
  return {
    scope,
    page: pageOwner === scope ? page : null,
    error: pageOwner === scope ? error : "",
    refresh,
    offset,
    setOffset,
  };
}
function ProcessedCandidates({
  scope,
  onSelect,
}: {
  scope: string;
  onSelect: (id: string) => void;
}) {
  const queue = useCoreCandidates(scope, true);
  return (
    <>
      {queue.error && (
        <p role="alert">
          {queue.error}
          <button onClick={() => void queue.refresh()}>重新读取</button>
        </p>
      )}
      {queue.page?.items.map((c) => (
        <button
          key={c.id}
          className="reverb-row"
          onClick={() => onSelect(c.id)}
        >
          <span className="reverb-row-title">{c.title}</span>
          <small>
            {c.core_status === "admitted"
              ? "已加入本体"
              : c.core_status === "rejected"
              ? "未加入"
              : "已停止使用"}
          </small>
          <span className="reverb-row-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      ))}
      {queue.page && !queue.page.items.length && (
        <p className="muted fine">还没有已处理的理解。</p>
      )}
      {queue.page && queue.page.total > 8 && (
        <Pages
          offset={queue.offset}
          step={8}
          more={queue.page.has_more}
          onChange={queue.setOffset}
        />
      )}
    </>
  );
}
export function CoreCandidates({
  queue,
  selectedId,
  onSelect,
  onDiscuss,
  onSource,
  switchingDisabled,
}: {
  queue: ReturnType<typeof useCoreCandidates>;
  selectedId: string;
  onSelect: (id: string) => void;
  onDiscuss: (claim: OntologyClaim) => Promise<boolean>;
  onSource: (r: MemoryReference) => void;
  switchingDisabled: boolean;
}) {
  const [processedOpen, setProcessedOpen] = useState(false);
  const [selected, setSelected] = useState<OntologyClaim | null>(null);
  const [editing, setEditing] = useState<{
    statement: string;
    conditions: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [undo, setUndo] = useState<{
    claim: OntologyClaim;
    version: string;
  } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const found = queue.page?.items.find((c) => c.id === selectedId);
    if (found && !editing) setSelected(found);
    if (!selectedId) {
      setSelected(null);
      setEditing(null);
    }
  }, [selectedId, queue.page]);
  useEffect(() => {
    if (!selectedId || queue.page?.items.some((c) => c.id === selectedId))
      return;
    let active = true;
    ontologyApi
      .get()
      .then((doc) => {
        if (active)
          setSelected(doc.claims.find((c) => c.id === selectedId) || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedId]);
  async function act(
    claim: OntologyClaim,
    command: Omit<CoreCommand, "request_id" | "expected_version">,
  ) {
    if (busy || uncertain) return;
    setBusy(true);
    setNote("");
    try {
      const result = await verifiedCoreReview(claim, command);
      if (!alive.current) return;
      const saved = result.ontology.claims.find((c) => c.id === claim.id)!;
      setSelected(saved);
      setEditing(null);
      setUndo(
        command.action === "restore"
          ? null
          : result.previous_version
          ? { claim: saved, version: result.previous_version }
          : null,
      );
      setNote(
        command.action === "admit"
          ? "已加入本体"
          : command.action === "edit_candidate"
          ? "已保存改写，请确认最终表述后加入本体。"
          : command.action === "later"
          ? "先放在这里，今天不再提醒。"
          : command.action === "reject"
          ? "这项理解不再提出。"
          : "已撤销这次操作。",
      );
      await queue.refresh();
    } catch (e) {
      if (alive.current) {
        setUncertain(true);
        setNote((e as Error).message);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const ready =
    selected && ["pending", "snoozed"].includes(selected.core_status || "");
  return (
    <section className="core-candidates" aria-label="待你确认">
      <div className="reverb-list-heading">
        <span>待你确认</span>
        <small>{queue.page?.total || 0} 条</small>
      </div>
      {note && (
        <p className="core-notice" role="status">
          {note}{" "}
          {undo && !uncertain && (
            <button
              className="quiet"
              disabled={busy}
              onClick={() =>
                void act(undo.claim, {
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
      {queue.error && (
        <p role="alert">
          候选未能读取：{queue.error}
          <button onClick={() => void queue.refresh()}>重新读取</button>
        </p>
      )}
      {uncertain && (
        <button
          onClick={async () => {
            try {
              const doc = await ontologyApi.get();
              if (alive.current) {
                setSelected(
                  doc.claims.find((c) => c.id === selectedId) || null,
                );
                setUncertain(false);
                setEditing(null);
                await queue.refresh();
              }
            } catch (e) {
              if (alive.current) setNote((e as Error).message);
            }
          }}
        >
          重新读取并核对
        </button>
      )}
      {selected ? (
        <div className="core-candidate-detail">
          <button className="quiet" onClick={() => onSelect("")}>
            ← 待确认列表
          </button>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(selected, { action: "edit_candidate", ...editing });
              }}
            >
              <label>
                理解表述
                <textarea
                  aria-label="候选表述"
                  maxLength={400}
                  required
                  value={editing.statement}
                  onChange={(e) =>
                    setEditing({ ...editing, statement: e.target.value })
                  }
                />
              </label>
              <label>
                适用范围
                <input
                  aria-label="候选适用范围"
                  maxLength={300}
                  value={editing.conditions}
                  onChange={(e) =>
                    setEditing({ ...editing, conditions: e.target.value })
                  }
                />
              </label>
              <div className="actions">
                <button
                  disabled={busy || uncertain || !editing.statement.trim()}
                >
                  保存改写
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  取消
                </button>
              </div>
            </form>
          ) : (
            <>
              <h3>{selected.statement}</h3>
              <p className="muted">
                适用于：{selected.conditions || "范围还可以与你核对"}
              </p>
              <CoreEvidence claim={selected} onSource={onSource} />
              {!selected.evidence_valid && (
                <p className="muted">
                  依据发生变化，请先核对或按自己的理解改写。
                </p>
              )}
              {ready && (
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || uncertain || !selected.evidence_valid}
                    onClick={() => void act(selected, { action: "admit" })}
                  >
                    确认加入本体
                  </button>
                  <button
                    disabled={busy || uncertain}
                    onClick={() =>
                      setEditing({
                        statement: selected.statement,
                        conditions: selected.conditions,
                      })
                    }
                  >
                    改一下
                  </button>
                  <button
                    disabled={busy || uncertain}
                    onClick={() => void act(selected, { action: "later" })}
                  >
                    先放着
                  </button>
                </div>
              )}
              <div className="actions">
                <button
                  className="quiet"
                  disabled={
                    busy ||
                    switchingDisabled ||
                    uncertain ||
                    !selected.evidence_valid
                  }
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onDiscuss(selected);
                    } finally {
                      if (alive.current) setBusy(false);
                    }
                  }}
                >
                  聊聊这项理解 ↗
                </button>
                {ready && (
                  <details className="context-menu">
                    <summary aria-label="更多候选操作">···</summary>
                    <div>
                      <button
                        disabled={busy || uncertain}
                        onClick={() => void act(selected, { action: "reject" })}
                      >
                        不加入
                      </button>
                    </div>
                  </details>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {queue.page?.items.map((c) => (
            <button
              key={c.id}
              className="reverb-row core-candidate-row"
              onClick={() => onSelect(c.id)}
            >
              <span className="reverb-row-title">{c.title}</span>
              <small>
                {c.conditions}
                {c.core_status === "snoozed" ? " · 先放着" : ""}
              </small>
              <span className="reverb-row-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
          {queue.page && !queue.page.items.length && (
            <p className="muted fine">
              新的长期理解会先留在这里，等你亲自确认。
            </p>
          )}
          {queue.page && queue.page.total > 8 && (
            <Pages
              offset={queue.offset}
              step={8}
              more={queue.page.has_more}
              onChange={queue.setOffset}
            />
          )}
          <details onToggle={(e) => setProcessedOpen(e.currentTarget.open)}>
            <summary>已处理 ↗</summary>
            {processedOpen && (
              <ProcessedCandidates scope={queue.scope} onSelect={onSelect} />
            )}
          </details>
        </>
      )}
    </section>
  );
}
