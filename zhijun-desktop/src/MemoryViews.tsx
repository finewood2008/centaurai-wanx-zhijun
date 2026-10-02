import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import {
  memoryDashboardApi as memory,
  type CandidateItem,
  type EntityItem,
  type RawEventItem,
} from "../../dashboard/src/api/modules/memoryDashboard";
import { useServerTimezone } from "../../dashboard/src/hooks/useServerTimezone";
import {
  formatServerIsoDateTime,
  formatServerYmd,
  formatServerHourMinute,
} from "../../dashboard/src/utils/formatMessageTime";
import type { OctopAgent } from "../../dashboard/src/context/AgentContext";
import type { OctopUser } from "../../dashboard/src/api/modules/auth";
import {
  dateBounds,
  emotionLabel,
  emotionLabels,
  episodeApi,
  recentSevenDays,
  stageReviewDraft,
} from "./memory";
import { MemoryCard, Pages, State, statusLabel, useResource } from "./memoryUi";
import { Notice } from "./App";
import {
  MemoryJournal,
  RawMaterials,
  readableMemoryNote,
} from "./MemoryRecords";
import { CareSettings, ExtractionSettings } from "./MemorySettings";
import { WeixinSettings } from "./WeixinSettings";
import { ReadingPreferences } from "./ReadingPreferences";
import { PersonalOntologyView } from "./PersonalOntology";
import { ontologyApi, type PersonalOntology } from "./ontology";
import { ContextAssociations } from "./PersonalContext";
import type { MemoryReference } from "./references";
import { MemoryMaintenanceAction, ArchivedMemories } from "./MemoryMaintenance";

type MemoryProps = {
  agentId: string;
  onSource: (ref: MemoryReference) => void;
  onDiscuss: (text: string) => void;
  onContext?: (id: string) => void;
  initialContextId?: string;
};

export function MemoryPanel(props: MemoryProps) {
  const [view, setView] = useState("about");
  const [treeView, setTreeView] = useState("themes");
  const [reviewView, setReviewView] = useState("review");
  const [contextId, setContextId] = useState("");
  const linked = {
    ...props,
    onContext: (id: string) => {
      setContextId(id);
      setView("about");
    },
  };
  return (
    <>
      {view !== "about" && view !== "review" && (
        <p className="muted">
          经历留下线索，理解也会慢慢变化。每一条都可以回到原话。
        </p>
      )}
      <div className="tabs" aria-label="记忆视角">
        {[
          ["about", "用户画像"],
          ["themes", "记忆树"],
          ["episodes", "情绪日记"],
          ["review", "记忆沉淀"],
        ].map(([key, title]) => (
          <button
            key={key}
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            {title}
          </button>
        ))}
      </div>
      {view === "themes" && (
        <>
          <div className="memory-view-switch" aria-label="记忆树浏览方式">
            {[
              ["themes", "按主题"],
              ["atoms", "全部记忆"],
            ].map(([key, title]) => (
              <button
                key={key}
                aria-pressed={treeView === key}
                onClick={() => setTreeView(key)}
              >
                {title}
              </button>
            ))}
          </div>
          {treeView === "themes" ? (
            <Themes {...linked} />
          ) : (
            <AtomBrowser {...linked} />
          )}
        </>
      )}
      {view === "episodes" && <Episodes {...linked} />}
      {view === "about" && (
        <Understanding {...props} initialContextId={contextId} />
      )}
      {view === "review" && (
        <>
          <div className="memory-view-switch" aria-label="记忆沉淀内容">
            {[
              ["review", "理解核对"],
              ["journal", "整理记录"],
              ["raw", "原始素材"],
              ["archived", "已移出"],
            ].map(([key, title]) => (
              <button
                key={key}
                aria-pressed={reviewView === key}
                onClick={() => setReviewView(key)}
              >
                {title}
              </button>
            ))}
          </div>
          {reviewView === "archived" && (
            <ArchivedMemories agentId={props.agentId} />
          )}
          {reviewView === "review" && <Review {...props} />}
          {reviewView === "journal" && (
            <MemoryJournal agentId={props.agentId} onSource={props.onSource} />
          )}
          {reviewView === "raw" && (
            <RawMaterials agentId={props.agentId} onSource={props.onSource} />
          )}
        </>
      )}
    </>
  );
}

