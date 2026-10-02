import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryPanel } from "./MemoryViews";
import { PersonalOntologyView } from "./PersonalOntology";
import {
  ontologyApi,
  type PersonalOntology,
  type ContextNode,
} from "./ontology";
import { decisionApi } from "./decisions";
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="status">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
vi.mock("./MemoryMaintenance", () => ({
  MemoryMaintenanceAction: () => null,
  ArchivedMemories: () => null,
}));
const fact: ContextNode = {
  id: "fact:a",
  kind: "fact",
  title: "产品底座",
  statement: "知君使用万象的本机能力。",
  version: "n1",
  state: "active",
  source_kind: "native",
  owner_edited: false,
  evidence_valid: true,
  conditions: "",
  time_scope: "",
  aliases: [],
  native_ids: ["a"],
  evidence: [
    {
      atom_id: "a",
      event_id: "raw-a",
      quote: "知君建立在万象上",
      timestamp: "2026-10-02T00:00:00Z",
    },
  ],
  history: [],
  changed: false,
  core: false,
  emotion: "",
  occurred_at: "",
  merged_into: "",
};
const doc: PersonalOntology = {
  revision: "r1",
  generated_at: null,
  outdated: false,
  coverage: {
    read_atoms: 4,
    total_atoms: 4,
    eligible_sources: 4,
    independent_events: 4,
    has_more: false,
  },
  claims: Array.from({ length: 4 }, (_, i) => ({
    id: `c${i}`,
    version: `v${i}`,
    kind: "principle" as const,
    title: `理解 ${i}`,
    statement: `第 ${i} 项真实表述`,
    conditions: "在合作中",
    exceptions: "可以保留例外",
    state: "draft" as const,
    evidence_valid: true,
    reviewed_at: null,
    evidence: [
      {
        atom_id: `a${i}`,
        event_id: `raw${i}`,
        quote: `原话 ${i}`,
        timestamp: "2026-10-02T00:00:00Z",
      },
    ],
    core: i === 3,
  })),
  nodes: [fact],
  links: [],
  relations: [],
};
const props = { agentId: "synthetic", onSource: vi.fn(), onDiscuss: vi.fn() };
beforeEach(() => {
  vi.spyOn(ontologyApi, "get").mockResolvedValue(doc);
  vi.spyOn(ontologyApi, "generate");
  vi.spyOn(decisionApi, "read");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("keeps the two user-profile tabs and leaves the decision book out", async () => {
  render(<MemoryPanel {...props} />);
  await screen.findByLabelText("个人本体雷达图");
  expect(
    within(screen.getByLabelText("用户画像浏览方式"))
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["个人本体", "记忆资料"]);
  expect(screen.queryByText(/判断簿/)).toBeNull();
  expect(decisionApi.read).not.toHaveBeenCalled();
  expect(ontologyApi.generate).not.toHaveBeenCalled();
});
it("browses the same context materials under its separate tab", async () => {
  render(<PersonalOntologyView {...props} />);
  await screen.findByLabelText("个人本体雷达图");
  fireEvent.click(
    screen.getByRole("button", { name: "记忆资料", exact: true }),
  );
  await screen.findAllByText("知君使用万象的本机能力。");
  expect(
    screen
      .getByRole("button", { name: "记忆资料", exact: true })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
it("routes a material reference to the materials subtab", async () => {
  render(<PersonalOntologyView {...props} initialContextId="fact:a" />);
  await screen.findAllByText("知君使用万象的本机能力。");
  expect(
    screen
      .getByRole("button", { name: "记忆资料", exact: true })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
