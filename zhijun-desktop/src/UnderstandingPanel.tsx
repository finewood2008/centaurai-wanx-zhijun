import { useEffect, useState } from "react";
import { Notice } from "./App";
import type { MemoryReference } from "./references";
import { Pages } from "./memoryUi";
import {
  understandingApi,
  understandingReference,
  useUnderstanding,
  type UnderstandingLibrary,
  type UnderstandingInvitation,
  type DocumentReading,
} from "./understanding";

const statusNames = {
  idle: "尚未开始",
  pending: "等待阅读",
  running: "正在理解资料",
  paused: "已暂停",
  failed: "部分阅读未完成",
  complete: "当前范围已读完",
};
const failureNames: Record<string, string> = {
  source_not_ready: "部分资料正文尚未整理完成，会在就绪后继续阅读。",
  synthesis_unavailable:
    "综合理解暂未完成，已读进度和已有理解仍保留，可稍后重试。",
  understanding_write_not_verified:
    "本次保存结果尚未核实，请重新读取；不会显示为已经完成。",
  unverified_reading_proposal:
    "本次理解线索尚未通过原文核验，已保留阅读进度；可稍后重新检查资料。",
};
const readingStatusNames: Record<DocumentReading["status"], string> = {
  pending: "等待阅读",
  reading: "已读一部分",
  complete: "当前版本已读完",
  failed: "理解未完成",
  unavailable: "正文尚未就绪",
};
function ReadingRanges({
  documents,
}: {
  documents?: Record<string, DocumentReading>;
}) {
  const [offset, setOffset] = useState(0);
  const readings = Object.entries(documents || {});
  const step = 20;
  const pageOffset = Math.min(
    offset,
    Math.max(0, Math.floor((readings.length - 1) / step) * step),
  );
  if (!readings.length) return null;
  return (
    <details className="understanding-clues understanding-reading">
      <summary>资料阅读范围 · {readings.length} 份</summary>
      <p className="muted fine">
        按正文从开头顺序阅读。这里显示当前资料版本的已读范围与尚待处理的内容。
      </p>
      {readings.slice(pageOffset, pageOffset + step).map(([key, reading]) => (
        <article key={key}>
          <div className="understanding-reading-heading">
            <strong>{reading.filename}</strong>
            <span className="muted fine">
              {readingStatusNames[reading.status]}
            </span>
          </div>
          <p className="muted fine">
            已读 {reading.offset.toLocaleString()}
            {reading.total_chars || reading.status === "complete"
              ? ` / ${reading.total_chars.toLocaleString()} 字`
              : " 字 · 总字数尚未就绪"}
          </p>
          {reading.last_error && (
            <p className="muted fine">
              {failureNames[reading.last_error] || reading.last_error}
            </p>
          )}
        </article>
      ))}
      {readings.length > step && (
        <Pages
          offset={pageOffset}
          step={step}
          more={readings.length > pageOffset + step}
          onChange={setOffset}
        />
      )}
    </details>
  );
}
function UnderstandingJourney({
  progress,
  clues,
}: {
  progress: {
    characters_total: number;
    characters_read: number;
    documents_total: number;
    documents_read: number;
    status: keyof typeof statusNames;
  };
  clues: number;
}) {
  const ratio =
    progress.characters_total > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(
              (progress.characters_read / progress.characters_total) * 100,
            ),
          ),
        )
      : 0;
  return (
    <div className="understanding-journey">
      <div className="understanding-summary">
        <span className="reading-state">{statusNames[progress.status]}</span>
        <span className="reading-count">
          {progress.documents_read} / {progress.documents_total} 份资料
        </span>
        <span className="reading-percentage">
          <span>正文已读</span> <strong>{ratio}</strong>
          <small>%</small>
        </span>
      </div>
      <div className="understanding-summary-notes">
        <span>{clues} 条线索可继续聊</span>
        <small>阅读进度，不等于对你的理解程度</small>
      </div>
    </div>
  );
}

