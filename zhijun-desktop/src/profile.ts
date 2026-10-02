import { request } from "../../dashboard/src/api/request";
import type { OctopUser } from "../../dashboard/src/api/modules/auth";
import type { OctopAgent } from "../../dashboard/src/context/AgentContext";

export type ZhijunUser = OctopUser & { application_id: "zhijun" };
export type ZhijunProfile = OctopAgent & { application_id: "zhijun" };

export const profileApi = {
  login: (username: string, password: string, captcha_token?: string) =>
    request<{ access_token: string; user: ZhijunUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        captcha_token,
        application_id: "zhijun",
      }),
    }),
  register: (username: string, password: string, captcha_token?: string) =>
    request<{ access_token: string; user: ZhijunUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        captcha_token,
        application_id: "zhijun",
      }),
    }),
  me: () => request<ZhijunUser>("/auth/me"),
  get: () => request<{ profile: ZhijunProfile | null }>("/zhijun/profile"),
  create: () =>
    request<{ profile: ZhijunProfile }>("/zhijun/profile", {
      method: "POST",
      body: "{}",
    }),
};

export function validProfile(profile: ZhijunProfile, userId: number): boolean {
  return (
    profile.application_id === "zhijun" &&
    profile.user_id === userId &&
    profile.kind !== "team"
  );
}

/** Old client bindings cannot claim or migrate a WANX agent into this application. */
export function clearLegacyBindings(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (key?.startsWith("zhijun:wanx:agent:")) storage.removeItem(key);
  }
  storage.removeItem("octop:active-agent");
}

/** Drafts and the last selected conversation belong only to the current login. */
export function clearConversationCaches(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (key?.startsWith("zhijun:thread:") || key?.startsWith("zhijun:draft:"))
      storage.removeItem(key);
  }
}
