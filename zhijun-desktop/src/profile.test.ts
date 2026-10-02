import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearLegacyBindings, profileApi, validProfile } from "./profile";
import { request } from "../../dashboard/src/api/request";
vi.mock("../../dashboard/src/api/request", () => ({ request: vi.fn() }));
beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("requests an application-scoped login and the unique profile without listing agents", async () => {
  vi.mocked(request).mockResolvedValue({});
  await profileApi.login("owner", "fixture", "captcha");
  expect(request).toHaveBeenCalledWith("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "owner",
      password: "fixture",
      captcha_token: "captcha",
      application_id: "zhijun",
    }),
  });
  await profileApi.get();
  await profileApi.create();
  expect(request).toHaveBeenCalledWith("/zhijun/profile");
  expect(request).toHaveBeenLastCalledWith("/zhijun/profile", {
    method: "POST",
    body: "{}",
  });
  expect(
    vi.mocked(request).mock.calls.some(([path]) => path === "/agents"),
  ).toBe(false);
});
it("registers a shared account in the Zhijun scope without creating an agent or profile", async () => {
  vi.mocked(request).mockResolvedValue({});
  await profileApi.register("new-owner", "PrivatePass27", "captcha-fixture");
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: "new-owner",
      password: "PrivatePass27",
      captcha_token: "captcha-fixture",
      application_id: "zhijun",
    }),
  });
});
it("never reuses an old WANX agent binding or claims other accounts' profiles", () => {
  localStorage.setItem("zhijun:wanx:agent:1", "old-wanx");
  localStorage.setItem("zhijun:wanx:agent:2", "another");
  localStorage.setItem("unrelated", "keep");
  clearLegacyBindings(localStorage);
  expect(localStorage.getItem("zhijun:wanx:agent:1")).toBeNull();
  expect(localStorage.getItem("zhijun:wanx:agent:2")).toBeNull();
  expect(localStorage.getItem("unrelated")).toBe("keep");
  expect(validProfile({ application_id: "wanx", user_id: 1 } as never, 1)).toBe(
    false,
  );
  expect(
    validProfile({ application_id: "zhijun", user_id: 2 } as never, 1),
  ).toBe(false);
  expect(
    validProfile(
      { application_id: "zhijun", user_id: 1, kind: "expert" } as never,
      1,
    ),
  ).toBe(true);
});
