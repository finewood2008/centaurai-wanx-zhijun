import { useEffect, useRef, useState } from "react";
import {
  uploadFile,
  getUploadedSource,
} from "../../dashboard/src/api/modules/upload";
import type { ChatAttachment } from "../../dashboard/src/pages/Chat/hooks/sseHelpers";
import { inferAttachmentKind } from "../../dashboard/src/pages/Chat/utils/chatAttachments";
import { useServerUploadLimit } from "../../dashboard/src/hooks/useServerUploadLimit";
import { apiErrorMessage } from "../../dashboard/src/utils/apiError";
import { inboundPath } from "./attachmentPaths";
import { Notice } from "./App";
import { State, useResource } from "./memoryUi";

type FileDraft = {
  id: number;
  file: File;
  state: "uploading" | "ready" | "failed";
  attachment?: ChatAttachment;
  extractionStatus?: string;
  error?: string;
};
export function useAttachmentDraft(agentId: string, scopeKey: string) {
  const { maxUploadBytes, maxUploadMb } = useServerUploadLimit();
  const [stores, setStores] = useState<Record<string, FileDraft[]>>({});
  const generations = useRef(new Map<string, number>());
  const owner = useRef({ agentId, epoch: 0 });
  if (owner.current.agentId !== agentId) {
    owner.current = { agentId, epoch: owner.current.epoch + 1 };
    generations.current.clear();
  }
  useEffect(() => {
    setStores({});
  }, [agentId]);
  const alive = useRef(true);
  const nextId = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const items = stores[scopeKey] ?? [];
  const upload = async (row: FileDraft) => {
    const generation = generations.current.get(scopeKey) ?? 0;
    const ownerEpoch = owner.current.epoch;
    const update = (next: Partial<FileDraft>) => {
      if (
        alive.current &&
        owner.current.epoch === ownerEpoch &&
        (generations.current.get(scopeKey) ?? 0) === generation
      )
        setStores((old) => ({
          ...old,
          [scopeKey]: (old[scopeKey] ?? []).map((item) =>
            item.id === row.id ? { ...item, ...next } : item,
          ),
        }));
    };
    if (row.file.size > maxUploadBytes) {
      update({
        state: "failed",
        error: `超过本机单文件 ${maxUploadMb} MB 限制。`,
      });
      return;
    }
    update({ state: "uploading", error: "" });
    try {
      const result = await uploadFile(agentId, row.file);
      const path = inboundPath(result.workspace_path || result.path);
      if (!path) throw new Error("服务返回的文件来源未核实。");
      update({
        state: "ready",
        extractionStatus: result.extraction_status ?? undefined,
        error: result.extraction_error ?? undefined,
        attachment: {
          filename: result.filename,
          mediaType: result.media_type,
          workspacePath: path,
          url: result.access_url || result.url,
          kind: inferAttachmentKind(row.file, result.media_type),
        },
      });
    } catch (error) {
      update({
        state: "failed",
        error: apiErrorMessage(error, "上传未完成，请重试或移除此文件。"),
      });
    }
  };
  return {
    items,
    busy: items.some((row) => row.state === "uploading"),
    unresolved: items.some((row) => row.state !== "ready"),
    ready: items.flatMap((row) =>
      row.state === "ready" && row.attachment ? [row.attachment] : [],
    ),
    add: (files: FileList | File[]) => {
      const rows: FileDraft[] = Array.from(files).map((file) => ({
        id: ++nextId.current,
        file,
        state: "uploading",
      }));
      setStores((old) => ({
        ...old,
        [scopeKey]: [...(old[scopeKey] ?? []), ...rows],
      }));
      for (const row of rows) void upload(row);
    },
    retry: (row: FileDraft) => {
      void upload(row);
    },
    remove: (id: number) =>
      setStores((old) => ({
        ...old,
        [scopeKey]: (old[scopeKey] ?? []).filter((row) => row.id !== id),
      })),
    clear: () => {
      generations.current.set(
        scopeKey,
        (generations.current.get(scopeKey) ?? 0) + 1,
      );
      setStores((old) => ({ ...old, [scopeKey]: [] }));
    },
  };
}

export const sourceStatus: Record<string, string> = {
  ready: "正文已读取",
  pending: "等待本地处理",
  processing: "本地处理中",
  failed: "正文读取未完成",
  unsupported: "暂不支持读取此格式",
  empty: "没有可读取正文",
};

export function AttachmentSource({
  agentId,
  path,
}: {
  agentId: string;
  path: string;
}) {
  const [offset, setOffset] = useState(0);
  const data = useResource(`${agentId}:${path}:${offset}`, async () => {
    const safePath = inboundPath(path);
    if (!safePath) throw new Error("文件来源路径无效。");
    const source = await getUploadedSource(agentId, safePath, {
      offset,
      limit: 6000,
    });
    if (source.path !== safePath)
      throw new Error("读取结果与文件来源不一致，请重新核对。");
    return source;
  });
  return (
    <>
      <p className="muted fine">文件来源 · {path}</p>
      <State resource={data} />
      {data.data && (
        <>
          <h3>{data.data.filename}</h3>
          <p className="muted">
            {sourceStatus[data.data.status] || data.data.status} ·{" "}
            {data.data.media_type}
          </p>
          {data.data.error && (
            <Notice>
              {data.data.error}
              <button onClick={data.refresh}>重新读取</button>
            </Notice>
          )}
          <pre className="source-text">
            {data.data.content || "此文件当前没有可展示的正文。"}
          </pre>
          {data.data.truncated && (
            <p className="muted fine">
              显示本地提取范围内的正文，内容有截断；这不是完整文件。
            </p>
          )}
          <div className="actions">
            <button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 6000))}
            >
              上一段
            </button>
            <span>
              正文 {data.data.total_chars} 字符 · 第{" "}
              {Math.floor(offset / 6000) + 1} 段
            </span>
            <button
              disabled={!data.data.has_more}
              onClick={() => setOffset(offset + 6000)}
            >
              下一段
            </button>
            <button onClick={data.refresh}>刷新正文</button>
          </div>
        </>
      )}
    </>
  );
}
