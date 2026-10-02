import { request } from "../../dashboard/src/api/request";

export type SelfSource = {
  kind: "ontology" | "memory" | "episode" | "knowledge";
  id: string;
  version: string;
  title: string;
  text: string;
  needs_review: boolean;
  total_chars: number;
  next_start: number | null;
};
export type SelfEntry = {
  id: string;
  title: string;
  text: string;
  source: SelfSource | null;
  recognized: boolean;
};
export type SelfDraft = {
  name: string;
  bio: string;
  topics: string[];
  style: string;
  boundaries: string;
  questions: string[];
  entries: SelfEntry[];
  access: "approval" | "open";
  visitor_daily_limit: number;
  daily_limit: number;
};
export type SelfAccess = {
  visitor_id: number;
  status: "pending" | "approved" | "rejected" | "revoked";
  note: string;
  contact: string;
  contact_status: "none" | "pending" | "accepted" | "declined";
  updated_at: string;
};
export type SelfState = {
  id: string;
  revision: string;
  status: "unpublished" | "published" | "paused";
  draft: SelfDraft;
  publication: {
    version: string;
    published_at: string;
    draft: SelfDraft;
  } | null;
  visitors: SelfAccess[];
  usage: Record<string, number>;
  network_status: "contract_pending";
};
export type SelfCard = {
  id: string;
  name: string;
  bio: string;
  topics: string[];
  questions: string[];
  works: string[];
  updated_at: string;
  version: string;
  online: boolean;
  access: "approval" | "open";
  access_status: string;
  model: string;
  model_local: boolean;
  owner_visible: boolean;
  contact_status: "none" | "pending" | "accepted" | "declined";
};
export type SelfMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  publication_version: string;
  sources: string[];
  context_sources?: string[];
  options: string[];
  request_id: string;
};
export type SelfHistory = {
  revision: string;
  messages: SelfMessage[];
  memory: { text: string; quote: string; message_id: string }[];
  total: number;
  has_more: boolean;
  pending_request: string | null;
  pending_text: string;
  pending_status: string | null;
};
export type SelfReply = {
  answer: string;
  sources: string[];
  context_sources?: string[];
  options: string[];
};
export type SourcePage = {
  items: SelfSource[];
  has_more: boolean;
  libraries: { id: string; name: string }[];
};
export type PublishedEntry = {
  id: string;
  title: string;
  text: string;
  publication_version: string;
};
export type AccessAction =
  | "approve"
  | "reject"
  | "revoke"
  | "contact_accept"
  | "contact_decline";
// The shared request wrapper adds /api, just as for other native resources.
const base = "/zhijun/digital-self";
const json = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});
export const digitalSelfApi = {
  me: () => request<SelfState>(base + "/me"),
  update: (
    revision: string,
    action: "save" | "generate" | "publish" | "pause" | "unpublish",
    draft?: SelfDraft,
  ) =>
    request<SelfState>(
      base + "/me",
      json("PUT", { revision, action, ...(draft ? { draft } : {}) }),
    ),
  preview: (revision: string, text: string) =>
    request<SelfReply>(base + "/me/preview", json("POST", { revision, text })),
  sources: (params: Record<string, string | number>) =>
    request<SourcePage>(
      base +
        "/me/sources?" +
        new URLSearchParams(
          Object.entries(params).map(([k, v]) => [k, String(v)]),
        ),
    ),
  review: (revision: string, visitor_id: number, action: AccessAction) =>
    request<SelfState>(
      base + "/me/access",
      json("POST", { revision, visitor_id, action }),
    ),
  discover: (q: string, offset = 0) =>
    request<{
      items: SelfCard[];
      total: number;
      has_more: boolean;
      unavailable_profiles: number;
      network_status: string;
    }>(base + "?" + new URLSearchParams({ q, offset: String(offset) })),
  card: (id: string) => request<SelfCard>(`${base}/${encodeURIComponent(id)}`),
  apply: (id: string, note: string, contact = "") =>
    request<SelfCard>(
      `${base}/${encodeURIComponent(id)}/access`,
      json("POST", { note, contact }),
    ),
  entry: (id: string, entry: string, expectedVersion: string) =>
    request<PublishedEntry>(
      `${base}/${encodeURIComponent(id)}/sources/${encodeURIComponent(
        entry,
      )}?expected_version=${encodeURIComponent(expectedVersion)}`,
    ),
  historyPage: (id: string, offset: number, visitor?: number) =>
    request<SelfHistory>(
      visitor == null
        ? `${base}/${encodeURIComponent(id)}/conversation?offset=${offset}`
        : `${base}/me/visitors/${visitor}?offset=${offset}`,
    ),
  turn: (
    id: string,
    body: {
      request_id: string;
      revision: string;
      publication_version: string;
      text: string;
      acknowledge_owner_visibility: boolean;
      assisted: boolean;
    },
  ) =>
    request<SelfHistory>(
      `${base}/${encodeURIComponent(id)}/conversation`,
      json("POST", body),
    ),
  clear: (
    id: string,
    revision: string,
    action: "clear" | "dismiss_pending" = "clear",
  ) =>
    request<SelfHistory>(
      `${base}/${encodeURIComponent(id)}/conversation`,
      json("DELETE", { revision, action }),
    ),
};

/** Pagination is a consistent server snapshot; never stitch different revisions. */
export async function readSelfHistory(id: string, visitor?: number) {
  let page = await digitalSelfApi.historyPage(id, 0, visitor);
  const messages = [...page.messages];
  while (page.has_more) {
    const next = await digitalSelfApi.historyPage(id, messages.length, visitor);
    if (next.revision !== page.revision || !next.messages.length)
      throw new Error("交谈记录发生变化，请重新读取。");
    messages.push(...next.messages);
    page = next;
  }
  return { ...page, messages };
}
