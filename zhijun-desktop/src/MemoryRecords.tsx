import { useState } from "react";
import {
  memoryDashboardApi as memory,
  type JournalItem,
} from "../../dashboard/src/api/modules/memoryDashboard";
import { useServerTimezone } from "../../dashboard/src/hooks/useServerTimezone";
import {
  formatServerIsoDateTime,
  formatServerYmd,
  formatServerHourMinute,
} from "../../dashboard/src/utils/formatMessageTime";
import { State, Pages, useResource } from "./memoryUi";
import { Notice } from "./App";
import type { MemoryReference } from "./references";
import { MemoryMaintenanceAction } from "./MemoryMaintenance";

export function RawMaterials({
  agentId,
  onSource,
}: {
  agentId: string;
  onSource: (r: MemoryReference) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const timezone = useServerTimezone();
  const data = useResource(`${agentId}:${search}:${offset}`, () =>
    memory.listRawEvents(agentId, {
      query: search || undefined,
      offset,
      limit: 20,
    }),
  );
  return (
    <>
      <p className="muted">
        桌面和微信留下的原始表达，都保存在这份档案中。资料内容仍与本人的经历区分。
      </p>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
          setOffset(0);
        }}
      >
        <input
          aria-label="搜索原始素材"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="找一句原话"
        />
        <button>查找</button>
      </form>
      <State resource={data} />
      {data.data && (
        <>
          {data.data.items.map((row) => (
            <article className="memory-card" key={row.id}>
              <small>
                {formatServerIsoDateTime(row.timestamp, timezone)} ·{" "}
                {row.event_type}
              </small>
              <p className="raw-preview">{row.content}</p>
              <MemoryMaintenanceAction kind="raw" id={row.id} />
              <button
                onClick={() =>
                  onSource({
                    layer: "raw",
                    id: row.id,
                    path: `/raw_events/${row.id}`,
                  })
                }
              >
                查看完整原话
              </button>
            </article>
          ))}
          {!data.data.items.length && <p className="muted">暂无这类素材。</p>}
          <Pages
            offset={offset}
            step={20}
            more={data.data.has_more}
            onChange={setOffset}
          />
        </>
      )}
    </>
  );
}

const journalLabels: Record<string, string> = {
  extract_run: "提炼记录",
  capture: "记录表达",
  extract: "生成草稿",
  promote: "提炼为记忆",
  reject: "拒绝候选",
  replace: "修正",
  update: "更新",
  user_edit: "本人修正",
  deprecate: "弃用",
  create: "补充记忆",
  merge: "合并",
  conflict: "发现不同说法",
  needs_review: "需要核对",
  page_regenerate: "更新主题摘要",
  page_regen: "更新主题摘要",
};

const actorLabels: Record<string, string> = {
  system: "知君整理",
  auto: "知君整理",
  agent: "知君整理",
  extractor: "知君整理",
  rule: "知君整理",
  user: "本人操作",
};

const runMetrics = [
  ["events_considered", "查阅表达"],
  ["events_extracted", "处理表达"],
  ["candidates", "生成草稿"],
  ["promoted", "新增记忆"],
  ["merged", "合并"],
  ["conflicts", "不同说法"],
  ["needs_review", "待核对"],
  ["dropped", "未进入记忆"],
] as const;

