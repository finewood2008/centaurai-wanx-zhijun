import { DeleteContent } from "./MemoryMaintenance";
import { ActionIcon } from "./ActionIcon";
import { verifyAbsent, refreshMemory } from "./maintenance";
import { useEffect, useRef, useState } from "react";
import {
  knowledgeBasesApi as knowledge,
  DEFAULT_KNOWLEDGE_LIMITS,
  type KnowledgeBase,
  type KnowledgeCapability,
  type KnowledgeDocument,
} from "../../dashboard/src/api/modules/knowledgeBases";
import { apiErrorMessage } from "../../dashboard/src/utils/apiError";
import { Notice } from "./App";
import { Pages, State, useResource } from "./memoryUi";
import { understandingApi } from "./understanding";
import { UnderstandingPanel } from "./UnderstandingPanel";
import type { MemoryReference } from "./references";

function assertBase(base: KnowledgeBase, owner?: number) {
  if (
    base.application_id !== "zhijun" ||
    base.shared ||
    (owner != null && base.owner_user_id !== owner)
  )
    throw new Error("资料库归属未核实，请重新读取。不会连接其他资料库。");
  return base;
}
export const documentStatus: Record<KnowledgeDocument["status"], string> = {
  pending: "等待整理",
  processing: "本地整理中",
  ready: "可供检索",
  failed: "整理未完成",
};
export function localKnowledgeReady(capability: KnowledgeCapability) {
  return capability.backend === "onnx" && capability.usable;
}
function Capability({ value }: { value: KnowledgeCapability }) {
  const ready = localKnowledgeReady(value);
  const missing = [
    value.feature_enabled === false && "万象尚未启用知识库",
    value.backend !== "onnx" && "万象当前配置未启用本地资料处理",
    !value.checks.model_selected && "尚未选定本地模型",
    !value.checks.model_downloaded && "本地模型尚未下载",
    !value.checks.deps_available && "本地处理依赖未就绪",
  ].filter(Boolean);
  return (
    <details className="library-capability library-tools">
      <summary>
        资料处理设置 <span>{ready ? "本地检索已就绪" : "本地处理待就绪"}</span>
      </summary>
      <p className="muted fine">模型与处理策略跟随万象知识库设置</p>
      <p>{ready ? "本地资料检索已就绪" : "本地资料检索尚未就绪"}</p>
      {value.selected_model && (
        <p className="muted fine">{value.selected_model}</p>
      )}
      <p className="muted fine">
        {!ready && (missing.join(" · ") || "请重新读取本机处理状态")}
      </p>
      <p className="muted fine">
        {value.ocr.backend === "onnx" && value.ocr.usable
          ? "本地图片识字已就绪"
          : value.ocr.enabled === false
          ? "万象已关闭图片识字"
          : "本地图片识字尚未就绪"}
      </p>
      {value.chunk_size != null && (
        <p className="muted fine">
          分段 {value.chunk_size} 字 · 重叠 {value.chunk_overlap} 字 ·
          每次检索最多 {value.retrieval_k} 段
        </p>
      )}
    </details>
  );
}
export function knowledgeDraft(base: string, filename: string) {
  return `我想聊聊资料库「${base}」中的「${filename}」。请先看看这份资料，资料里的观点不代表我的想法。我想聊的是：`;
}