export function UnderstandingPanel({
  agentId,
  libraryId,
  expanded,
  onToggle,
  onSource,
  onUpdated,
}: {
  agentId: string;
  libraryId?: string;
  expanded: boolean;
  onToggle: () => void;
  onSource: (source: MemoryReference) => void;
  onUpdated: () => void;
}) {
  const state = useUnderstanding(agentId);
  const [libraries, setLibraries] = useState<UnderstandingLibrary[] | null>(
    null,
  );
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (state.data && !settings)
      setLibraries(
        libraryId
          ? state.data.libraries.filter((row) => row.kb_id === libraryId)
          : state.data.libraries,
      );
  }, [state.data, settings, libraryId]);
  useEffect(() => {
    if (state.data?.progress.status === "complete") onUpdated();
  }, [state.data?.progress.status]);
  useEffect(() => {
    if (libraryId) void state.refresh();
  }, [libraryId]);
  const doc = state.data;
  const started = !!doc && (doc.enabled || doc.progress.status !== "idle");
  const available =
    doc?.invitations.filter(
      (item) =>
        item.source_available !== false &&
        ["pending", "active", "snoozed"].includes(item.status),
    ) || [];
  const proposals = available.filter(
    (item) =>
      item.role === "personal" && (item.suggested_statement || item.meaning),
  );
  const clues = available.filter((item) => !proposals.includes(item));
  const save = async (run: boolean) => {
    if (!doc || !libraries?.length || state.busy) return;
    setNotice("");
    const value = await state.mutate(async () => {
      const saved = await understandingApi.save({
        revision: doc.revision,
        enabled: run || doc.enabled,
        libraries: doc.libraries
          .map((row) => ({
            ...row,
            selected:
              libraries.find((item) => item.kb_id === row.kb_id)?.selected ??
              false,
            role:
              libraries.find((item) => item.kb_id === row.kb_id)?.role ??
              row.role,
          }))
          .map(({ kb_id, role, selected }) => ({
            kb_id,
            role,
            selected,
          })),
      });
      return run ? understandingApi.run(saved.revision) : saved;
    });
    if (value) {
      setSettings(false);
      setNotice(
        run
          ? "已开始深入理解。新增和变化的资料会继续阅读，你可以随时暂停。"
          : "已保存参与范围。未选择的资料不再参与理解。",
      );
      onUpdated();
    }
  };
  return (
    <section className="understanding-panel" aria-label="资料与深入理解">
      {!expanded && doc && started && (
        <button className="understanding-status" onClick={onToggle}>
          {statusNames[doc.progress.status]} · {doc.progress.documents_read}/
          {doc.progress.documents_total} 份资料
        </button>
      )}
      {expanded && (
        <>
          <div className="understanding-heading">
            <div>
              <h4>让知君，更理解你</h4>
              <p className="muted fine">
                从你的记录里，看见经历、选择与在意的事。每一份理解，都可以与你核对。
              </p>
            </div>
            <button onClick={onToggle} aria-label="收起深入理解">
              收起
            </button>
          </div>
          {state.error && (
            <Notice>
              {state.error}{" "}
              <button onClick={() => void state.refresh()}>重新读取</button>
            </Notice>
          )}
          {!doc && !state.error && <p className="muted">正在读取资料范围…</p>}
          {doc && (
            <>
              <UnderstandingJourney
                progress={doc.progress}
                clues={available.length}
              />
              <details
                className="understanding-model"
                open={!started || settings}
              >
                <summary>阅读模型</summary>
                <p>
                  综合理解模型 · <strong>{doc.model.name}</strong>
                </p>
                <span className="muted fine">
                  {doc.model.local
                    ? "在本机理解所选正文"
                    : "在线模型会读取所选资料正文"}
                </span>
              </details>
              {(!started || settings) && (
                <div
                  className="understanding-scope"
                  aria-label="参与理解的资料库"
                >
                  <p className="muted fine">
                    选择资料的性质，并决定是否让知君持续阅读。新增文件会沿用这里的设置。
                  </p>
                  {(
                    libraries ||
                    (libraryId
                      ? doc.libraries.filter((row) => row.kb_id === libraryId)
                      : doc.libraries)
                  ).map((library) => (
                    <div className="understanding-library" key={library.kb_id}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={library.selected}
                          disabled={state.busy}
                          onChange={(e) => {
                            const selected = e.currentTarget.checked;
                            setSettings(true);
                            setLibraries(
                              (
                                libraries ||
                                (libraryId
                                  ? doc.libraries.filter(
                                      (row) => row.kb_id === libraryId,
                                    )
                                  : doc.libraries)
                              ).map((row) =>
                                row.kb_id === library.kb_id
                                  ? { ...row, selected }
                                  : row,
                              ),
                            );
                          }}
                        />
                        {library.name}
                      </label>
                      <select
                        aria-label={`${library.name}的资料归属`}
                        disabled={state.busy}
                        value={library.role}
                        onChange={(e) => {
                          const role = e.currentTarget
                            .value as UnderstandingLibrary["role"];
                          setSettings(true);
                          setLibraries(
                            (
                              libraries ||
                              (libraryId
                                ? doc.libraries.filter(
                                    (row) => row.kb_id === libraryId,
                                  )
                                : doc.libraries)
                            ).map((row) =>
                              row.kb_id === library.kb_id
                                ? {
                                    ...row,
                                    role,
                                  }
                                : row,
                            ),
                          );
                        }}
                      >
                        <option value="mixed">混合资料</option>
                        <option value="personal">个人记录</option>
                        <option value="reference">参考资料</option>
                      </select>
                    </div>
                  ))}
                  {!doc.libraries.length && (
                    <p className="muted fine">
                      正在连接账号资料。也可以先从已有交谈中形成理解。
                    </p>
                  )}
                  <p className="muted fine">
                    个人记录可以提出待核对的理解；参考与混合资料先提供线索和问题。标注不代表认可全部内容。
                  </p>
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={
                        state.busy ||
                        !!state.error ||
                        !libraries?.some((row) => row.selected)
                      }
                      onClick={() => void save(true)}
                    >
                      {state.busy
                        ? "正在核实…"
                        : doc.enabled
                        ? "保存并继续理解"
                        : "开始深入理解"}
                    </button>
                    {doc.enabled && (
                      <button
                        disabled={state.busy}
                        onClick={() => void save(false)}
                      >
                        只保存范围
                      </button>
                    )}
                  </div>
                </div>
              )}
              {(started || doc.progress.documents_total > 0) && (
                <details
                  className="understanding-management"
                  open={settings || doc.progress.status !== "complete"}
                >
                  <summary>阅读管理与详细进度</summary>
                  {started && !settings && (
                    <button onClick={() => setSettings(true)}>
                      调整阅读与资料性质
                    </button>
                  )}
                  <div className="understanding-progress" role="status">
                    <strong>本次阅读</strong>
                    <p className="muted fine">
                      已读 {doc.progress.documents_read} /{" "}
                      {doc.progress.documents_total} 份 ·{" "}
                      {doc.progress.characters_read.toLocaleString()} /{" "}
                      {doc.progress.characters_total.toLocaleString()} 字
                    </p>
                    <progress
                      aria-label="资料阅读进度"
                      max={Math.max(1, doc.progress.characters_total)}
                      value={doc.progress.characters_read}
                    />
                    <p className="muted fine">
                      {doc.progress.pending_documents} 份尚待处理
                      {doc.progress.failed_documents
                        ? ` · ${doc.progress.failed_documents} 份未完成`
                        : ""}
                    </p>
                    {doc.progress.last_error && (
                      <Notice>
                        {failureNames[doc.progress.last_error] ||
                          doc.progress.last_error}
                      </Notice>
                    )}
                    <div className="actions">
                      {doc.enabled ? (
                        <button
                          disabled={state.busy}
                          onClick={() =>
                            void state.mutate(() =>
                              understandingApi.pause(doc.revision),
                            )
                          }
                        >
                          暂停持续理解
                        </button>
                      ) : (
                        <button
                          disabled={state.busy}
                          onClick={() => void save(true)}
                        >
                          继续深入理解
                        </button>
                      )}
                      {doc.enabled && (
                        <button
                          disabled={state.busy}
                          onClick={() =>
                            void state.mutate(() =>
                              understandingApi.run(doc.revision),
                            )
                          }
                        >
                          重新检查资料
                        </button>
                      )}
                    </div>
                  </div>
                </details>
              )}
              <ReadingRanges key={agentId} documents={doc.documents} />
              {!!proposals.length && (
                <details className="understanding-clues understanding-proposals">
                  <summary>待核对的理解 · {proposals.length}</summary>
                  <p className="muted fine">
                    这些是从个人记录提出的理解线索，尚待你说明和核对，不会直接成为个人本体。
                  </p>
                  {proposals.map((item) => (
                    <article key={item.id}>
                      <h4>{item.title}</h4>
                      <p>{item.suggested_statement || item.meaning}</p>
                      {item.suggested_statement && item.meaning && (
                        <p className="muted fine">可能的含义：{item.meaning}</p>
                      )}
                      <dl className="understanding-proposal-scope">
                        {item.conditions && (
                          <>
                            <dt>适用情境</dt>
                            <dd>{item.conditions}</dd>
                          </>
                        )}
                        {item.time_scope && (
                          <>
                            <dt>时间范围</dt>
                            <dd>{item.time_scope}</dd>
                          </>
                        )}
                        {item.exceptions && (
                          <>
                            <dt>例外与保留</dt>
                            <dd>{item.exceptions}</dd>
                          </>
                        )}
                      </dl>
                      <blockquote>{item.quote}</blockquote>
                      <p className="muted fine">想与你核对：{item.question}</p>
                      <button
                        onClick={() =>
                          onSource(understandingReference(item.source))
                        }
                      >
                        查看原文依据
                      </button>
                      <small className="muted">
                        可以回到对话，按自己的理解补充、纠正，或暂不展开。
                      </small>
                    </article>
                  ))}
                </details>
              )}
              {!!clues.length && (
                <details className="understanding-clues">
                  <summary>资料中，值得一起聊的线索</summary>
                  {clues.map((item) => (
                    <article key={item.id}>
                      <h4>{item.title}</h4>
                      <p>{item.question}</p>
                      <button
                        onClick={() =>
                          onSource(understandingReference(item.source))
                        }
                      >
                        查看原文依据
                      </button>
                      <small className="muted">
                        可回到对话，按自己的节奏展开。
                      </small>
                    </article>
                  ))}
                </details>
              )}
            </>
          )}
          {notice && (
            <p role="status" className="muted fine">
              {notice}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function InvitationCard({
  invitation,
  active,
  busy,
  error,
  onReview,
  onSource,
  onRemove,
}: {
  invitation: UnderstandingInvitation;
  active: boolean;
  busy: boolean;
  error: string;
  onReview: (action: "accept" | "later" | "dismiss") => void;
  onSource: (source: MemoryReference) => void;
  onRemove: () => void;
}) {
  if (invitation.source_available === false) return null;
  return (
    <section
      className={`understanding-invitation${active ? " active" : ""}`}
      aria-label={active ? "这次交谈的资料背景" : "来自资料的交谈邀请"}
    >
      <div className="invitation-heading">
        <small>
          {active ? "这次一起想想" : "读到一处，想听你说说"} ·{" "}
          {invitation.title}
        </small>
        {active && (
          <button aria-label="移除本次邀请背景" onClick={onRemove}>
            ×
          </button>
        )}
      </div>
      {!active && invitation.quote && (
        <blockquote>{invitation.quote}</blockquote>
      )}
      <p>{invitation.question}</p>
      <div className="actions">
        <button
          className="invitation-source"
          onClick={() => onSource(understandingReference(invitation.source))}
        >
          原文 · {invitation.source.filename}
        </button>
        {!active && (
          <>
            <button disabled={busy} onClick={() => onReview("accept")}>
              聊聊
            </button>
            <button disabled={busy} onClick={() => onReview("later")}>
              稍后
            </button>
            <button disabled={busy} onClick={() => onReview("dismiss")}>
              不再提醒
            </button>
          </>
        )}
      </div>
      {active && (
        <small className="muted">
          你可以说自己的理解，也可以说这与你无关。
        </small>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
