import { describe, expect, it } from "vitest";
import {
  parseMemoryReference,
  recalledReferences,
  referencesByReply,
  toolReferences,
} from "./references";
import type { ChatMessage } from "../../dashboard/src/pages/Chat/hooks/useChat";

const tool = (name: string, output: unknown, extra = {}) =>
  ({
    role: "tool",
    status: "done",
    toolData: { name, output: JSON.stringify(output) },
    ...extra,
  }) as ChatMessage;

describe("verified source references", () => {
  it("retains canonical source version and range only after a successful knowledge read", () => {
    const page = {
      ok: true,
      status: "ready",
      kb_id: "kb1",
      document_id: "doc1",
      filename: "记录.md",
      source_version: "v1",
      start: 20,
      end: 40,
      text: "实际读取的正文",
    };
    expect(toolReferences(tool("zhijun_knowledge_get", page))).toEqual([
      {
        layer: "knowledge",
        kbId: "kb1",
        id: "doc1",
        filename: "记录.md",
        path: "knowledge/kb1/doc1/v1/20",
        sourceVersion: "v1",
        start: 20,
        end: 40,
      },
    ]);
    expect(
      toolReferences(
        tool("zhijun_knowledge_get", { ...page, status: "stale" }),
      ),
    ).toEqual([]);
    expect(
      toolReferences(tool("zhijun_knowledge_get", { ...page, text: "" })),
    ).toEqual([]);
  });
  it("accepts knowledge markers only inside successful native tool JSON and retains memory sources per reply", () => {
    const content =
      '资料正文\n<!--octop-kb-citations:[{"kb_id":"kb1","doc_id":"doc1","filename":"材料.txt"}]-->';
    expect(
      toolReferences(
        tool("search_knowledge", { ok: true, content, empty: false }),
      ),
    ).toEqual([
      {
        layer: "knowledge",
        id: "doc1",
        kbId: "kb1",
        filename: "材料.txt",
        path: "/knowledge-bases/kb1/documents/doc1",
      },
    ]);
    for (const message of [
      tool("search_knowledge", {
        ok: false,
        content,
        error: "knowledge_unavailable",
      }),
      tool("search_knowledge", { ok: true, content, empty: true }),
      tool("search_knowledge", { ok: true, content }, { status: "error" }),
      { role: "assistant", content } as ChatMessage,
      {
        role: "tool",
        status: "done",
        toolData: { name: "search_knowledge", output: content },
      } as ChatMessage,
      tool("search_knowledge", {
        ok: true,
        content: '<!--octop-kb-citations:[{"doc_id":"doc1"}]-->',
      }),
    ])
      expect(toolReferences(message)).toEqual([]);
    const messages = [
      { role: "user", id: "u1" },
      tool("memory_get", { ok: true, path: "atom/a1.md", content: "记忆" }),
      tool("search_knowledge", { ok: true, content }),
      { role: "assistant", id: "reply", content: "综合回应", status: "done" },
      { role: "user", id: "u2" },
      { role: "assistant", id: "next", content },
    ] as ChatMessage[];
    expect(
      referencesByReply(messages)
        .get("reply")
        ?.map((ref) => ref.layer),
    ).toEqual(["atom", "knowledge"]);
    expect(referencesByReply(messages).has("next")).toBe(false);
  });
  it("verifies locally read attachment sources and excludes failed, empty or unsafe paths", () => {
    expect(
      toolReferences(
        tool("zhijun_attachment_get", {
          ok: true,
          status: "ready",
          path: "inbound/a.txt",
          filename: "a.txt",
          content: "正文",
        }),
      )[0]?.layer,
    ).toBe("attachment");
    for (const result of [
      { ok: false, status: "ready", path: "inbound/a.txt", content: "text" },
      { ok: true, status: "failed", path: "inbound/a.txt", content: "text" },
      { ok: true, status: "ready", path: "inbound/a.txt", content: "" },
      {
        ok: true,
        status: "ready",
        path: "inbound/../../SOUL.md",
        content: "text",
      },
      { ok: true, status: "ready", path: "SOUL.md", content: "text" },
    ])
      expect(toolReferences(tool("zhijun_attachment_get", result))).toEqual([]);
  });
  it("accepts only native paths", () => {
    expect(parseMemoryReference("atom/a-1.md")?.id).toBe("a-1");
    expect(parseMemoryReference("/episodes/e-1")?.layer).toBe("episode");
    expect(parseMemoryReference("/raw_events/r-1")?.layer).toBe("raw");
    expect(parseMemoryReference("../../SOUL.md")).toBeNull();
    expect(parseMemoryReference("/episodes/../other")).toBeNull();
  });
  it("ignores invented links, plaintext failures, failed JSON and unfinished tools", () => {
    const messages = [
      { role: "assistant", content: "atom/fake.md" },
      {
        role: "tool",
        status: "done",
        toolData: {
          name: "memory_get",
          output: "failed: atom/fake.md",
          arguments: '{"path":"atom/fake.md"}',
        },
      },
      tool("memory_search", {
        ok: false,
        error: "unavailable",
        hits: [{ path: "atom/failed.md" }],
      }),
      tool(
        "memory_get",
        { ok: true, path: "atom/pending.md", content: "partial" },
        { status: "streaming" },
      ),
      tool("memory_get", { ok: true, path: "atom/empty.md", content: "" }),
      tool("file_read", {
        ok: true,
        path: "atom/file.md",
        content: "anything",
      }),
      tool("memory_search", {
        ok: true,
        hits: [{ path: "atom/a-1.md" }, { path: "page/e-1.md" }],
      }),
      tool("memory_get", {
        ok: true,
        path: "atom/a-1.md",
        content: "original",
      }),
    ] as ChatMessage[];
    expect(recalledReferences(messages).map((ref) => ref.id)).toEqual([
      "a-1",
      "e-1",
    ]);
  });
  it("handles real episode records and raw sources without parsing quoted text", () => {
    const messages = [
      tool("zhijun_episode_search", {
        ok: true,
        items: [
          { id: "e1", path: "/episodes/e1", summary: "atom/invented.md" },
        ],
      }),
      tool("zhijun_episode_get", {
        ok: true,
        path: "/episodes/e1",
        episode: { id: "e1" },
        sources: [
          { id: "raw1", path: "/raw_events/raw1", content: "actual words" },
        ],
      }),
    ];
    expect(recalledReferences(messages).map((ref) => ref.path)).toEqual([
      "/episodes/e1",
      "/raw_events/raw1",
    ]);
  });
  it("binds sources to the answer that read them and never carries them into a later reply", () => {
    const messages = [
      { id: "u1", role: "user", content: "想聊往事" },
      tool("memory_get", { ok: true, path: "atom/a1.md", content: "source" }),
      { id: "a1", role: "assistant", content: "相关经历" },
      { id: "u2", role: "user", content: "换一个话题" },
      { id: "a2", role: "assistant", content: "新的回应" },
    ] as ChatMessage[];
    const bound = referencesByReply(messages);
    expect(bound.get("a1")?.map((ref) => ref.id)).toEqual(["a1"]);
    expect(bound.has("a2")).toBe(false);
  });
});