export function KnowledgeLibrary({
  userId,
  agentId,
  onDiscuss,
  onBack,
  onSource,
}: {
  userId: number;
  agentId: string;
  onDiscuss: (text: string, knowledge?: { id: string; name: string }) => void;
  onBack: () => void;
  onSource: (source: MemoryReference) => void;
}) {
  const [understandingOpen, setUnderstandingOpen] = useState(true);
  const [capabilityError, setCapabilityError] = useState("");
  const [latestCapability, setLatestCapability] =
    useState<KnowledgeCapability | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const data = useResource(String(userId), async () => {
    const [capability, base] = await Promise.all([
      knowledge.getCapability(),
      knowledge.personal(),
    ]);
    return { capability, base: assertBase(base, userId) };
  });
  useEffect(() => {
    if (data.data) setLatestCapability(data.data.capability);
  }, [data.data]);
  useEffect(() => {
    let current = true;
    let reading = false;
    const refresh = async () => {
      if (reading || document.visibilityState === "hidden") return;
      reading = true;
      try {
        const value = await knowledge.getCapability();
        if (current) {
          setLatestCapability((previous) =>
            JSON.stringify(previous) === JSON.stringify(value)
              ? previous
              : value,
          );
          setCapabilityError("");
        }
      } catch (failure) {
        if (current)
          setCapabilityError(
            `平台处理状态未能刷新：${apiErrorMessage(failure, "请求未完成")}`,
          );
      } finally {
        reading = false;
      }
    };
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(onFocus, 15000);
    return () => {
      current = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
    };
  }, [userId]);
  const capability = latestCapability || data.data?.capability;
  const base = data.data?.base;
  return (
    <div className="personal-library">
      <button className="panel-back" onClick={onBack}>
        回到对话
      </button>
      <div className="library-identity">
        <span className="library-identity-dot" /> 只属于你的资料空间{" "}
        <span>与当前账号绑定</span>
      </div>
      <div className="library-understanding">
        {!understandingOpen && (
          <button
            aria-expanded={false}
            onClick={() => setUnderstandingOpen(true)}
          >
            深入理解
          </button>
        )}
        <UnderstandingPanel
          agentId={agentId}
          libraryId={base?.id}
          expanded={understandingOpen}
          onToggle={() => setUnderstandingOpen((value) => !value)}
          onSource={onSource}
          onUpdated={data.refresh}
        />
      </div>
      <State resource={data} />
      {data.data && (
        <>
          {capabilityError && <Notice>{capabilityError}</Notice>}
          <div className="library-processing-row">
            <Capability value={capability || data.data.capability} />
            <button
              className="quiet-icon"
              aria-label="刷新资料库与处理状态"
              title="刷新资料库与处理状态"
              onClick={data.refresh}
            >
              <ActionIcon name="refresh" />
            </button>
          </div>
          {base && (
            <LibraryDocuments
              key={base.id}
              base={base}
              capability={capability || data.data.capability}
              onDiscuss={onDiscuss}
            />
          )}
        </>
      )}
    </div>
  );
}

