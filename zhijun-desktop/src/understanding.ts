import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../../dashboard/src/api/request";
import {
  apiErrorMessage,
  isNotFoundApiError,
} from "../../dashboard/src/utils/apiError";
import type { MemoryReference } from "./references";
import type { OctopThread } from "../../dashboard/src/api/modules/octopThreads";
import {
  knowledgeBasesApi,
  type KnowledgeDocument,
} from "../../dashboard/src/api/modules/knowledgeBases";

export type LibraryRole = "personal" | "reference" | "mixed";
export type UnderstandingLibrary = {
  kb_id: string;
  name: string;
  default_open: boolean;
  role: LibraryRole;
  selected: boolean;
};
export type KnowledgeEvidence = {
  kb_id: string;
  document_id: string;
  filename: string;
  source_version: string;
  start: number;
  end: number;
};
export type UnderstandingInvitation = {
  id: string;
  title: string;
  question: string;
  summary: string;
  quote: string;
  source: KnowledgeEvidence;
  status:
    | "pending"
    | "active"
    | "snoozed"
    | "resolved"
    | "dismissed"
    | "invalid";
  activation_phrase: string;
  created_at?: string;
  reviewed_at?: string | null;
  read_at?: string | null;
  discussion_thread_id?: string | null;
  snoozed_until?: string | null;
  source_available?: boolean;
  role?: LibraryRole;
  meaning?: string;
  suggested_statement?: string;
  time_scope?: string;
  conditions?: string;
  exceptions?: string;
};
export type DocumentReading = {
  kb_id: string;
  document_id: string;
  filename: string;
  source_version: string;
  offset: number;
  total_chars: number;
  status: "pending" | "reading" | "complete" | "failed" | "unavailable";
  last_error?: string | null;
};
export type UnderstandingState = {
  revision: string;
  enabled: boolean;
  weixin_reminders: boolean;
  libraries: UnderstandingLibrary[];
  model: { name: string; local: boolean };
  progress: {
    status: "idle" | "pending" | "running" | "paused" | "failed" | "complete";
    documents_total: number;
    documents_read: number;
    characters_total: number;
    characters_read: number;
    pending_documents: number;
    failed_documents: number;
    last_error: string | null;
  };
  invitations: UnderstandingInvitation[];
  documents?: Record<string, DocumentReading>;
};
export type UnderstandingSettings = {
  revision: string;
  libraries: Pick<UnderstandingLibrary, "kb_id" | "role" | "selected">[];
  enabled: boolean;
  weixin_reminders?: boolean;
};
export type KnowledgeTextPage = {
  kb_id: string;
  document_id: string;
  filename: string;
  source_version: string;
  text: string;
  start: number;
  end: number;
  total_chars: number;
  has_more: boolean;
  status: "ready" | "stale" | "unavailable";
};
export const understandingApi = {
  get: () => request<UnderstandingState>("/zhijun/understanding"),
  save: (body: UnderstandingSettings) =>
    request<UnderstandingState>("/zhijun/understanding", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  run: (revision: string) =>
    request<UnderstandingState>("/zhijun/understanding:run", {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  pause: (revision: string) =>
    request<UnderstandingState>("/zhijun/understanding:pause", {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  review: (
    id: string,
    revision: string,
    action: "accept" | "later" | "dismiss" | "resolve" | "read",
  ) =>
    request<UnderstandingState>(
      `/zhijun/understanding/invitations/${encodeURIComponent(id)}:review`,
      {
        method: "POST",
        body: JSON.stringify({ revision, action }),
      },
    ),
  conversation: (id: string, revision: string) =>
    request<{ state: UnderstandingState; thread: OctopThread }>(
      `/zhijun/understanding/invitations/${encodeURIComponent(
        id,
      )}:conversation`,
      { method: "POST", body: JSON.stringify({ revision }) },
    ),
  text: (
    source: KnowledgeEvidence,
    start = source.start,
    limit = Math.max(1, source.end - source.start),
  ) =>
    request<KnowledgeTextPage>(
      `/knowledge-bases/${encodeURIComponent(
        source.kb_id,
      )}/documents/${encodeURIComponent(
        source.document_id,
      )}/text/page?${new URLSearchParams({
        start: String(start),
        limit: String(Math.min(12000, limit)),
        source_version: source.source_version,
      })}`,
    ),
  documents: async (kbId: string, cursor?: string, limit = 20) => {
    try {
      return await request<{
        items: KnowledgeDocument[];
        total: number;
        has_more: boolean;
        next_cursor: string | null;
      }>(
        `/knowledge-bases/${encodeURIComponent(
          kbId,
        )}/documents/page?${new URLSearchParams({
          limit: String(limit),
          ...(cursor ? { cursor } : {}),
        })}`,
      );
    } catch (error) {
      if (!isNotFoundApiError(error)) throw error;
      // Older installed services expose the same scoped documents without paging.
      const documents = await knowledgeBasesApi.listDocuments(kbId);
      if (documents.some((row) => row.kb_id !== kbId))
        throw new Error("资料归属未核实。");
      const files = documents
        .filter((row) => !row.is_dir)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const remaining = files.filter((row) => !cursor || row.id > cursor);
      const items = remaining.slice(0, limit);
      const has_more = remaining.length > items.length;
      return {
        items,
        total: files.length,
        has_more,
        next_cursor: has_more ? items[items.length - 1].id : null,
      };
    }
  },
};
const changed = "zhijun-understanding-changed";
export function understandingReference(
  source: KnowledgeEvidence,
): MemoryReference {
  return {
    layer: "knowledge",
    id: source.document_id,
    kbId: source.kb_id,
    filename: source.filename,
    path: `knowledge/${source.kb_id}/${source.document_id}/${source.source_version}/${source.start}`,
    sourceVersion: source.source_version,
    start: source.start,
    end: source.end,
  };
}

export function useUnderstanding(scope: string) {
  const [data, setData] = useState<UnderstandingState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const reading = useRef(false);
  const writing = useRef(false);
  const refresh = useCallback(async () => {
    if (reading.current || writing.current) return;
    const current = epoch.current;
    reading.current = true;
    try {
      const value = await understandingApi.get();
      if (epoch.current === current) {
        setData(value);
        setError("");
      }
    } catch (failure) {
      if (epoch.current === current)
        setError(apiErrorMessage(failure, "理解状态未能读取"));
    } finally {
      if (epoch.current === current) reading.current = false;
    }
  }, [scope]);
  useEffect(() => {
    epoch.current++;
    setData(null);
    setError("");
    setBusy(false);
    reading.current = false;
    writing.current = false;
    void refresh();
    const pull = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const timer = window.setInterval(pull, 15000);
    window.addEventListener("focus", pull);
    window.addEventListener(changed, pull);
    document.addEventListener("visibilitychange", pull);
    return () => {
      epoch.current++;
      window.clearInterval(timer);
      window.removeEventListener("focus", pull);
      window.removeEventListener(changed, pull);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [refresh]);
  const mutate = async (action: () => Promise<UnderstandingState>) => {
    if (writing.current) return null;
    const current = ++epoch.current;
    reading.current = false;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const submitted = await action();
      const saved = await understandingApi.get();
      if (epoch.current !== current) return null;
      setData(saved);
      if (saved.revision !== submitted.revision)
        throw new Error("内容已变化，请重新核对。操作不会自动重试。");
      window.dispatchEvent(new Event(changed));
      return saved;
    } catch (failure) {
      if (epoch.current === current)
        setError(`结果尚未核实：${apiErrorMessage(failure, "请求未完成")}`);
      return null;
    } finally {
      if (epoch.current === current) {
        writing.current = false;
        setBusy(false);
      }
    }
  };
  return { data, error, busy, refresh, mutate };
}
