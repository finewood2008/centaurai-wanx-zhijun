import { octopThreadsApi } from "../../dashboard/src/api/modules/octopThreads";
import { verifyAbsent } from "./maintenance";
import { ActionIcon } from "./ActionIcon";
import { useEffect, useRef, useState } from "react";
import { State, useResource } from "./memoryUi";
import {
  maintenanceApi,
  refreshMemory,
  type MemoryKind,
  type MaintenancePreview,
} from "./maintenance";
import { useServerTimezone } from "../../dashboard/src/hooks/useServerTimezone";
import { formatServerIsoDateTime } from "../../dashboard/src/utils/formatMessageTime";

const labels: Record<string, string> = {
  atoms: "记忆",
  raw_events: "原始素材",
  candidates: "候选",
  episodes: "经历",
  entities: "主题",
  digests: "阶段回看",
  ontology: "本体理解",
  relations: "关联",
};

export function DeleteContent({
  title,
  scope,
  onDelete,
  disabled = false,
  label = "删除",
  iconOnly = true,
}: {
  title: string;
  scope: string;
  onDelete: () => Promise<void>;
  disabled?: boolean;
  label?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const remove = async () => {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onDelete();
      if (alive.current) setOpen(false);
    } catch (e) {
      if (alive.current)
        setError(`操作结果未核实：${(e as Error).message}。请重新读取后核对。`);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className={`content-maintenance ${open ? "is-open" : "is-closed"}`}>
      {!open ? (
        <button
          className={
            iconOnly ? "quiet-icon maintenance-trigger" : "quiet-action"
          }
          disabled={disabled}
          aria-label={`${label}：${title}`}
          title={`${label}：${title}`}
          onClick={() => setOpen(true)}
        >
          {iconOnly ? (
            <ActionIcon name={label === "恢复" ? "restore" : "trash"} />
          ) : (
            label
          )}
        </button>
      ) : (
        <div
          className="maintenance-confirm"
          role="group"
          aria-label={`确认${label}`}
        >
          <p>{title}</p>
          <p className="muted fine">{scope}</p>
          <div className="actions">
            <button
              className="danger-action"
              disabled={disabled || busy || !!error}
              onClick={() => void remove()}
            >
              {busy ? "正在核对结果…" : `确认${label}`}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              取消
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function MemoryMaintenanceAction({
  kind,
  id,
}: {
  kind: MemoryKind;
  id: string;
}) {
  const [preview, setPreview] = useState<MaintenancePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await maintenanceApi.preview(kind, id);
      if (result.kind !== kind || result.id !== id)
        throw new Error("目标内容未核实");
      if (alive.current) setPreview(result);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const save = async (action: "archive" | "purge") => {
    if (!preview) return;
    const result = await maintenanceApi.write(preview, action);
    const actual = (await maintenanceApi.list()).items.find(
      (r) => r.archive_id === result.archive_id,
    );
    if (
      !actual ||
      actual.id !== id ||
      actual.kind !== kind ||
      actual.version !== preview.version ||
      actual.status !== (action === "archive" ? "archived" : "purged")
    )
      throw new Error("服务端结果尚未读回");
    if (alive.current) {
      setDone(true);
      setPreview(null);
    }
    refreshMemory();
  };
  if (done) return <small className="muted">已移出日常记忆</small>;
  return (
    <div
      className={`content-maintenance ${
        preview || error ? "is-open" : "is-closed"
      }`}
    >
      {!preview && (
        <button
          className="quiet-icon maintenance-trigger"
          disabled={busy}
          aria-label={busy ? "读取清理范围…" : "移出 / 删除"}
          title="管理这条记忆：移出或删除"
          onClick={() => void load()}
        >
          <ActionIcon name="archive" />
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div className="maintenance-preview">
          <p>{preview.title}</p>
          <p className="muted fine">
            涉及{" "}
            {Object.entries(preview.counts)
              .filter(([key]) => labels[key])
              .map(([key, n]) => `${n} 条${labels[key]}`)
              .join("、")}
            。原有对话、资料文件、其他已移出条目及外部备份需单独清理。
          </p>
          <DeleteContent
            label="停止使用并移出"
            iconOnly={false}
            title={preview.title}
            scope="从当前记忆和召回中移出；可在「记忆沉淀 → 已移出」查看原内容与恢复。关联原话保留供查看，但不再自动参与提炼与召回。"
            onDelete={() => save("archive")}
          />
          <DeleteContent
            label="彻底删除"
            iconOnly={false}
            title={preview.title}
            scope="清除以上记忆及应用内恢复副本，不能撤销。关联原话不再自动参与提炼与召回；已有历史对话仍需单独删除。"
            onDelete={() => save("purge")}
          />
          <button className="quiet-action" onClick={() => setPreview(null)}>
            先保留
          </button>
        </div>
      )}
    </div>
  );
}

export function ArchivedMemories({ agentId }: { agentId: string }) {
  const data = useResource(agentId, maintenanceApi.list);
  const timezone = useServerTimezone();
  return (
    <section aria-label="已移出的记忆">
      <p className="muted">
        移出的内容不参与当前召回。恢复会保留原记录
        ID；遇到新版本冲突时，请先核对。
      </p>
      <State resource={data} />
      {data.data?.items
        .filter((r) => !["purged", "restored"].includes(r.status))
        .map((row) => (
          <article className="memory-card" key={row.archive_id}>
            <small>
              {formatServerIsoDateTime(row.at, timezone)} ·{" "}
              {row.status === "archived" ? "已移出" : "操作尚待核实"}
            </small>
            <p>{row.title}</p>
            <details>
              <summary>查看移出的内容</summary>
              <pre className="source-text">{row.content || row.title}</pre>
            </details>
            {row.status === "archived" && (
              <div className="actions">
                <DeleteContent
                  label="恢复"
                  title={row.title}
                  scope="将原内容放回记忆；新的用户修订不会被覆盖。"
                  onDelete={async () => {
                    await maintenanceApi.archive(row, "restore");
                    const actual = (await maintenanceApi.list()).items.find(
                      (r) => r.archive_id === row.archive_id,
                    );
                    if (actual?.status !== "restored")
                      throw new Error("恢复尚未核实");
                    refreshMemory();
                  }}
                />
                <DeleteContent
                  label="彻底删除"
                  title={row.title}
                  scope="清除应用内恢复副本，不能撤销。对话、原资料和外部备份需单独处理。"
                  onDelete={async () => {
                    await maintenanceApi.archive(row, "purge");
                    const actual = (await maintenanceApi.list()).items.find(
                      (r) => r.archive_id === row.archive_id,
                    );
                    if (actual?.status !== "purged")
                      throw new Error("删除尚未核实");
                    refreshMemory();
                  }}
                />
              </div>
            )}
            {row.status !== "archived" && (
              <button onClick={data.refresh}>重新核对状态</button>
            )}
          </article>
        ))}
      {data.data &&
        !data.data.items.some(
          (r) => !["purged", "restored"].includes(r.status),
        ) && <p className="muted">暂时没有移出的内容。</p>}
    </section>
  );
}

export function ThreadDeletion({
  agentId,
  id,
  title,
  disabled,
  onDeleted,
}: {
  agentId: string;
  id: string;
  title: string;
  disabled?: boolean;
  onDeleted: () => void;
}) {
  return (
    <DeleteContent
      label="删除对话"
      title={title}
      disabled={disabled}
      scope="删除这段对话及其历史，不能撤销。已经提炼出的记忆与本体理解仍保留，可在记忆中单独移出或删除。"
      onDelete={async () => {
        const state = await octopThreadsApi.history(agentId, id, { limit: 1 });
        if (state.turn_active)
          throw new Error("这段对话正在进行，请结束后再清理");
        await octopThreadsApi.delete(agentId, id);
        await verifyAbsent(() =>
          octopThreadsApi.history(agentId, id, { limit: 1 }),
        );
        refreshMemory();
        onDeleted();
      }}
    />
  );
}