function Themes(props: MemoryProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const data = useResource(`${props.agentId}:${search}:${offset}`, async () => {
    const [entities, ontology] = await Promise.allSettled([
      memory.listEntities(props.agentId, {
        query: search || undefined,
        limit: 20,
        offset,
        order_by: "atom_count",
        order: "desc",
      }),
      ontologyApi.get(),
    ]);
    if (entities.status === "rejected") throw entities.reason;
    return {
      ...entities.value,
      ontology: ontology.status === "fulfilled" ? ontology.value : null,
    };
  });
  return (
    <>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
          setOffset(0);
        }}
      >
        <input
          aria-label="搜索主题"
          placeholder="一个人、一件事、一个项目"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button>查找</button>
      </form>
      <p className="muted fine">
        展开主题，沿着记忆树回到具体经历。摘要由原生整理形成。
      </p>
      <State resource={data} />
      {data.data && !data.data.ontology && (
        <p className="muted fine">当前本体暂不可读取，下面只展示原生记录。</p>
      )}
      {data.data && (
        <>
          <div className="memory-tree" aria-label="我的记忆树">
            <div className="memory-tree-root">
              <span>我的记忆</span>
              <small>{data.data.total} 个主题</small>
            </div>
            {data.data.items
              .filter((entity) => {
                const current = data.data?.ontology?.nodes?.find(
                  (n) => n.id === `entity:${entity.id}`,
                );
                return (
                  !current ||
                  (current.state === "active" && !current.merged_into)
                );
              })
              .map((entity) => (
                <ThemeBranch
                  key={entity.id}
                  {...props}
                  entity={entity}
                  ontology={data.data!.ontology || undefined}
                />
              ))}
          </div>
          {!data.data.items.length && (
            <p className="muted">
              主题会随着交谈逐渐形成。现在可以先聊聊近况。
            </p>
          )}
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

function ThemeBranch({
  entity,
  ontology,
  ...props
}: MemoryProps & { entity: EntityItem; ontology?: PersonalOntology }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [offset, setOffset] = useState(0);
  return (
    <section className="theme-branch">
      <button
        className="theme-title"
        aria-expanded={open}
        onClick={() => {
          setVisited(true);
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>{" "}
        {ontology?.nodes?.find((n) => n.id === `entity:${entity.id}`)?.title ||
          entity.canonical_name}
        <small>{entity.atom_count} 条记忆</small>
      </button>
      {visited && (
        <div hidden={!open}>
          <ThemeContent
            {...props}
            entity={entity}
            ontology={ontology}
            offset={offset}
            setOffset={setOffset}
          />
        </div>
      )}
    </section>
  );
}

function ThemeContent({
  entity,
  ontology,
  offset,
  setOffset,
  ...props
}: MemoryProps & {
  entity: EntityItem;
  ontology?: PersonalOntology;
  offset: number;
  setOffset: (n: number) => void;
}) {
  const data = useResource(
    `${props.agentId}:${entity.id}:${offset}`,
    async () => {
      const context = ontology?.nodes?.find(
        (n) => n.id === `entity:${entity.id}`,
      );
      const factIds = new Set(
        ontology?.links
          ?.filter(
            (l) =>
              l.kind === "about" &&
              l.target === context?.id &&
              l.state !== "dismissed",
          )
          .map((l) => l.source),
      );
      const facts = (ontology?.nodes || []).filter(
        (n) =>
          factIds.has(n.id) &&
          n.state === "active" &&
          n.evidence_valid &&
          !n.merged_into &&
          n.native_ids.length,
      );
      if (context) {
        const [detail, items] = await Promise.all([
          memory.getEntity(props.agentId, entity.id),
          Promise.all(
            facts
              .slice(offset, offset + 20)
              .map(async (n) => ({
                ...(await memory.getAtom(props.agentId, n.native_ids[0])),
                assertion: n.statement,
              })),
          ),
        ]);
        return {
          detail,
          atoms: {
            items,
            total: facts.length,
            has_more: offset + 20 < facts.length,
          },
        };
      }
      const [detail, atoms] = await Promise.all([
        memory.getEntity(props.agentId, entity.id),
        memory.listAtoms(props.agentId, {
          entity_id: entity.id,
          offset,
          limit: 20,
          order_by: "importance",
          order: "desc",
        }),
      ]);
      return { detail, atoms };
    },
  );
  return (
    <div className="theme-content">
      <MemoryMaintenanceAction kind="entity" id={entity.id} />
      <State resource={data} />
      {ontology && (
        <ContextAssociations
          doc={ontology}
          id={`entity:${entity.id}`}
          onSelect={(id) => {
            if (props.onContext) {
              props.onContext(id);
              return;
            }
            const n = ontology.nodes?.find((n) => n.id === id);
            const raw = n?.evidence[0]?.event_id;
            if (raw)
              props.onSource({
                layer: "raw",
                id: raw,
                path: `/raw_events/${raw}`,
              });
          }}
          onClaim={(id) => props.onContext?.(`/ontology/${id}`)}
        />
      )}
      {data.data && (
        <>
          {data.data.detail.page?.dirty && (
            <Notice>主题摘要正在等待原生重新整理。</Notice>
          )}
          <details className="theme-summary">
            <summary>查看原生摘要</summary>
            {!!ontology?.nodes?.some(
              (n) => n.owner_edited && n.native_ids.includes(entity.id),
            ) && (
              <p className="muted fine">
                下面保留整理当时的摘要，当前名称与修正以个人上下文为准。
              </p>
            )}
            <Markdown
              components={{ a: ({ children }) => <span>{children}</span> }}
            >
              {data.data.detail.page?.summary_markdown ||
                "尚未形成摘要，可以先查看具体记忆。"}
            </Markdown>
          </details>
          <button
            className="theme-discuss"
            onClick={() =>
              props.onDiscuss(
                `我想继续聊主题 page/${entity.id}.md：“${
                  ontology?.nodes?.find((n) => n.id === `entity:${entity.id}`)
                    ?.title || entity.canonical_name
                }”。请查证当前本体、主题记忆及原话，历史摘要若已有修正，采用当前表述。再听我说说现在的情况：`,
              )
            }
          >
            沿着这个主题继续聊
          </button>
          {data.data.atoms.items
            .filter((atom, i, all) => {
              const node = ontology?.nodes?.find(
                (n) => n.kind === "fact" && n.native_ids.includes(atom.id),
              );
              return (
                !node ||
                (node.state === "active" &&
                  !node.merged_into &&
                  node.evidence_valid &&
                  !all.slice(0, i).some((a) => node.native_ids.includes(a.id)))
              );
            })
            .map((atom) => (
              <MemoryCard
                key={atom.id}
                atom={{
                  ...atom,
                  assertion:
                    ontology?.nodes?.find(
                      (n) =>
                        n.kind === "fact" && n.native_ids.includes(atom.id),
                    )?.statement || atom.assertion,
                }}
                onSource={props.onSource}
                onDiscuss={props.onDiscuss}
              />
            ))}
          {!data.data.atoms.items.length && (
            <p className="muted">这个主题暂时没有有效记忆。</p>
          )}
          <Pages
            offset={offset}
            step={20}
            more={data.data.atoms.has_more}
            onChange={setOffset}
          />
        </>
      )}
    </div>
  );
}

export function Understanding({
  agentId,
  onSource,
  onDiscuss,
  initialContextId,
}: MemoryProps) {
  return (
    <>
      <PersonalOntologyView
        key={agentId}
        agentId={agentId}
        onSource={onSource}
        onDiscuss={onDiscuss}
        initialContextId={initialContextId}
      />
    </>
  );
}

function AtomBrowser(props: MemoryProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const [assertion, setAssertion] = useState("");
  const [entity, setEntity] = useState("");
  const [entityType, setEntityType] = useState("User");
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState("");
  const data = useResource(
    `${props.agentId}:${search}:${history}:${offset}`,
    async () => {
      const [atoms, ontology] = await Promise.allSettled([
        memory.listAtoms(props.agentId, {
          query: search || undefined,
          include_deprecated: history,
          offset,
          limit: 20,
        }),
        ontologyApi.get(),
      ]);
      if (atoms.status === "rejected") throw atoms.reason;
      return {
        ...atoms.value,
        ontology: ontology.status === "fulfilled" ? ontology.value : null,
      };
    },
  );
  return (
    <>
      <button aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
        补充一条记忆
      </button>
      {adding && (
        <form
          className="memory-settings"
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving || writeError) return;
            setSaving(true);
            try {
              const created = await memory.createAtom(props.agentId, {
                assertion: assertion.trim(),
                entity_name: entity.trim(),
                entity_type: entityType,
                kind: "Fact",
                reason: "本人在知君中补充",
              });
              const actual = await memory.getAtom(
                props.agentId,
                created.atom.id,
              );
              if (actual.assertion !== assertion.trim())
                throw new Error("新增记忆尚未读回");
              setAdding(false);
              setAssertion("");
              setEntity("");
              data.refresh();
            } catch (e) {
              setWriteError(
                `补充结果尚未核实：${
                  (e as Error).message
                }。请读取记忆列表核对后再操作。`,
              );
              data.refresh();
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            归属主题
            <input
              required
              maxLength={160}
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              placeholder="例如：我、一个项目或一段关系"
            />
          </label>
          <label>
            主题类型
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            >
              {[
                ["User", "本人"],
                ["Person", "人物"],
                ["Project", "项目"],
                ["Decision", "决定"],
                ["Task", "任务"],
                ["Fact", "其他事项"],
              ].map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            记忆内容
            <textarea
              required
              maxLength={8000}
              value={assertion}
              onChange={(e) => setAssertion(e.target.value)}
            />
          </label>
          <p className="muted fine">
            保存这条本人补充的说法，后续仍可查看依据、修正和弃用。
          </p>
          <button disabled={saving || !!writeError}>确认保存</button>
        </form>
      )}
      {writeError && (
        <Notice>
          {writeError}{" "}
          <button
            disabled={saving}
            onClick={() => {
              data.refresh();
              setWriteError("");
            }}
          >
            重新读取列表
          </button>
        </Notice>
      )}
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
          setOffset(0);
        }}
      >
        <input
          aria-label="搜索记忆"
          value={query}
          placeholder="找一句话或一件事"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button>查找</button>
      </form>
      <label className="check">
        <input
          type="checkbox"
          checked={history}
          onChange={(e) => {
            setHistory(e.target.checked);
            setOffset(0);
          }}
        />
        也看已弃用的历史
      </label>
      <State resource={data} />
      {data.data && (
        <>
          {data.data.items
            .filter((atom) => {
              const node = data.data!.ontology?.nodes?.find(
                (n) => n.kind === "fact" && n.native_ids.includes(atom.id),
              );
              return (
                history ||
                !node ||
                (node.state === "active" &&
                  node.evidence_valid &&
                  !node.merged_into)
              );
            })
            .map((atom) => (
              <div key={atom.id}>
                <MemoryCard
                  key={atom.id}
                  atom={{
                    ...atom,
                    assertion:
                      data.data!.ontology?.nodes?.find(
                        (n) =>
                          n.kind === "fact" &&
                          n.native_ids.includes(atom.id) &&
                          n.state === "active",
                      )?.statement || atom.assertion,
                  }}
                  onSource={props.onSource}
                  onDiscuss={props.onDiscuss}
                />
                {data.data!.ontology?.nodes?.some((n) =>
                  n.native_ids.includes(atom.id),
                ) && (
                  <button
                    className="quiet-action"
                    onClick={() =>
                      props.onContext?.(
                        data.data!.ontology!.nodes!.find((n) =>
                          n.native_ids.includes(atom.id),
                        )!.id,
                      )
                    }
                  >
                    查看关联的个人上下文
                  </button>
                )}
              </div>
            ))}
          {!data.data.items.length && (
            <p className="muted">没有找到相关记录。</p>
          )}
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

export function Episodes({
  agentId,
  onSource,
  onDiscuss,
  onContext,
}: MemoryProps) {
  const timezone = useServerTimezone();
  const recent = recentSevenDays(timezone);
  const [query, setQuery] = useState("");
  const [emotion, setEmotion] = useState("");
  const [topic, setTopic] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState({
    query: "",
    emotion: "",
    topic: "",
    from: "",
    to: "",
  });
  const [offset, setOffset] = useState(0);
  const [customRange, setCustomRange] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const reviewFrom = customRange?.from ?? recent.from;
  const reviewTo = customRange?.to ?? recent.to;
  const data = useResource(
    `${agentId}:${timezone}:${JSON.stringify(filters)}:${offset}`,
    async () => {
      const [episodes, ontology] = await Promise.allSettled([
        episodeApi.list(agentId, {
          query: filters.query || undefined,
          emotion: filters.emotion || undefined,
          topic: filters.topic || undefined,
          ...dateBounds(filters.from, filters.to, timezone),
          offset,
          limit: 20,
        }),
        ontologyApi.get(),
      ]);
      if (episodes.status === "rejected") throw episodes.reason;
      return {
        ...episodes.value,
        ontology: ontology.status === "fulfilled" ? ontology.value : null,
      };
    },
  );
  return (
    <>
      <details className="stage-review">
        <summary>回看一段时间</summary>
        <p className="muted fine">
          先准备一段可编辑的话，由你发送。知君会读取这段时间实际留下的材料。
        </p>
        <div className="period-fields">
          <label>
            开始
            <input
              aria-label="阶段回看开始"
              type="date"
              value={reviewFrom}
              onChange={(e) =>
                setCustomRange({ from: e.target.value, to: reviewTo })
              }
            />
          </label>
          <label>
            结束
            <input
              aria-label="阶段回看结束"
              type="date"
              value={reviewTo}
              min={reviewFrom}
              onChange={(e) =>
                setCustomRange({ from: reviewFrom, to: e.target.value })
              }
            />
          </label>
        </div>
        <div className="actions">
          <button
            onClick={() =>
              onDiscuss(stageReviewDraft(recent.from, recent.to, timezone))
            }
          >
            回看最近七天
          </button>
          <button
            disabled={!reviewFrom || !reviewTo || reviewFrom > reviewTo}
            onClick={() =>
              onDiscuss(stageReviewDraft(reviewFrom, reviewTo, timezone))
            }
          >
            回看这段时间
          </button>
        </div>
      </details>
      <details className="diary-filters">
        <summary>查找与筛选</summary>
        <form
          className="episode-filter"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ query, emotion, topic, from, to });
            setOffset(0);
          }}
        >
          <input
            aria-label="搜索经历"
            placeholder="找一段经历"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="period-fields">
            <select
              aria-label="情绪筛选"
              value={emotion}
              onChange={(e) => setEmotion(e.target.value)}
            >
              <option value="">全部情绪</option>
              {Object.entries(emotionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              aria-label="话题筛选"
              placeholder="话题"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
          <div className="period-fields">
            <label>
              从
              <input
                aria-label="经历开始日期"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              至
              <input
                aria-label="经历结束日期"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <button disabled={!!from && !!to && from > to}>筛选经历</button>
        </form>
      </details>
      <p className="muted fine">
        情绪标签来自自动整理，描述当时的经历，可以在交谈中补充核对。
      </p>
      <State resource={data} />
      {data.data && (
        <>
          {[
            ...new Set(
              data.data.items.map((episode) =>
                formatServerYmd(episode.occurred_at, timezone),
              ),
            ),
          ].map((day) => (
            <section
              className="diary-day"
              key={day}
              aria-label={`${day} 的情绪日记`}
            >
              <h3>{day}</h3>
              {data
                .data!.items.filter(
                  (episode) =>
                    formatServerYmd(episode.occurred_at, timezone) === day,
                )
                .map((episode) => (
                  <article
                    className="memory-card episode-card"
                    key={episode.id}
                  >
                    <small>
                      {formatServerHourMinute(episode.occurred_at, timezone)}
                      {episode.emotion && (
                        <span className="emotion-tag">
                          {emotionLabel(episode.emotion)}
                        </span>
                      )}
                      {episode.intensity > 0 && (
                        <span
                          className="emotion-intensity"
                          aria-label={`情绪强度 ${episode.intensity}/5`}
                        >
                          {Array.from({ length: 5 }, (_, index) => (
                            <i
                              key={index}
                              className={
                                index < episode.intensity ? "filled" : ""
                              }
                              aria-hidden="true"
                            />
                          ))}
                        </span>
                      )}
                    </small>
                    <p>{episode.summary}</p>
                    {data.data?.ontology && (
                      <ContextAssociations
                        doc={data.data.ontology}
                        id={`episode:${episode.id}`}
                        onSelect={(id) => onContext?.(id)}
                        onClaim={(id) => onContext?.(`/ontology/${id}`)}
                      />
                    )}
                    <MemoryMaintenanceAction kind="episode" id={episode.id} />
                    {episode.topics?.length > 0 && (
                      <small>{episode.topics.join(" · ")}</small>
                    )}
                    <div className="actions">
                      <button
                        onClick={() =>
                          onSource({
                            layer: "episode",
                            id: episode.id,
                            path: `/episodes/${episode.id}`,
                          })
                        }
                      >
                        查看经历与原话
                      </button>
                      <button
                        onClick={() =>
                          onDiscuss(
                            `我想回看经历 /episodes/${episode.id}：“${episode.summary}”。请先用 zhijun_episode_get 读取这段经历及原话，再听我说说现在的理解：`,
                          )
                        }
                      >
                        回看这段经历
                      </button>
                    </div>
                  </article>
                ))}
            </section>
          ))}
          {!data.data.items.length && (
            <p className="muted">
              这段范围暂时没有整理出的经历，原生提炼完成后再看看。
            </p>
          )}
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

export function EpisodeDetail({
  agentId,
  id,
  onDiscuss,
}: {
  agentId: string;
  id: string;
  onDiscuss?: (text: string) => void;
}) {
  const timezone = useServerTimezone();
  const data = useResource(`${agentId}:${id}`, async () => {
    const episode = await episodeApi.get(agentId, id);
    const ids = [
      ...new Set(
        [episode.quote_event_id, ...(episode.raw_event_ids || [])].filter(
          (value): value is string => !!value,
        ),
      ),
    ];
    const reads = await Promise.allSettled(
      ids.map(
        (rawId) => memory.getRawEvent(agentId, rawId) as Promise<RawEventItem>,
      ),
    );
    return {
      episode,
      sources: reads.flatMap((read) =>
        read.status === "fulfilled" ? [read.value] : [],
      ),
      missing: reads.flatMap((read, i) =>
        read.status === "rejected" ? [ids[i]] : [],
      ),
    };
  });
  return (
    <>
      <State resource={data} />
      {data.data && (
        <>
          <p className="muted fine">经历 ID：{id}</p>
          <small>
            {formatServerIsoDateTime(data.data.episode.occurred_at, timezone)}
          </small>
          <h3>{data.data.episode.summary}</h3>
          <MemoryMaintenanceAction kind="episode" id={id} />
          <p>
            <span className="emotion-tag">
              {emotionLabel(data.data.episode.emotion)}
            </span>{" "}
            <small>原生强度：{data.data.episode.intensity} · 当时的经历</small>
          </p>
          <blockquote>
            {data.data.episode.verbatim_quote || "此经历没有附带摘录"}
          </blockquote>
          <p className="muted fine">
            情绪标签目前只读。如果这里不准确，可以在对话里说明；旧记录不会显示成已经修改。
          </p>
          {onDiscuss && (
            <button
              onClick={() =>
                onDiscuss(
                  `我想补充经历 /episodes/${id} 的感受。请用 zhijun_episode_get 查证原话，不直接修改情绪标签。我的补充是：`,
                )
              }
            >
              在对话里补充感受
            </button>
          )}
          <h4>原始记录</h4>
          {data.data.sources.map((raw) => (
            <article key={raw.id} className="memory-card">
              <small>记录 ID：{raw.id}</small>
              <pre className="source-text">{raw.content}</pre>
            </article>
          ))}
          {data.data.missing.length > 0 && (
            <Notice>
              这些来源暂时无法读取：{data.data.missing.join("、")}。
              <button onClick={data.refresh}>重新读取</button>
            </Notice>
          )}
          {!data.data.sources.length && !data.data.missing.length && (
            <p className="muted">此经历未关联可读取的原始记录。</p>
          )}
        </>
      )}
    </>
  );
}

export function Review({ agentId, onSource, onDiscuss }: MemoryProps) {
  const timezone = useServerTimezone();
  const [status, setStatus] = useState<CandidateItem["status"] | "">("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const data = useResource(`${agentId}:${status}:${search}:${offset}`, () =>
    memory.listCandidates(agentId, {
      status: status || undefined,
      query: search || undefined,
      offset,
      limit: 20,
    }),
  );
  const review = async (
    candidate: CandidateItem,
    action: "promote" | "reject",
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (action === "promote")
        await memory.promoteCandidate(agentId, candidate.id);
      else
        await memory.rejectCandidate(agentId, candidate.id, {
          reason: "本人在知君界面拒绝",
        });
      const current = (await memory.getCandidate(
        agentId,
        candidate.id,
      )) as CandidateItem;
      if (current.status !== (action === "promote" ? "promoted" : "rejected"))
        setError(
          `原生处理后的状态：${
            statusLabel[current.status] || current.status
          }。请继续核对。`,
        );
      data.refresh();
    } catch (e) {
      setError(
        `操作结果尚未核实：${
          (e as Error).message
        }。请重新读取并核对结果后再操作。`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sediment-workspace" aria-label="理解核对">
      <p className="sediment-intro">
        理解与原话，放在一起。哪些值得留下，由你核对。
      </p>
      <div className="sediment-toolbar">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query);
            setOffset(0);
          }}
        >
          <input
            aria-label="搜索记忆沉淀"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="查找草稿内容"
          />
          <button>查找</button>
        </form>
        <label className="sediment-filter">
          <span>状态</span>
          <select
            aria-label="候选状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as CandidateItem["status"]);
              setOffset(0);
              setError("");
            }}
          >
            <option value="">全部沉淀状态</option>
            {Object.entries(statusLabel).map(([value, title]) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="sediment-refresh"
          disabled={data.loading || busy}
          onClick={() => {
            setError("");
            data.refresh();
          }}
        >
          刷新
        </button>
      </div>
      <State resource={data} />
      {error && (
        <Notice>
          {error}{" "}
          <button
            disabled={busy}
            onClick={() => {
              setError("");
              data.refresh();
            }}
          >
            重新读取
          </button>
        </Notice>
      )}
      {data.data && (
        <>
          <div className="sediment-list-head">
            <span>当前筛选 · {data.data.total} 条</span>
          </div>
          <div className="sediment-candidates">
            {data.data.items.map((candidate) => (
              <article
                className="sediment-candidate"
                data-status={candidate.status}
                key={candidate.id}
              >
                <header className="sediment-candidate-head">
                  <span className="sediment-kind">
                    {
                      {
                        Fact: "事实",
                        Decision: "决定",
                        Task: "事项",
                        Preference: "偏好",
                        ConflictCandidate: "不同说法",
                      }[candidate.candidate_type]
                    }
                  </span>
                  <span className="sediment-status">
                    {statusLabel[candidate.status]}
                  </span>
                  {candidate.created_at && (
                    <time dateTime={candidate.created_at}>
                      {formatServerIsoDateTime(candidate.created_at, timezone)}
                    </time>
                  )}
                </header>
                <p className="sediment-assertion">{candidate.assertion}</p>
                <MemoryMaintenanceAction kind="candidate" id={candidate.id} />
                {candidate.subject_name && (
                  <p className="sediment-subject">
                    关于 ·{" "}
                    {candidate.subject_name === "User"
                      ? "本人"
                      : candidate.subject_name}
                  </p>
                )}
                {candidate.verbatim_quote && (
                  <div className="sediment-evidence">
                    <span>原话依据</span>
                    <blockquote>{candidate.verbatim_quote}</blockquote>
                  </div>
                )}
                {readableMemoryNote(candidate.promotion_reason) && (
                  <p className="sediment-reason">
                    <span>提炼依据</span>
                    {readableMemoryNote(candidate.promotion_reason)}
                  </p>
                )}
                <div className="sediment-candidate-actions">
                  <div className="sediment-source-actions">
                    {candidate.quote_event_id && (
                      <button
                        onClick={() =>
                          onSource({
                            layer: "raw",
                            id: candidate.quote_event_id,
                            path: `/raw_events/${candidate.quote_event_id}`,
                          })
                        }
                      >
                        查看原话
                      </button>
                    )}
                    <button
                      onClick={() =>
                        onDiscuss(
                          `我想核对候选记录 ${candidate.id}：“${
                            candidate.assertion
                          }”。相关原始记录 ID：${
                            [
                              ...new Set(
                                [
                                  candidate.quote_event_id,
                                  ...(candidate.raw_event_ids || []),
                                ].filter(Boolean),
                              ),
                            ].join("、") || "尚未关联"
                          }。请先查证本档案中的原话，区分事实和推测，再听我的补充：`,
                        )
                      }
                    >
                      一起核对
                    </button>
                  </div>
                  {!["promoted", "rejected"].includes(candidate.status) && (
                    <div className="sediment-review-actions">
                      <button
                        className="sediment-accept"
                        disabled={busy || !!error}
                        onClick={() => void review(candidate, "promote")}
                      >
                        采纳
                      </button>
                      <button
                        disabled={busy || !!error}
                        onClick={() => void review(candidate, "reject")}
                      >
                        拒绝
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!data.data.items.length && (
            <p className="sediment-empty">目前没有这类候选记录。</p>
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

export function Preferences({
  agent,
  user,
  logout,
}: {
  agent: OctopAgent;
  user: OctopUser;
  logout: () => void;
}) {
  const [connection, setConnection] = useState("本机服务");
  const [section, setSection] = useState("account");
  useEffect(() => {
    let alive = true;
    void window.zhijunDesktop?.connection().then(
      (info) => {
        if (alive) setConnection(info.url);
      },
      () => {
        if (alive) setConnection("连接信息暂不可用");
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <div className="tabs settings-tabs" aria-label="设置分类">
        {[
          ["account", "账号与服务"],
          ["reading", "阅读与显示"],
          ["weixin", "微信对话"],
          ["care", "主动关心"],
          ["extraction", "提炼设置"],
        ].map(([key, title]) => (
          <button
            key={key}
            aria-pressed={section === key}
            onClick={() => setSection(key)}
          >
            {title}
          </button>
        ))}
      </div>
      {section === "account" && (
        <>
          <p className="eyebrow">知君 · 独立个人档案</p>
          <dl className="account-details">
            <dt>账号</dt>
            <dd>{user.display_name || user.username}</dd>
            <dt>档案</dt>
            <dd>{agent.name}</dd>
            <dt>服务</dt>
            <dd>{connection}</dd>
            <dt>对话模型</dt>
            <dd>{agent.default_model || "使用平台默认模型"}</dd>
          </dl>
          <p className="muted">
            账号由万象验证。知君的会话、记忆和资料在本应用独立积累；模型按本档案配置运行。
          </p>
          <button onClick={logout}>退出账号</button>
        </>
      )}
      {section === "weixin" && (
        <WeixinSettings key={agent.agent_id} agentId={agent.agent_id} />
      )}
      {section === "reading" && <ReadingPreferences />}
      {section === "care" && (
        <section>
          <h3>主动关心</h3>
          <CareSettings key={agent.agent_id} agentId={agent.agent_id} />
        </section>
      )}
      {section === "extraction" && (
        <section>
          <h3>提炼设置</h3>
          <ExtractionSettings key={agent.agent_id} agentId={agent.agent_id} />
        </section>
      )}
    </>
  );
}
