import { useEffect, useState } from "react";
import type { AtomItem } from "../../dashboard/src/api/modules/memoryDashboard";
import { isAtomDeprecated } from "../../dashboard/src/api/modules/memoryDashboard";
import type { MemoryReference } from "./references";
import { Notice } from "./App";
import { MemoryMaintenanceAction } from "./MemoryMaintenance";
import { apiErrorMessage } from "../../dashboard/src/utils/apiError";

export function useResource<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1);
    window.addEventListener("zhijun-memory-changed", changed);
    window.addEventListener("zhijun-service-restored", changed);
    return () => {
      window.removeEventListener("zhijun-memory-changed", changed);
      window.removeEventListener("zhijun-service-restored", changed);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setData(null);
    void load()
      .then(
        (value) => {
          if (alive) setData(value);
        },
        (e) => {
          if (alive) setError(apiErrorMessage(e, "暂时无法读取，请稍后重试。"));
        },
      )
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, revision]);
  return { data, error, loading, refresh: () => setRevision((n) => n + 1) };
}

export function State({
  resource,
}: {
  resource: { loading: boolean; error: string; refresh: () => void };
}) {
  return resource.loading ? (
    <p className="muted">正在读取…</p>
  ) : resource.error ? (
    <Notice>
      读取未完成：{resource.error}{" "}
      <button onClick={resource.refresh}>重试读取</button>
    </Notice>
  ) : null;
}

export function Pages({
  offset,
  step,
  more,
  onChange,
}: {
  offset: number;
  step: number;
  more: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="actions pagination">
      <button
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - step))}
      >
        上一页
      </button>
      <span>第 {Math.floor(offset / step) + 1} 页</span>
      <button disabled={!more} onClick={() => onChange(offset + step)}>
        下一页
      </button>
    </div>
  );
}

export const statusLabel: Record<string, string> = {
  pending: "待整理",
  needs_review: "待核对",
  conflict: "存在不同说法",
  promoted: "已提炼",
  rejected: "已拒绝",
};
const kindLabel = {
  Fact: "已记录的说法",
  Decision: "做过的选择",
  Task: "眼下的事",
  Preference: "在意与偏好",
  ConflictCandidate: "有待核对",
};

export function MemoryCard({
  atom,
  onSource,
  onDiscuss,
}: {
  atom: AtomItem;
  onSource: (ref: MemoryReference) => void;
  onDiscuss: (text: string) => void;
}) {
  return (
    <article className="memory-card">
      <small>
        {isAtomDeprecated(atom)
          ? "已弃用 · 历史留存"
          : kindLabel[atom.kind || "Fact"]}
      </small>
      <p>{atom.assertion}</p>
      <div className="actions">
        <button
          onClick={() =>
            onSource({ layer: "atom", id: atom.id, path: `atom/${atom.id}.md` })
          }
        >
          依据与修正
        </button>
        <button
          onClick={() =>
            onDiscuss(
              `我想核对记忆 atom/${atom.id}.md：“${atom.assertion}”。请先用 memory_get 读取这条记忆和关联的原话，再听我的补充：`,
            )
          }
        >
          在对话里核对
        </button>
      </div>
      <MemoryMaintenanceAction kind="atom" id={atom.id} />
    </article>
  );
}
