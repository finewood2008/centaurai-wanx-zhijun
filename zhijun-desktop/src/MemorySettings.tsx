import { useState } from "react";
import {
  memoryDashboardApi as memory,
  type ExtractConfig,
} from "../../dashboard/src/api/modules/memoryDashboard";
import { agentApi } from "../../dashboard/src/api/modules/agent";
import { providerApi } from "../../dashboard/src/api/modules/provider";
import type { ProactiveCareConfig } from "../../dashboard/src/api/types";
import { State, useResource } from "./memoryUi";
import { Notice } from "./App";
import { personalWeixinApi } from "../../dashboard/src/api/modules/personalWeixin";
import { understandingApi, useUnderstanding } from "./understanding";

export function ExtractionSettings({ agentId }: { agentId: string }) {
  const data = useResource(agentId, () => memory.getExtractConfig(agentId));
  return (
    <>
      <State resource={data} />
      {data.data && (
        <ExtractionForm
          key={JSON.stringify(data.data)}
          agentId={agentId}
          initial={data.data}
          refresh={data.refresh}
        />
      )}
    </>
  );
}
function ExtractionForm({
  agentId,
  initial,
  refresh,
}: {
  agentId: string;
  initial: ExtractConfig;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const models = useResource(agentId, () => providerApi.listResolvedModels());
  return (
    <form
      className="memory-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || error) return;
        setBusy(true);
        setSaved(false);
        try {
          await memory.putExtractConfig(agentId, draft);
          const actual = await memory.getExtractConfig(agentId);
          if (
            Object.entries(draft).some(([key, value]) =>
              key === "aux_model"
                ? (actual.aux_model || "") !== (value || "")
                : actual[key as keyof ExtractConfig] !== value,
            )
          )
            throw new Error("服务端配置与本次提交不同");
          setDraft(actual);
          setSaved(true);
        } catch (e) {
          setError(
            `保存结果尚未核实：${(e as Error).message}。请重新读取后核对。`,
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">使用万象原生提炼机制；调整只影响这份知君档案。</p>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.memory_enabled !== false}
          onChange={(e) =>
            setDraft({ ...draft, memory_enabled: e.target.checked })
          }
        />
        积累记忆
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.extract_on_session_end}
          onChange={(e) =>
            setDraft({ ...draft, extract_on_session_end: e.target.checked })
          }
        />
        会话结束时提炼
      </label>
      <label>
        提炼时机
        <select
          value={draft.extract_trigger_mode}
          onChange={(e) =>
            setDraft({
              ...draft,
              extract_trigger_mode: e.target
                .value as ExtractConfig["extract_trigger_mode"],
            })
          }
        >
          <option value="idle">对话空闲后</option>
          <option value="interval">按间隔整理</option>
        </select>
      </label>
      <label>
        {draft.extract_trigger_mode === "idle" ? "空闲秒数" : "间隔秒数"}
        <input
          type="number"
          min={draft.extract_trigger_mode === "idle" ? 60 : 300}
          max={604800}
          required
          value={
            draft.extract_trigger_mode === "idle"
              ? draft.extract_idle_seconds
              : draft.extract_interval_seconds
          }
          onChange={(e) =>
            setDraft({
              ...draft,
              [draft.extract_trigger_mode === "idle"
                ? "extract_idle_seconds"
                : "extract_interval_seconds"]: Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        提炼模型
        <select
          value={draft.aux_model || ""}
          onChange={(e) => setDraft({ ...draft, aux_model: e.target.value })}
        >
          <option value="">跟随对话模型</option>
          {draft.aux_model &&
            !models.data?.some(
              (m) => `${m.provider_name}/${m.model}` === draft.aux_model,
            ) && <option value={draft.aux_model}>{draft.aux_model}</option>}
          {models.data?.map((m) => (
            <option
              key={`${m.provider_name}/${m.model}`}
              value={`${m.provider_name}/${m.model}`}
            >
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <State resource={models} />
      {error && (
        <Notice>
          {error}{" "}
          <button type="button" disabled={busy} onClick={refresh}>
            重新读取配置
          </button>
        </Notice>
      )}
      {saved && <p role="status">已保存，并读取服务端配置核实。</p>}
      <button disabled={busy || !!error}>
        {busy ? "正在核实…" : "保存提炼设置"}
      </button>
    </form>
  );
}
export function CareSettings({ agentId }: { agentId: string }) {
  const data = useResource(agentId, () =>
    agentApi.getProactiveCareConfig(agentId),
  );
  const [careEnabled, setCareEnabled] = useState<boolean | null>(null);
  return (
    <>
      <State resource={data} />
      {data.data && (
        <CareForm
          key={JSON.stringify(data.data)}
          agentId={agentId}
          initial={data.data}
          refresh={data.refresh}
          onSaved={setCareEnabled}
        />
      )}
      <KnowledgeInvitationSettings
        agentId={agentId}
        careEnabled={careEnabled ?? data.data?.enabled ?? false}
      />
    </>
  );
}
function CareForm({
  agentId,
  initial,
  refresh,
  onSaved,
}: {
  agentId: string;
  initial: ProactiveCareConfig;
  refresh: () => void;
  onSaved: (enabled: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="memory-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || error) return;
        setBusy(true);
        setSaved(false);
        try {
          await agentApi.updateProactiveCareConfig(agentId, draft);
          const actual = await agentApi.getProactiveCareConfig(agentId);
          if (
            [
              "enabled",
              "active_hours_start",
              "active_hours_end",
              "min_interval_hours",
              "max_interval_hours",
            ].some(
              (key) =>
                actual[key as keyof ProactiveCareConfig] !==
                draft[key as keyof ProactiveCareConfig],
            )
          )
            throw new Error("服务端配置与本次提交不同");
          setDraft(actual);
          setSaved(true);
          onSaved(actual.enabled);
        } catch (e) {
          setError(`保存结果尚未核实：${(e as Error).message}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        由你决定是否开启。开启后，知君可能在设定时段主动发来关心；微信连接可接收这份档案的消息。时间使用服务端时区。
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        开启主动关心
      </label>
      <div className="date-range">
        <label>
          开始时间
          <input
            type="time"
            required
            value={draft.active_hours_start}
            onChange={(e) =>
              setDraft({ ...draft, active_hours_start: e.target.value })
            }
          />
        </label>
        <label>
          结束时间
          <input
            type="time"
            required
            value={draft.active_hours_end}
            onChange={(e) =>
              setDraft({ ...draft, active_hours_end: e.target.value })
            }
          />
        </label>
      </div>
      <label>
        最短间隔（小时）
        <input
          type="number"
          min={1}
          required
          value={draft.min_interval_hours}
          onChange={(e) =>
            setDraft({ ...draft, min_interval_hours: Number(e.target.value) })
          }
        />
      </label>
      <label>
        最长间隔（小时）
        <input
          type="number"
          min={draft.min_interval_hours}
          required
          value={draft.max_interval_hours}
          onChange={(e) =>
            setDraft({ ...draft, max_interval_hours: Number(e.target.value) })
          }
        />
      </label>
      {error && (
        <Notice>
          {error}{" "}
          <button type="button" disabled={busy} onClick={refresh}>
            重新读取配置
          </button>
        </Notice>
      )}
      {saved && <p role="status">已保存，并读取服务端配置核实。</p>}
      <button disabled={busy || !!error}>
        {busy ? "正在核实…" : "保存主动关心设置"}
      </button>
    </form>
  );
}

function KnowledgeInvitationSettings({
  agentId,
  careEnabled,
}: {
  agentId: string;
  careEnabled: boolean;
}) {
  const state = useUnderstanding(agentId);
  const connections = useResource(agentId, () =>
    personalWeixinApi.list(agentId),
  );
  const [saved, setSaved] = useState(false);
  const connected = connections.data?.some(
    (row) =>
      row.kind === "weixin" &&
      row.agent_id === agentId &&
      row.enabled &&
      row.runtime?.connected,
  );
  return (
    <section
      className="knowledge-invitation-settings"
      aria-label="资料理解邀请设置"
    >
      <h4>资料理解邀请</h4>
      <p className="muted fine">
        知君读到值得与你核对的线索时，可在本人微信中邀请你接着聊。共用主动关心的时段与间隔，每天最多一条。
      </p>
      <label className="check">
        <input
          type="checkbox"
          aria-label="在微信接收资料理解邀请"
          checked={state.data?.weixin_reminders || false}
          disabled={state.busy || !state.data || !careEnabled || !connected}
          onChange={async (event) => {
            if (!state.data) return;
            const enabled = event.target.checked;
            setSaved(false);
            const result = await state.mutate(() =>
              understandingApi.save({
                revision: state.data!.revision,
                enabled: state.data!.enabled,
                libraries: state.data!.libraries.map(
                  ({ kb_id, role, selected }) => ({ kb_id, role, selected }),
                ),
                weixin_reminders: enabled,
              }),
            );
            if (result?.weixin_reminders === enabled) setSaved(true);
          }}
        />
        在微信接收资料理解邀请
      </label>
      {!careEnabled && (
        <p className="muted fine">先开启主动关心，再选择微信提醒。</p>
      )}
      {careEnabled && !connected && (
        <p className="muted fine">本人微信连接运行后，才可开启。</p>
      )}
      {(state.error || connections.error) && (
        <Notice>
          {state.error || connections.error}
          <button
            onClick={() => {
              void state.refresh();
              connections.refresh();
            }}
          >
            重新读取邀请设置
          </button>
        </Notice>
      )}
      {saved && (
        <p className="muted fine" role="status">
          邀请设置已保存，并读取服务端核实。
        </p>
      )}
    </section>
  );
}