type UploadDraft = {
  id: number;
  file: File;
  state: "uploading" | "uploaded" | "failed";
  progress: number;
  error?: string;
};
function LibraryDocuments({
  base,
  capability,
  onDiscuss,
}: {
  base: KnowledgeBase;
  capability: KnowledgeCapability;
  onDiscuss: (text: string, knowledge?: { id: string; name: string }) => void;
}) {
  const [drafts, setDrafts] = useState<UploadDraft[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [error, setError] = useState("");
  const [reindexing, setReindexing] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const data = useResource(`${base.id}:${offset}`, async () => {
    assertBase(await knowledge.get(base.id), base.owner_user_id);
    const page = await understandingApi.documents(
      base.id,
      cursors[offset / 20],
    );
    if (page.items.some((row) => row.kb_id !== base.id))
      throw new Error("资料归属未核实。");
    return page;
  });
  const policy = JSON.stringify(capability);
  const previousPolicy = useRef(policy);
  useEffect(() => {
    if (previousPolicy.current !== policy) {
      previousPolicy.current = policy;
      data.refresh();
    }
  }, [policy]);
  const pending = data.data?.items.some((row) =>
    ["pending", "processing"].includes(row.status),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(data.refresh, 2500);
    return () => clearTimeout(timer);
  }, [pending, data.data]);
  const upload = async (row: UploadDraft) => {
    const update = (patch: Partial<UploadDraft>) => {
      if (alive.current)
        setDrafts((old) =>
          old.map((item) =>
            item.id === row.id ? { ...item, ...patch } : item,
          ),
        );
    };
    update({ state: "uploading", progress: 0, error: "" });
    if (
      row.file.size >
      (capability.limits || DEFAULT_KNOWLEDGE_LIMITS).max_document_bytes
    ) {
      update({ state: "failed", error: "文件超过本机资料上传限制。" });
      return;
    }
    try {
      const doc = await knowledge.uploadDocument(
        base.id,
        row.file,
        undefined,
        (progress) => update({ progress }),
      );
      if (doc.kb_id !== base.id) throw new Error("上传资料的归属未核实。");
      update({ state: "uploaded", progress: 100 });
      if (alive.current) data.refresh();
    } catch (error) {
      update({ state: "failed", error: apiErrorMessage(error, "上传未完成") });
    }
  };
  const retry = async (doc: KnowledgeDocument) => {
    if (reindexing.includes(doc.id)) return;
    setError("");
    setReindexing((old) => [...old, doc.id]);
    try {
      await knowledge.reindexDocument(base.id, doc.id);
      if (alive.current) data.refresh();
    } catch (error) {
      if (alive.current)
        setError(
          `重试结果尚未核实：${apiErrorMessage(
            error,
            "请求未完成",
          )}。请刷新资料读取实际状态。`,
        );
    } finally {
      if (alive.current)
        setReindexing((old) => old.filter((id) => id !== doc.id));
    }
  };
  return (
    <section className="library-documents">
      <div className="library-collection-heading">
        <div>
          <h3>
            我的资料 <span>{data.data?.total ?? base.doc_count ?? 0} 份</span>
          </h3>
          <p className="muted fine">把经历、记录与在意的事，慢慢交给知君。</p>
        </div>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        aria-label="选择资料库文件"
        onChange={(event) => {
          const rows: UploadDraft[] = Array.from(event.target.files || []).map(
            (file) => ({
              id: ++nextId.current,
              file,
              state: "uploading",
              progress: 0,
            }),
          );
          setDrafts((old) => [...old, ...rows]);
          for (const row of rows) void upload(row);
          event.target.value = "";
        }}
      />
      <div className="actions library-upload">
        <button
          className="primary"
          disabled={!localKnowledgeReady(capability)}
          onClick={() => input.current?.click()}
        >
          上传资料
        </button>
        <span className="muted fine">
          日记、文章、图片、文档…
          <br />
          上传不代表已成为关于你的记忆。
        </span>
        <button
          className="quiet-icon library-refresh"
          aria-label="刷新资料状态"
          title="刷新资料状态"
          onClick={data.refresh}
        >
          <ActionIcon name="refresh" />
        </button>
      </div>
      {drafts.map((row) => (
        <article className="attachment-draft" key={row.id}>
          <span>{row.file.name}</span>
          <small>
            {row.state === "uploading"
              ? `正在上传 · ${row.progress}%`
              : row.state === "uploaded"
              ? "已上传 · 整理状态以下方读取结果为准"
              : "上传未完成"}
          </small>
          {row.error && <span role="alert">{row.error}</span>}
          <div className="actions">
            {row.state === "failed" && (
              <button
                disabled={!localKnowledgeReady(capability)}
                onClick={() => void upload(row)}
              >
                重试上传 {row.file.name}
              </button>
            )}
            <button
              aria-label={`移除上传提示 ${row.file.name}`}
              onClick={() =>
                setDrafts((old) => old.filter((item) => item.id !== row.id))
              }
            >
              关闭提示
            </button>
          </div>
        </article>
      ))}
      {error && <Notice>{error}</Notice>}
      <State resource={data} />
      {data.data && (
        <>
          {!data.data.total && <p className="muted">这里还没有资料。</p>}
          {data.data.items.map((doc) => (
            <article className="memory-card library-document-card" key={doc.id}>
              <span className="library-file-icon" aria-hidden="true">
                {doc.filename.split(".").pop()?.slice(0, 4).toUpperCase() ||
                  "文"}
              </span>
              <small>
                {documentStatus[doc.status] || doc.status} ·{" "}
                {Math.ceil(doc.byte_size / 1024)} KB
              </small>
              <p>{doc.filename}</p>
              <DeleteContent
                label="删除文件"
                title={doc.filename}
                scope="删除此资料的原件、正文和检索索引，不能撤销。相关资料线索会停止使用；对话与记忆请单独维护。"
                onDelete={async () => {
                  await knowledge.deleteDocument(base.id, doc.id);
                  await verifyAbsent(() =>
                    knowledge.previewDocument(base.id, doc.id),
                  );
                  setPreview(null);
                  refreshMemory();
                }}
              />
              {doc.error_message && <Notice>{doc.error_message}</Notice>}
              <div className="actions">
                <button onClick={() => setPreview(doc.id)}>
                  查看正文与来源
                </button>
                <button
                  disabled={doc.status !== "ready"}
                  onClick={() =>
                    onDiscuss(knowledgeDraft(base.name, doc.filename), {
                      id: base.id,
                      name: base.name,
                    })
                  }
                >
                  围绕资料聊
                </button>
                {doc.status === "failed" && (
                  <button
                    disabled={
                      !localKnowledgeReady(capability) ||
                      reindexing.includes(doc.id)
                    }
                    onClick={() => void retry(doc)}
                  >
                    {reindexing.includes(doc.id) ? "正在重试…" : "重试整理"}
                  </button>
                )}
              </div>
            </article>
          ))}
          <Pages
            offset={offset}
            step={20}
            more={data.data.has_more}
            onChange={(next) => {
              if (next > offset && data.data?.next_cursor)
                setCursors((current) => {
                  const values = [...current];
                  values[next / 20] = data.data!.next_cursor!;
                  return values;
                });
              setOffset(next);
            }}
          />
        </>
      )}
      {preview && (
        <section className="library-preview">
          <button onClick={() => setPreview(null)}>收起正文</button>
          <KnowledgeSource
            key={preview}
            kbId={base.id}
            docId={preview}
            onDiscuss={onDiscuss}
          />
        </section>
      )}
    </section>
  );
}

