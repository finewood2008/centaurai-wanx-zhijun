import { expect, it, vi, afterEach } from "vitest";
import {
  digitalSelfApi as api,
  readSelfHistory,
  type SelfHistory,
} from "./digitalSelfApi";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const page = (revision: string, more: boolean, id: string) =>
  ({
    revision,
    has_more: more,
    messages: [{ id }],
    memory: [],
    total: 2,
  }) as unknown as SelfHistory;
it("reads complete consistent pagination and stops on changed versions", async () => {
  const read = vi
    .spyOn(api, "historyPage")
    .mockResolvedValueOnce(page("v1", true, "one"))
    .mockResolvedValueOnce(page("v1", false, "two"));
  expect((await readSelfHistory("pub")).messages.map((m) => m.id)).toEqual([
    "one",
    "two",
  ]);
  expect(read).toHaveBeenLastCalledWith("pub", 1, undefined);
  read
    .mockResolvedValueOnce(page("v1", true, "one"))
    .mockResolvedValueOnce(page("v2", false, "two"));
  await expect(readSelfHistory("pub")).rejects.toThrow("发生变化");
});
it("uses the real shared wrapper with exactly one API prefix", async () => {
  const storage = {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  await api.me();
  await api.discover("研究");
  await api.card("published");
  await api.historyPage("published", 0);
  await api.clear("published", "h1");
  const urls = fetch.mock.calls.map(([url]) => String(url));
  expect(urls).toHaveLength(5);
  expect(urls[0]).toBe("/api/zhijun/digital-self/me");
  expect(urls[1]).toContain("/api/zhijun/digital-self?q=");
  expect(urls.slice(2)).toEqual([
    "/api/zhijun/digital-self/published",
    "/api/zhijun/digital-self/published/conversation?offset=0",
    "/api/zhijun/digital-self/published/conversation",
  ]);
  expect(urls.every((url) => !url.includes("/api/api/"))).toBe(true);
});
