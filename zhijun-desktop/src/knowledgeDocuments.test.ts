import { beforeEach, expect, it, vi } from "vitest";
import { request } from "../../dashboard/src/api/request";
import type { KnowledgeDocument } from "../../dashboard/src/api/modules/knowledgeBases";
import { understandingApi } from "./understanding";

vi.mock("../../dashboard/src/api/request", () => ({ request: vi.fn() }));
beforeEach(() => {
  vi.mocked(request).mockReset();
});

const missingPage = new Error(
  'Request failed: 404 Not Found - {"error":{"code":"NOT_FOUND","message":"application resource not found","details":{}}}',
);
function doc(id: string, is_dir = false, kb_id = "OWNKB1"): KnowledgeDocument {
  return {
    id,
    kb_id,
    is_dir,
    filename: `${id}.txt`,
    content_type: "text/plain",
    byte_size: 20,
    content_hash: "synthetic",
    status: "ready",
    error_message: "",
    chunk_count: 1,
    created_at: 1,
    updated_at: 1,
  };
}

it("uses native paging when the installed service supports it", async () => {
  const page = {
    items: [doc("b")],
    total: 5,
    has_more: true,
    next_cursor: "b",
  };
  vi.mocked(request).mockResolvedValue(page);
  expect(await understandingApi.documents("OWNKB1", "a", 2)).toBe(page);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "/knowledge-bases/OWNKB1/documents/page?limit=2&cursor=a",
  );
});

it("recovers the installed service's missing page endpoint and preserves stable file pagination", async () => {
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.includes("/documents/page?")) throw missingPage;
    expect(path).toBe("/knowledge-bases/OWNKB1/documents");
    return [doc("c"), doc("folder", true), doc("a"), doc("b")];
  });
  const first = await understandingApi.documents("OWNKB1", undefined, 2);
  expect(first.items.map((row) => row.id)).toEqual(["a", "b"]);
  expect(first).toMatchObject({ total: 3, has_more: true, next_cursor: "b" });
  const next = await understandingApi.documents(
    "OWNKB1",
    first.next_cursor!,
    2,
  );
  expect(next.items.map((row) => row.id)).toEqual(["c"]);
  expect(next).toMatchObject({ total: 3, has_more: false, next_cursor: null });
  const back = await understandingApi.documents("OWNKB1", undefined, 2);
  expect(back).toEqual(first);
});

it.each([
  "Request failed: 403 Forbidden",
  "Request failed: 500 Internal Server Error",
  "Failed to fetch",
])(
  "does not replace a real failure with a compatibility result: %s",
  async (message) => {
    const failure = new Error(message);
    vi.mocked(request).mockRejectedValue(failure);
    await expect(understandingApi.documents("OWNKB1")).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it("keeps denial from the legacy scoped route visible instead of showing an empty library", async () => {
  const denied = new Error(
    'Request failed: 404 Not Found - {"error":{"code":"KNOWLEDGE_NOT_FOUND"}}',
  );
  vi.mocked(request)
    .mockRejectedValueOnce(missingPage)
    .mockRejectedValueOnce(denied);
  await expect(understandingApi.documents("OWNKB1")).rejects.toBe(denied);
  expect(request).toHaveBeenLastCalledWith("/knowledge-bases/OWNKB1/documents");
});

it("rejects misattributed documents even if the legacy route returns them", async () => {
  vi.mocked(request)
    .mockRejectedValueOnce(missingPage)
    .mockResolvedValueOnce([doc("a", false, "OTHER1")]);
  await expect(understandingApi.documents("OWNKB1")).rejects.toThrow(
    "资料归属未核实",
  );
});