export function KnowledgeSource({
  kbId,
  docId,
  onDiscuss,
  sourceVersion,
  start = 0,
  end,
}: {
  kbId: string;
  docId: string;
  onDiscuss?: (text: string, knowledge?: { id: string; name: string }) => void;
  sourceVersion?: string;
  start?: number;
  end?: number;
}) {
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [position, setPosition] = useState(start);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const data = useResource(
    `${kbId}:${docId}:${sourceVersion || "preview"}:${position}`,
    async () => {
      const base = assertBase(await knowledge.get(kbId));
      if (sourceVersion) {
        const page = await understandingApi.text(
          {
            kb_id: kbId,
            document_id: docId,
            filename: "",
            source_version: sourceVersion,
            start: position,
            end: end ?? position + 6000,
          },
          position,
          6000,
        );
        if (
          page.kb_id !== kbId ||
          page.document_id !== docId ||
          page.source_version !== sourceVersion ||
          page.status !== "ready"
        )
          throw new Error("资料正文或版本已变化，请重新核对来源。");
        return {
          base,
          doc: {
            filename: page.filename,
            status: "ready" as const,
            has_original: true,
            error_message: "",
          },
          page,
          preview: null,
        };
      }
      const docs = await knowledge.listDocuments(kbId);
      const doc = docs.find((row) => row.id === docId && row.kb_id === kbId);
      if (!doc) throw new Error("原资料不存在或无法访问。");
      const preview =
        !sourceVersion && doc.status === "ready"
          ? await knowledge.previewDocument(kbId, docId)
          : null;
      if (preview && preview.id !== docId) throw new Error("正文来源未核实。");
      return { base, doc, preview, page: null };
    },
  );
  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const blob = await knowledge.fetchDocumentFile(kbId, docId);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.data?.doc.filename || "资料";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (alive.current) setError(apiErrorMessage(error, "原文件读取未完成"));
    } finally {
      if (alive.current) setDownloading(false);
    }
  };
  return (
    <>
      <State resource={data} />
      {data.data && (
        <>
          <p className="eyebrow">资料来源 · {data.data.base.name}</p>
          <h3>{data.data.doc.filename}</h3>
          <p className="muted fine">
            {documentStatus[data.data.doc.status]} · {kbId} / {docId}
          </p>
          {data.data.doc.error_message && (
            <Notice>{data.data.doc.error_message}</Notice>
          )}
          <pre className="source-text">
            {data.data.page?.text ||
              data.data.preview?.text ||
              (data.data.doc.status === "ready"
                ? "当前没有可展示的正文。"
                : "正文尚未整理完成，不能视为已经查阅。")}
          </pre>
          {data.data.page && (
            <>
              <p className="muted fine">
                正文位置 {data.data.page.start}–{data.data.page.end} /{" "}
                {data.data.page.total_chars} 字 · 来源版本已核验
              </p>
              <div className="actions">
                <button
                  disabled={position === 0}
                  onClick={() => setPosition(Math.max(0, position - 6000))}
                >
                  上一段正文
                </button>
                <button
                  disabled={!data.data.page.has_more}
                  onClick={() => setPosition(data.data!.page!.end)}
                >
                  下一段正文
                </button>
              </div>
            </>
          )}
          <p className="muted fine">
            资料内容不等于你本人的观点；这里只读展示原生整理正文。
          </p>
          {error && <Notice>{error}</Notice>}
          <div className="actions">
            <button onClick={data.refresh}>重新读取来源</button>
            <button
              disabled={!data.data.doc.has_original || downloading}
              onClick={() => void download()}
            >
              {downloading ? "正在读取原文件…" : "保存原文件"}
            </button>
            {onDiscuss && (
              <button
                disabled={data.data.doc.status !== "ready"}
                onClick={() =>
                  onDiscuss(
                    knowledgeDraft(
                      data.data!.base.name,
                      data.data!.doc.filename,
                    ),
                    { id: data.data!.base.id, name: data.data!.base.name },
                  )
                }
              >
                围绕资料聊
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
