import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersonalOntologyView } from "./PersonalOntology";
import {
  ontologyApi,
  coreApi,
  type OntologyClaim,
  type PersonalOntology,
} from "./ontology";
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
vi.mock("./MemoryMaintenance", () => ({ MemoryMaintenanceAction: () => null }));
const claim: OntologyClaim = {
  id: "c",
  version: "v1",
  kind: "principle",
  title: "我保留决定权",
  statement: "重要方向由我决定",
  conditions: "与 AI 协作",
  exceptions: "",
  state: "confirmed",
  core_status: "admitted",
  admitted_version: "v1",
  admitted_at: "2026-10-02T00:00:00Z",
  admitted_by: 7,
  importance: 1,
  evidence_valid: true,
  reviewed_at: null,
  evidence: [],
};
const doc: PersonalOntology = {
  revision: "r",
  generated_at: null,
  outdated: false,
  coverage: {
    read_atoms: 1,
    total_atoms: 1,
    eligible_sources: 1,
    independent_events: 1,
    has_more: false,
  },
  claims: [claim],
  nodes: [],
  links: [],
};
const props = { agentId: "owned", onSource: vi.fn(), onDiscuss: vi.fn() };
beforeEach(() => {
  vi.spyOn(ontologyApi, "get").mockResolvedValue(structuredClone(doc));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("shows only admitted nodes before text and opens a single accessible detail", async () => {
  vi.mocked(ontologyApi.get).mockResolvedValue({
    ...doc,
    claims: [
      claim,
      {
        ...claim,
        id: "pending",
        core_status: "pending",
        statement: "未经确认的推测",
      },
    ],
  });
  render(<PersonalOntologyView {...props} />);
  const point = await screen.findByRole("button", {
    name: "本人确认 重要方向由我决定",
  });
  expect(screen.queryByText("未经确认的推测")).toBeNull();
  expect(screen.queryByLabelText("选中的本体理解")).toBeNull();
  fireEvent.keyDown(point, { key: "Enter" });
  const detail = screen.getByLabelText("选中的本体理解");
  expect(within(detail).getByRole("heading").textContent).toBe(claim.statement);
  expect(
    screen.getByLabelText("个人本体雷达图").compareDocumentPosition(detail) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByText("符合我的理解")).toBeNull();
});
it("edits admitted content directly with a version check, and verifies the readback", async () => {
  const updated = {
    ...claim,
    version: "v2",
    admitted_version: "v2",
    statement: "重要方向由我和伙伴共同决定",
  };
  const review = vi.spyOn(coreApi, "review").mockImplementation(async () => {
    vi.mocked(ontologyApi.get).mockResolvedValue({ ...doc, claims: [updated] });
    return {
      status: "ready",
      ontology: { ...doc, claims: [updated] },
      changed_id: "c",
      previous_version: "v1",
    };
  });
  render(<PersonalOntologyView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /本人确认/ }));
  fireEvent.click(screen.getByRole("button", { name: /修改$/ }));
  fireEvent.change(screen.getByLabelText("理解表述"), {
    target: { value: updated.statement },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await screen.findByText("已保存修改。");
  expect(review).toHaveBeenCalledWith(
    "c",
    expect.objectContaining({
      action: "edit_core",
      expected_version: "v1",
      statement: updated.statement,
    }),
  );
});
it("preserves the draft and reports a stale save without success", async () => {
  vi.spyOn(coreApi, "review").mockResolvedValue({
    status: "stale",
    ontology: doc,
  });
  render(<PersonalOntologyView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /本人确认/ }));
  fireEvent.click(screen.getByRole("button", { name: /修改$/ }));
  fireEvent.change(screen.getByLabelText("理解表述"), {
    target: { value: "我的改写" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await screen.findByText("这项理解已变化，请重新读取后确认。");
  expect((screen.getByLabelText("理解表述") as HTMLTextAreaElement).value).toBe(
    "我的改写",
  );
  expect(screen.queryByText("已保存修改。")).toBeNull();
});
it("changes importance and can stop using a core understanding", async () => {
  const review = vi
    .spyOn(coreApi, "review")
    .mockImplementation(async (_id, body) => {
      const updated = {
        ...claim,
        version: "v2",
        admitted_version: "v2",
        importance: body.importance || 1,
      } as OntologyClaim;
      vi.mocked(ontologyApi.get).mockResolvedValue({
        ...doc,
        claims: [updated],
      });
      return { status: "ready", ontology: { ...doc, claims: [updated] } };
    });
  render(<PersonalOntologyView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /本人确认/ }));
  fireEvent.click(screen.getByRole("button", { name: "非常重要" }));
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith(
      "c",
      expect.objectContaining({ action: "importance", importance: 3 }),
    ),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "非常重要" })
        .getAttribute("aria-pressed"),
    ).toBe("true"),
  );
});
it("opens the robot queue without confirming any candidate", async () => {
  vi.mocked(ontologyApi.get).mockResolvedValue({
    ...doc,
    claims: [{ ...claim, core_status: "pending" }],
  });
  const listener = vi.fn();
  window.addEventListener("zhijun-open-core-queue", listener);
  const review = vi.spyOn(coreApi, "review");
  render(<PersonalOntologyView {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /待你确认/ }));
  expect(listener).toHaveBeenCalled();
  expect(review).not.toHaveBeenCalled();
  window.removeEventListener("zhijun-open-core-queue", listener);
});
