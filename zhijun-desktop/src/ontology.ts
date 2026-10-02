import { request } from "../../dashboard/src/api/request";
export type OntologyKind =
  | "principle"
  | "value"
  | "decision"
  | "boundary"
  | "aspiration"
  | "situation"
  | "response"
  | "identity";
export type OntologyClaim = {
  id: string;
  kind: OntologyKind;
  title: string;
  statement: string;
  conditions: string;
  exceptions: string;
  state: "draft" | "confirmed" | "dismissed" | "withdrawn";
  source_kind?: "inference" | "self_report";
  owner_edited?: boolean;
  core?: boolean;
  changed?: boolean;
  version?: string;
  time_scope?: string;
  declaration?: string;
  context_ids?: string[];
  suggested_kind?: OntologyKind | null;
  history?: {
    version: string;
    at: string;
    reason: string;
    value: { statement: string };
  }[];
  evidence_valid: boolean;
  reviewed_at: string | null;
  core_status?:
    | "pending"
    | "snoozed"
    | "admitted"
    | "rejected"
    | "inactive"
    | "background"
    | "merged";
  admitted_version?: string;
  admitted_at?: string;
  admitted_by?: number | null;
  importance?: 1 | 2 | 3;
  snoozed_until?: string;
  merged_into?: string;
  discussion_thread_id?: string;
  candidate_edited?: boolean;
  source_claim_ids?: string[];
  evidence: {
    atom_id: string;
    event_id: string;
    quote: string;
    timestamp: string;
    available?: boolean;
    source_type?: "memory" | "knowledge" | "owner_declaration";
    kb_id?: string;
    document_id?: string;
    filename?: string;
    source_version?: string;
    start?: number;
    end?: number;
  }[];
};
export type PersonalOntology = {
  revision: string;
  generated_at: string | null;
  outdated: boolean;
  coverage: {
    processed_sources?: number;
    read_atoms: number;
    total_atoms: number;
    eligible_sources: number;
    independent_events: number;
    has_more: boolean;
  };
  relations?: {
    id: string;
    source: string;
    target: string;
    kind: "supports" | "balances" | "changes";
    description: string;
    state: string;
    version?: string;
  }[];
  progress?: { status: string; last_error: string | null };
  claims: OntologyClaim[];
  nodes?: ContextNode[];
  links?: ContextLink[];
  graph_coverage?: {
    atoms: number;
    entities: number;
    episodes: number;
    verifiable_facts: number;
    duplicate_sources: number;
    unavailable_sources: number;
    complete: boolean;
  };
};
export type OntologyResult = {
  status: "ready" | "insufficient" | "unavailable" | "stale";
  ontology: PersonalOntology;
  changed_id?: string | null;
  previous_version?: string | null;
  core_effect?: "candidate" | "admitted" | "stopped" | null;
};
export const ontologyApi = {
  get: () => request<PersonalOntology>("/zhijun/ontology"),
  generate: (revision: string) =>
    request<OntologyResult>("/zhijun/ontology:generate", {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  review: (
    id: string,
    revision: string,
    action: "confirm" | "dismiss" | "withdraw",
    expected_version?: string,
  ) =>
    request<OntologyResult>(
      `/zhijun/ontology/${encodeURIComponent(id)}:review`,
      {
        method: "POST",
        body: JSON.stringify({ revision, action, expected_version }),
      },
    ),
};

export type OntologyEdit = {
  revision: string;
  action:
    | "add"
    | "correct"
    | "scope"
    | "change"
    | "disable"
    | "restore"
    | "pin"
    | "classify";
  statement?: string;
  kind?: OntologyKind;
  conditions?: string;
  exceptions?: string;
  time_scope?: string;
  core?: boolean;
  restore_version?: string;
  expected_version?: string;
  context_ids?: string[];
};
export type OntologyContext = {
  updates?: OntologyResult[];
  available: boolean;
  revision: string;
  claims: OntologyClaim[];
  nodes?: ContextNode[];
  links?: ContextLink[];
  understanding_lines?: import("./understanding").UnderstandingInvitation[];
};
export const editOntology = (id: string | null, body: OntologyEdit) =>
  request<OntologyResult>(
    id
      ? `/zhijun/ontology/${encodeURIComponent(id)}:edit`
      : "/zhijun/ontology:nodes",
    { method: "POST", body: JSON.stringify(body) },
  );
export const ontologyContext = (
  threadId: string,
  reply: string,
  replyId = "",
  latest = false,
) =>
  request<OntologyContext>(
    `/zhijun/ontology/context?${new URLSearchParams({
      thread_id: threadId,
      reply: reply.trim(),
      reply_id: replyId,
      latest: String(latest),
    })}`,
  );

export const recordAssistedReply = (
  threadId: string,
  offered: string,
  submitted: string,
) =>
  request<{ recorded: boolean }>("/zhijun/response-origin", {
    method: "POST",
    body: JSON.stringify({ thread_id: threadId, offered, submitted }),
  });
export const reviewOntologyRelation = (
  relation_id: string,
  revision: string,
  action: "confirm" | "dismiss",
  expected_version?: string,
) =>
  request<OntologyResult>("/zhijun/ontology:relation", {
    method: "POST",
    body: JSON.stringify({ relation_id, revision, action, expected_version }),
  });

export type ContextKind =
  | "person"
  | "project"
  | "role"
  | "goal"
  | "situation"
  | "fact"
  | "episode";
export type ContextNode = {
  id: string;
  kind: ContextKind;
  title: string;
  statement: string;
  version: string;
  state: "active" | "withdrawn";
  source_kind: "native" | "self_report";
  owner_edited: boolean;
  evidence_valid: boolean;
  conditions: string;
  time_scope: string;
  aliases: string[];
  native_ids: string[];
  evidence: OntologyClaim["evidence"];
  history: NonNullable<OntologyClaim["history"]>;
  changed: boolean;
  core: boolean;
  emotion: string;
  occurred_at: string;
  merged_into: string;
};
export type ContextLink = {
  id: string;
  source: string;
  target: string;
  kind:
    | "about"
    | "experienced"
    | "evidence"
    | "related"
    | "supports"
    | "balances"
    | "changes";
  description: string;
  source_kind: "native" | "inference" | "self_report";
  state: "draft" | "confirmed" | "dismissed";
  version: string;
};
export type ContextEdit = {
  revision: string;
  expected_version?: string;
  request_id?: string;
  action:
    | "add"
    | "correct"
    | "scope"
    | "change"
    | "disable"
    | "restore"
    | "merge"
    | "purge"
    | "pin";
  kind?: ContextKind;
  statement?: string;
  title?: string;
  conditions?: string;
  time_scope?: string;
  aliases?: string[];
  related_ids?: string[];
  merge_target?: string;
  merge_target_version?: string;
  restore_version?: string;
  core?: boolean;
};
export const editContextNode = (id: string | null, body: ContextEdit) =>
  request<OntologyResult>(
    id
      ? `/zhijun/ontology/context-nodes/${encodeURIComponent(id)}:edit`
      : "/zhijun/ontology/context-nodes",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const isCore = (c: OntologyClaim) =>
  c.core_status === "admitted" &&
  c.state === "confirmed" &&
  !!c.admitted_at &&
  c.admitted_by != null &&
  c.admitted_version === c.version &&
  c.evidence_valid &&
  !c.merged_into &&
  c.kind !== "situation";
export const isCandidate = (c: OntologyClaim) =>
  ["pending", "snoozed"].includes(c.core_status || "") &&
  !["withdrawn", "dismissed"].includes(c.state) &&
  !c.merged_into &&
  c.kind !== "situation";
export type CoreCommand = {
  action:
    | "admit"
    | "edit_candidate"
    | "later"
    | "reject"
    | "edit_core"
    | "importance"
    | "disable"
    | "restore";
  expected_version: string;
  request_id: string;
  statement?: string;
  conditions?: string;
  importance?: 1 | 2 | 3;
  restore_version?: string;
};
export type CorePage = {
  revision: string;
  items: OntologyClaim[];
  total: number;
  pending_count: number;
  offset: number;
  has_more: boolean;
};
export const coreApi = {
  list: (offset = 0, processed = false) =>
    request<CorePage>(
      `/zhijun/ontology/candidates?offset=${offset}&limit=8&processed=${processed}`,
    ),
  review: (id: string, body: CoreCommand) =>
    request<OntologyResult>(
      `/zhijun/ontology/${encodeURIComponent(id)}:admission`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  conversation: (claim: OntologyClaim) =>
    request<{
      claim: OntologyClaim;
      thread: import("../../dashboard/src/api/modules/octopThreads").OctopThread;
    }>(`/zhijun/ontology/${encodeURIComponent(claim.id)}:conversation`, {
      method: "POST",
      body: JSON.stringify({ expected_version: claim.version }),
    }),
};
export function openCoreQueue(id = "") {
  window.dispatchEvent(
    new CustomEvent("zhijun-open-core-queue", { detail: id }),
  );
}
export function coreChanged() {
  window.dispatchEvent(new Event("zhijun-memory-changed"));
}
export async function verifiedCoreReview(
  claim: OntologyClaim,
  command: Omit<CoreCommand, "expected_version" | "request_id">,
) {
  const result = await coreApi.review(claim.id, {
    ...command,
    expected_version: claim.version || "legacy",
    request_id: crypto.randomUUID(),
  });
  if (result.status !== "ready")
    throw new Error("这项理解已变化，请重新读取后确认。");
  const saved = await ontologyApi.get();
  const target = saved.claims.find((c) => c.id === claim.id);
  if (
    !target ||
    target.version !==
      result.ontology.claims.find((c) => c.id === claim.id)?.version
  )
    throw new Error("保存结果尚未核实，请重新读取。");
  coreChanged();
  return { ...result, ontology: saved };
}
