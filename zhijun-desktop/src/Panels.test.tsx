import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sources, Review } from "./Panels";
import { memoryDashboardApi as memory } from "../../dashboard/src/api/modules/memoryDashboard";

vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
const old = {
  id: "old",
  candidate_id: "candidate",
  assertion: "旧理解",
  verbatim_quote: "原话",
  deprecated_at: null,
};
const reference = { layer: "atom" as const, id: "old", path: "atom/old.md" };
beforeEach(() => {
  vi.spyOn(memory, "getAtom").mockImplementation(async (_aid, id) =>
    id === "new"
      ? ({ ...old, id: "new", assertion: "新的理解" } as never)
      : (old as never),
  );
  vi.spyOn(memory, "getCandidate").mockResolvedValue({ quote_event_id: "raw" });
  vi.spyOn(memory, "getRawEvent").mockResolvedValue({
    id: "raw",
    content: "合成原始记录",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("source and native write results", () => {
  it("resolves the original source and follows replacement id for a later edit", async () => {
    const replace = vi
      .spyOn(memory, "replaceAtom")
      .mockResolvedValue({ atom: { id: "new" } } as never);
    render(
      <Sources
        agentId="synthetic"
        reference={reference}
        references={[]}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText("合成原始记录");
    fireEvent.click(screen.getByRole("button", { name: "修正理解" }));
    fireEvent.change(screen.getByRole("textbox", { name: "修正后的文字" }), {
      target: { value: "新的理解" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));
    await screen.findByText(/已读回服务端结果/);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("synthetic", "old", {
        assertion: "新的理解",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "修正理解" }));
    fireEvent.change(screen.getByRole("textbox", { name: "修正后的文字" }), {
      target: { value: "再次核对" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));
    await waitFor(() =>
      expect(replace).toHaveBeenLastCalledWith("synthetic", "new", {
        assertion: "再次核对",
      }),
    );
  });
  it("never shows success when saving or reading back fails", async () => {
    vi.spyOn(memory, "replaceAtom").mockRejectedValue(
      new Error("connection lost"),
    );
    render(
      <Sources
        agentId="synthetic"
        reference={reference}
        references={[]}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText("合成原始记录");
    fireEvent.click(screen.getByRole("button", { name: "修正理解" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));
    await screen.findByText(/结果尚未核实/);
    expect(screen.queryByText(/已读回服务端结果/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "保存修正" }).hasAttribute("disabled"),
    ).toBe(true);
  });
  it("does not accept a deprecation unless server truth changed", async () => {
    vi.spyOn(memory, "deprecateAtom").mockResolvedValue({});
    render(
      <Sources
        agentId="synthetic"
        reference={reference}
        references={[]}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText("合成原始记录");
    fireEvent.click(screen.getByRole("button", { name: "弃用这条" }));
    fireEvent.click(screen.getByRole("button", { name: "弃用", exact: true }));
    await screen.findByText(/服务端尚未显示弃用/);
    expect(screen.queryByText(/记忆已弃用/)).toBeNull();
  });
  it("reports unavailable original records", async () => {
    vi.spyOn(memory, "getRawEvent").mockRejectedValue(
      new Error("source unavailable"),
    );
    render(
      <Sources
        agentId="synthetic"
        reference={reference}
        references={[]}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText(/source unavailable/);
    expect(screen.queryByText("合成原始记录")).toBeNull();
  });
});
it("promote shows the actual remaining needs-review state", async () => {
  const candidate = {
    id: "c1",
    assertion: "可能的理解",
    status: "needs_review",
    verbatim_quote: "合成原话",
    created_at: "2026-10-01",
    quote_event_id: "raw",
  };
  for (const method of [
    "terminalAboutMe",
    "terminalCurrentFocus",
    "terminalThingsYouToldMe",
    "terminalEntities",
  ] as const)
    vi.spyOn(memory, method).mockResolvedValue({ items: [] });
  vi.spyOn(memory, "listCandidates").mockResolvedValue({
    items: [candidate],
    total: 1,
    has_more: false,
  } as never);
  vi.spyOn(memory, "getCandidate").mockResolvedValue(candidate);
  vi.spyOn(memory, "promoteCandidate").mockResolvedValue({
    needs_review: 1,
  } as never);
  render(<Review agentId="synthetic" onSource={vi.fn()} onDiscuss={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "采纳" }));
  await screen.findByText(/原生处理后的状态：待核对/);
  expect(screen.queryByText("本人已确认")).toBeNull();
});
