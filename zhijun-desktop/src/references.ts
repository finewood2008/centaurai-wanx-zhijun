import type { ChatMessage } from "../../dashboard/src/pages/Chat/hooks/useChat";
import { parseKnowledgeCitations } from "../../dashboard/src/utils/parseKnowledgeCitations";
import { inboundPath } from "./attachmentPaths";

export interface MemoryReference {
  layer: "atom" | "page" | "raw" | "episode" | "attachment" | "knowledge";
  id: string;
  path: string;
  kbId?: string;
  filename?: string;
  sourceVersion?: string;
  start?: number;
  end?: number;
}

export function referenceLabel(ref: MemoryReference) {
  return ref.layer === "knowledge"
    ? `资料 · ${ref.filename || ref.id}`
    : ref.layer === "attachment"
    ? `文件 · ${ref.filename || ref.id}`
    : `${
        { episode: "经历", raw: "原话", page: "主题", atom: "记忆" }[ref.layer]
      } · ${ref.id}`;
}

export function parseMemoryReference(path: string): MemoryReference | null {
  const match = /^(atom|page)\/([\w-]+)\.md$/.exec(path);
  if (match) {
    return { layer: match[1] as "atom" | "page", id: match[2], path };
  }
  const raw = /^raw\/\d{4}-\d{2}-\d{2}\/([\w-]+)\.md$/.exec(path);
  if (raw) return { layer: "raw", id: raw[1], path };
  const direct = /^\/(episodes|raw_events)\/([\w-]+)$/.exec(path);
  return direct
    ? {
        layer: direct[1] === "episodes" ? "episode" : "raw",
        id: direct[2],
        path,
      }
    : null;
}

/** References come from actual native memory tools, not model-written links. */
export function toolReferences(message: ChatMessage): MemoryReference[] {
  const tool = message.toolData;
  if (
    !tool ||
    ![
      "memory_search",
      "memory_get",
      "zhijun_episode_search",
      "zhijun_episode_get",
      "zhijun_attachment_get",
      "search_knowledge",
      "zhijun_knowledge_get",
      "zhijun_memory_recall",
    ].includes(tool.name ?? "") ||
    message.status !== "done" ||
    tool.errorCode ||
    (tool.returnCode != null && tool.returnCode !== 0) ||
    !tool.output?.trim()
  )
    return [];
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(tool.output);
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      result.ok !== true ||
      result.error
    )
      return [];
  } catch {
    return [];
  }
  if (tool.name === "search_knowledge") {
    if (typeof result.content !== "string" || result.empty === true) return [];
    return parseKnowledgeCitations(result.content).citations.flatMap(
      (citation) =>
        /^[\w-]+$/.test(citation.kbId) && /^[\w-]+$/.test(citation.docId)
          ? [
              {
                layer: "knowledge" as const,
                id: citation.docId,
                kbId: citation.kbId,
                filename: citation.filename,
                path: `/knowledge-bases/${citation.kbId}/documents/${citation.docId}`,
              },
            ]
          : [],
    );
  }
  if (tool.name === "zhijun_knowledge_get") {
    if (
      result.status !== "ready" ||
      typeof result.kb_id !== "string" ||
      typeof result.document_id !== "string" ||
      typeof result.source_version !== "string" ||
      typeof result.text !== "string" ||
      !result.text.trim() ||
      typeof result.start !== "number" ||
      typeof result.end !== "number" ||
      result.end <= result.start ||
      !/^[\w-]+$/.test(result.kb_id) ||
      !/^[\w-]+$/.test(result.document_id)
    )
      return [];
    return [
      {
        layer: "knowledge",
        kbId: result.kb_id,
        id: result.document_id,
        filename:
          typeof result.filename === "string"
            ? result.filename
            : result.document_id,
        path: `knowledge/${result.kb_id}/${result.document_id}/${result.source_version}/${result.start}`,
        sourceVersion: result.source_version,
        start: result.start,
        end: result.end,
      },
    ];
  }
  if (tool.name === "zhijun_attachment_get") {
    const path =
      typeof result.path === "string" ? inboundPath(result.path) : null;
    return path &&
      result.status === "ready" &&
      typeof result.content === "string" &&
      result.content.trim()
      ? [
          {
            layer: "attachment",
            id: path,
            path,
            filename:
              typeof result.filename === "string" ? result.filename : undefined,
          },
        ]
      : [];
  }
  const paths: string[] = [];
  if (tool.name === "zhijun_memory_recall") {
    if (typeof result.path === "string") paths.push(result.path);
    for (const key of ["hits", "items", "sources"]) {
      const rows = result[key];
      if (Array.isArray(rows))
        for (const row of rows)
          if (typeof row?.path === "string") paths.push(row.path);
    }
    for (const key of ["claims", "nodes"]) {
      const rows = result[key];
      if (Array.isArray(rows))
        for (const row of rows)
          if (Array.isArray(row.evidence)) {
            for (const source of row.evidence)
              if (
                typeof source?.event_id === "string" &&
                /^[\w-]+$/.test(source.event_id)
              )
                paths.push(`/raw_events/${source.event_id}`);
          }
    }
  }
  if (tool.name === "memory_search" && Array.isArray(result.hits)) {
    for (const hit of result.hits)
      if (typeof hit?.path === "string") paths.push(hit.path);
  }
  if (
    tool.name === "memory_get" &&
    typeof result.path === "string" &&
    [result.content, result.excerpt].some(
      (text) => typeof text === "string" && text.trim(),
    )
  )
    paths.push(result.path);
  if (tool.name === "zhijun_episode_search" && Array.isArray(result.items)) {
    for (const item of result.items)
      if (
        typeof item?.id === "string" &&
        /^[\w-]+$/.test(item.id) &&
        item.path === `/episodes/${item.id}`
      )
        paths.push(item.path);
  }
  if (tool.name === "zhijun_episode_get") {
    const episode = result.episode as Record<string, unknown> | undefined;
    if (
      episode &&
      typeof episode.id === "string" &&
      /^[\w-]+$/.test(episode.id) &&
      result.path === `/episodes/${episode.id}`
    )
      paths.push(result.path);
    if (Array.isArray(result.sources))
      for (const source of result.sources) {
        if (
          typeof source?.id === "string" &&
          source.path === `/raw_events/${source.id}` &&
          typeof source.content === "string"
        )
          paths.push(source.path);
      }
  }
  return paths.flatMap((path) => {
    const ref = parseMemoryReference(path);
    return ref ? [ref] : [];
  });
}

export function recalledReferences(messages: ChatMessage[]): MemoryReference[] {
  const refs = new Map<string, MemoryReference>();
  for (const message of messages)
    for (const ref of toolReferences(message)) refs.set(ref.path, ref);
  return [...refs.values()];
}

/** A reply gets only the verified reads immediately preceding it in its turn. */
export function referencesByReply(
  messages: ChatMessage[],
): Map<string, MemoryReference[]> {
  const replies = new Map<string, MemoryReference[]>();
  let pending = new Map<string, MemoryReference>();
  for (const message of messages) {
    if (message.role === "user") pending = new Map();
    for (const ref of toolReferences(message)) pending.set(ref.path, ref);
    if (
      message.role === "assistant" &&
      !message.toolData &&
      !message.hitlData &&
      (message.content?.trim() ||
        message.contentBlocks?.some(
          (block) =>
            block.type === "text" &&
            "text" in block &&
            typeof block.text === "string" &&
            block.text.trim(),
        ))
    ) {
      if (message.status !== "error" && pending.size)
        replies.set(message.id, [...pending.values()]);
      pending = new Map();
    }
  }
  return replies;
}
