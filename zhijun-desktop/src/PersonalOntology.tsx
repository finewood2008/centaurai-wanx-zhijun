import { useEffect, useRef, useState } from "react";
import {
  ontologyApi,
  isCore,
  isCandidate,
  openCoreQueue,
  verifiedCoreReview,
  type OntologyClaim,
  type CoreCommand,
  type PersonalOntology,
} from "./ontology";
import { useResource, State } from "./memoryUi";
import type { MemoryReference } from "./references";
import { OntologyMap } from "./OntologyMap";
import { PersonalContext } from "./PersonalContext";
import { CoreEvidence } from "./CoreEvidence";
import { MemoryMaintenanceAction } from "./MemoryMaintenance";

export function PersonalOntologyView({
  agentId,
  onSource,
  onDiscuss,
  initialContextId = "",
}: {
  agentId: string;
  onSource: (r: MemoryReference) => void;
  onDiscuss: (s: string) => void;
  initialContextId?: string;
}) {
  const data = useResource(agentId, ontologyApi.get);
  const [actual, setActual] = useState<PersonalOntology | null>(null);
  const [profileView, setProfileView] = useState("ontology");
  const [selected, setSelected] = useState("");
  const [contextSelected, setContextSelected] = useState("");
  const [editing, setEditing] = useState<{
    statement: string;
    conditions: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<{ id: string; version: string } | null>(
    null,
  );
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const clear = () => setActual(null);
    window.addEventListener("zhijun-memory-changed", clear);
    return () => {
      alive.current = false;
      window.removeEventListener("zhijun-memory-changed", clear);
    };
  }, [agentId]);
  useEffect(() => {
    if (initialContextId.startsWith("/ontology/")) {
      setSelected(initialContextId.slice(10));
      setProfileView("ontology");
    } else if (initialContextId) {
      setContextSelected(initialContextId);
      setProfileView("materials");
    }
  }, [initialContextId]);
  const doc = actual || data.data;
  const cores = doc?.claims.filter(isCore) || [];
  const candidates = doc?.claims.filter(isCandidate) || [];
  const claim = cores.find((c) => c.id === selected);
  const selectedCandidate = candidates.find((c) => c.id === selected);
  const select = (id: string) => {
    setSelected(id);
    setEditing(null);
    setProfileView("ontology");
  };
  async function act(
    target: OntologyClaim,
    command: Omit<CoreCommand, "expected_version" | "request_id">,
  ) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await verifiedCoreReview(target, command);
      if (!alive.current) return;
      setActual(result.ontology);
      setEditing(null);
      setUndo(
        command.action === "restore"
          ? null
          : result.previous_version
          ? { id: target.id, version: result.previous_version }
          : null,
      );
      setMessage(
        command.action === "disable"
          ? "已停止使用这项理解。"
          : command.action === "restore"
          ? "已恢复。"
          : "已保存修改。",
      );
    } catch (e) {
      if (alive.current) setMessage((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="ontology-panel profile-panel" aria-label="个人本体">
      <div
        className="memory-subtabs"
        role="group"
        aria-label="用户画像浏览方式"
      >
        <button
          aria-pressed={profileView === "ontology"}
          onClick={() => setProfileView("ontology")}
        >
          个人本体
        </button>
        <button
          aria-pressed={profileView === "materials"}
          onClick={() => setProfileView("materials")}
        >
          记忆资料
        </button>
      </div>
      <div hidden={profileView !== "ontology"} className="profile-ontology">
        <header className="section-heading">
          <h3>个人本体</h3>
          <button
            className="quiet core-queue-link"
            onClick={() => openCoreQueue()}
          >
            待你确认{candidates.length ? ` · ${candidates.length}` : ""} ↗
          </button>
        </header>
        <State resource={data} />
        {doc && (
          <div className="profile-map">
            <OntologyMap
              doc={doc}
              selected={selected}
              onSelect={select}
              expanded={false}
            />
          </div>
        )}
        <p className="muted fine core-summary">
          {cores.length
            ? `已确认 ${cores.length} 项理解。点选雷达节点，查看与调整。`
            : "待确认的理解在小机器人里，由你决定哪些成为本体。"}
        </p>
        {selectedCandidate && (
          <button
            className="quiet"
            onClick={() => openCoreQueue(selectedCandidate.id)}
          >
            这项理解等待你的确认，去看看 ↗
          </button>
        )}
        {message && (
          <p role="status" className="core-notice">
            {message}{" "}
            {undo && (
              <button
                className="quiet"
                disabled={busy}
                onClick={() => {
                  const target = doc?.claims.find((c) => c.id === undo.id);
                  if (target)
                    void act(target, {
                      action: "restore",
                      restore_version: undo.version,
                    });
                }}
              >
                撤销
              </button>
            )}{" "}
            <button
              className="quiet"
              onClick={() => {
                setActual(null);
                data.refresh();
              }}
            >
              重新读取
            </button>
          </p>
        )}
        {claim && (
          <article className="core-detail" aria-label="选中的本体理解">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(claim, { action: "edit_core", ...editing });
                }}
              >
                <label>
                  这项理解
                  <textarea
                    aria-label="理解表述"
                    required
                    maxLength={400}
                    value={editing.statement}
                    onChange={(e) =>
                      setEditing({ ...editing, statement: e.target.value })
                    }
                  />
                </label>
                <label>
                  适用范围
                  <input
                    aria-label="适用范围"
                    maxLength={300}
                    value={editing.conditions}
                    onChange={(e) =>
                      setEditing({ ...editing, conditions: e.target.value })
                    }
                  />
                </label>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || !editing.statement.trim()}
                  >
                    保存修改
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h4>{claim.statement}</h4>
                {claim.conditions && (
                  <p className="muted">{claim.conditions}</p>
                )}
                <div
                  className="core-importance"
                  role="group"
                  aria-label="这项理解的重要程度"
                >
                  <span>重要程度</span>
                  {([1, 2, 3] as const).map((level, i) => (
                    <button
                      key={level}
                      aria-pressed={(claim.importance || 1) === level}
                      disabled={busy}
                      onClick={() =>
                        void act(claim, {
                          action: "importance",
                          importance: level,
                        })
                      }
                    >
                      {["一般", "重要", "非常重要"][i]}
                    </button>
                  ))}
                </div>
                <div className="actions core-actions">
                  <button
                    className="quiet"
                    title="修改这项理解"
                    onClick={() =>
                      setEditing({
                        statement: claim.statement,
                        conditions: claim.conditions,
                      })
                    }
                  >
                    ✎ 修改
                  </button>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => void act(claim, { action: "disable" })}
                  >
                    停止使用
                  </button>
                </div>
                <CoreEvidence claim={claim} onSource={onSource} />
                {!!claim.history?.length && (
                  <details className="core-history">
                    <summary>历史与恢复 ↗</summary>
                    {[...claim.history].reverse().map((h) => (
                      <div className="ontology-version" key={h.version}>
                        <p>{h.value.statement}</p>
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() =>
                            void act(claim, {
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
              </>
            )}
          </article>
        )}
        {!!doc?.claims.some((c) => c.core_status === "inactive") && (
          <details className="core-history">
            <summary>已停止使用 ↗</summary>
            {doc.claims
              .filter((c) => c.core_status === "inactive")
              .map((c) => (
                <div className="ontology-version" key={c.id}>
                  <p>{c.statement}</p>
                  {c.history?.length && (
                    <button
                      disabled={busy}
                      className="quiet"
                      onClick={() =>
                        void act(c, {
                          action: "restore",
                          restore_version:
                            c.history![c.history!.length - 1].version,
                        })
                      }
                    >
                      恢复上一版本
                    </button>
                  )}
                  <MemoryMaintenanceAction kind="ontology" id={c.id} />
                </div>
              ))}
          </details>
        )}
      </div>
      <div className="profile-materials" hidden={profileView !== "materials"}>
        {profileView === "materials" && <State resource={data} />}{" "}
        {doc && (
          <PersonalContext
            key={agentId}
            doc={doc}
            standalone
            selected={contextSelected}
            onSelect={setContextSelected}
            onChange={setActual}
            onSource={onSource}
            onDiscuss={onDiscuss}
            onClaim={select}
          />
        )}
      </div>
    </section>
  );
}