export function readableMemoryNote(note: string | null | undefined) {
  if (!note) return "";
  const linked = /^entity resolved via alias ['"](.+)['"]$/i.exec(note);
  if (linked) return `关联到已有主题「${linked[1]}」`;
  const created =
    /^no existing entity matched ['"](.+)['"];?\s*will create$/i.exec(note);
  if (created) return `新建主题「${created[1]}」`;
  if (/^User singleton rule:/i.test(note)) return "关联到本人已有记录";
  if (/^cross-entity exact-match assertion already in atom store/i.test(note))
    return "已有相同内容，关联到现有记忆";
  if (/^polarity flip vs atom/i.test(note))
    return "与已有记忆的表述不同，请对照原话核对";
  if (/^atom deprecated without replacement/i.test(note))
    return "已弃用，未替换为其他记忆";
  if (/^semantic duplicate; superseded by /i.test(note))
    return "内容重复，已合并到已有记忆";
  return /[一-鿿]/.test(note) ? note : "";
}

function snapshotText(snapshot: JournalItem["after"]) {
  const fields: Record<string, unknown> = { ...snapshot };
  for (const key of ["assertion", "summary", "title", "content"])
    if (typeof fields[key] === "string" && fields[key])
      return String(fields[key]);
  return "";
}

function JournalEntry({
  row,
  timezone,
  onSource,
}: {
  row: JournalItem;
  timezone: string;
  onSource: (r: MemoryReference) => void;
}) {
  const isRun = row.action === "extract_run";
  const failure = row.after?.failure_reason;
  const metrics = isRun
    ? runMetrics.filter(
        ([key], index) =>
          typeof row.after?.[key] === "number" &&
          (index < 4 || Number(row.after[key]) > 0),
      )
    : [];
  const before = snapshotText(row.before);
  const after = snapshotText(row.after);
  const note = readableMemoryNote(row.note);
  const summary =
    (row.action === "promote" && !before && after
      ? after
      : row.target_summary) ||
    (isRun
      ? "这一轮对话的整理情况"
      : row.target_atom_id
      ? "一条记忆"
      : row.target_entity_id
      ? "一个主题"
      : row.target_candidate_id
      ? "一条草稿"
      : "");
  return (
    <article className="sediment-journal-entry" data-failed={Boolean(failure)}>
      <time dateTime={row.timestamp}>
        {formatServerHourMinute(row.timestamp, timezone)}
      </time>
      <div className="sediment-journal-content">
        <header>
          <span className="sediment-kind">
            {journalLabels[row.action] || row.action}
          </span>
          {!isRun && summary && (
            <span className="sediment-journal-subject">
              {summary === "User" ? "本人" : summary}
            </span>
          )}
          {Boolean(failure) && <span className="sediment-status">未完成</span>}
          <span className="sediment-actor">
            {actorLabels[row.actor] || row.actor}
          </span>
        </header>
        {isRun && <p className="sediment-journal-summary">{summary}</p>}
        {metrics.length > 0 && (
          <dl className="sediment-run-metrics" aria-label="本次提炼数量">
            {metrics.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{String(row.after?.[key])} 条</dd>
              </div>
            ))}
          </dl>
        )}
        {isRun && !metrics.length && (
          <p className="sediment-note">本次未提供提炼数量。</p>
        )}
        {Boolean(failure) && <Notice>提炼未完成：{String(failure)}</Notice>}
        {before && before !== after && (
          <div className="sediment-change">
            <span>整理前</span>
            <p>{before}</p>
          </div>
        )}
        {after && after !== summary && (
          <div className="sediment-change">
            <span>整理后</span>
            <p>{after}</p>
          </div>
        )}
        {note && note !== row.target_summary && (
          <p className="sediment-note">{note}</p>
        )}
        {row.target_atom_id && (
          <button
            className="sediment-record-source"
            onClick={() =>
              onSource({
                layer: "atom",
                id: row.target_atom_id!,
                path: `atom/${row.target_atom_id}.md`,
              })
            }
          >
            查看记忆
          </button>
        )}
      </div>
    </article>
  );
}

export function MemoryJournal({
  agentId,
  onSource,
}: {
  agentId: string;
  onSource: (r: MemoryReference) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const timezone = useServerTimezone();
  const data = useResource(`${agentId}:${action}:${offset}`, () =>
    memory.listJournal(agentId, {
      offset,
      limit: 20,
      action: action || undefined,
    }),
  );
  const days = new Map<string, JournalItem[]>();
  for (const row of data.data?.items || []) {
    const day = formatServerYmd(row.timestamp, timezone);
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(row);
  }
  return (
    <section className="sediment-workspace" aria-label="整理记录">
      <p className="sediment-intro">
        每一次整理，都留下记录。何时处理、留下什么，在这里回看。
      </p>
      <div className="sediment-toolbar sediment-journal-toolbar">
        <label className="sediment-filter">
          <span>整理动作</span>
          <select
            aria-label="整理动作"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">全部</option>
            {Object.entries(journalLabels)
              .filter(([key]) => key !== "page_regenerate")
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <button
          className="sediment-refresh"
          disabled={data.loading}
          onClick={data.refresh}
        >
          刷新
        </button>
      </div>
      <State resource={data} />
      {data.data && (
        <>
          <div className="sediment-list-head">
            <span>当前筛选 · {data.data.total} 条</span>
          </div>
          {Array.from(days, ([day, items]) => (
            <section
              className="sediment-journal-day"
              aria-label={day}
              key={day}
            >
              <h3>
                {day}
                <span>{items.length} 条记录</span>
              </h3>
              <div className="sediment-timeline">
                {items.map((row) => (
                  <JournalEntry
                    key={row.id}
                    row={row}
                    timezone={timezone}
                    onSource={onSource}
                  />
                ))}
              </div>
            </section>
          ))}
          {!data.data.items.length && (
            <p className="sediment-empty">暂无整理记录。</p>
          )}
          <Pages
            offset={offset}
            step={20}
            more={data.data.has_more}
            onChange={setOffset}
          />
        </>
      )}
    </section>
  );
}
