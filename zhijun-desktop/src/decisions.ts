import { request } from "../../dashboard/src/api/request";

export type DecisionRecord = {
  id: string;
  kind: "decision" | "agreement" | "question";
  description: string;
  expectation: string;
  revisit_at: string;
  sensitive: boolean;
  push_summary: string;
  state: "open" | "reviewed" | "cancelled";
  outcome: string;
  reflection: string;
  reminder_status: "none" | "sending" | "submitted" | "unknown";
};
export type DecisionBook = { revision: string; entries: DecisionRecord[] };
export const decisionApi = {
  read: () => request<DecisionBook>("/zhijun/decisions"),
  create: (body: {
    revision: string;
    kind: DecisionRecord["kind"];
    description: string;
    expectation: string;
    revisit_at: string;
    private: boolean;
    push_summary: string;
  }) =>
    request<DecisionBook>("/zhijun/decisions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  review: (
    id: string,
    body: {
      revision: string;
      action: "review" | "cancel";
      outcome?: string;
      reflection?: string;
    },
  ) =>
    request<DecisionBook>(
      `/zhijun/decisions/${encodeURIComponent(id)}:review`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
};
