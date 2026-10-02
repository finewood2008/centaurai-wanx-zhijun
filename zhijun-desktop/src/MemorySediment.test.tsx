import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Review } from "./MemoryViews";
import { MemoryJournal, readableMemoryNote } from "./MemoryRecords";
import {
  memoryDashboardApi as memory,
  type CandidateItem,
  type JournalItem,
} from "../../dashboard/src/api/modules/memoryDashboard";

vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders common processing reasons in Chinese without exposing internal identifiers", () => {
  expect(readableMemoryNote("entity resolved via alias '项目甲'")).toBe(
    "关联到已有主题「项目甲」",
  );
  expect(
    readableMemoryNote(
      "User singleton rule: merged 'User' into existing User entity 'User'",
    ),
  ).toBe("关联到本人已有记录");
  expect(
    readableMemoryNote(
      "polarity flip vs atom internal-id: NEG now, POS previously",
    ),
  ).toBe("与已有记忆的表述不同，请对照原话核对");
  expect(
    readableMemoryNote(
      "cross-entity exact-match assertion already in atom store (source entity: internal-id)",
    ),
  ).toBe("已有相同内容，关联到现有记忆");
  expect(readableMemoryNote("内部调试信息")).toBe("内部调试信息");
  expect(readableMemoryNote("unknown developer log")).toBe("");
});

it("shows partial extraction results and failures without expansion, grouped by server date", async () => {
  vi.spyOn(memory, "listJournal").mockResolvedValue({
    items: [
      {
        id: "partial",
        timestamp: "2026-10-01T16:15:00Z",
        action: "extract_run",
        actor: "auto",
        after: {
          events_considered: 4,
          candidates: 3,
          promoted: 1,
          failure_reason: "synthetic failure",
        },
      },
      {
        id: "unknown",
        timestamp: "2026-10-01T15:55:00Z",
        action: "extract_run",
        actor: "system",
        after: {},
      },
    ],
    total: 2,
    has_more: false,
  });
  const { container } = render(
    <MemoryJournal agentId="own" onSource={vi.fn()} />,
  );
  await screen.findByText("提炼未完成：synthetic failure");
  const today = screen.getByRole("region", { name: "2026-10-02" });
  const yesterday = screen.getByRole("region", { name: "2026-10-01" });
  expect(within(today).getByText("00:15")).toBeTruthy();
  expect(within(today).getByText("新增记忆")).toBeTruthy();
  expect(within(today).getByText("1 条")).toBeTruthy();
  expect(within(today).getByText("未完成")).toBeTruthy();
  expect(within(yesterday).getByText("23:55")).toBeTruthy();
  expect(within(yesterday).getByText("本次未提供提炼数量。")).toBeTruthy();
  expect(screen.queryByText("0 条")).toBeNull();
  expect(container.querySelector("details")).toBeNull();
  expect(container.querySelector("pre")).toBeNull();
});

it("keeps before/after text and the exact memory source visible in the timeline", async () => {
  vi.spyOn(memory, "listJournal").mockResolvedValue({
    items: [
      {
        id: "edit",
        timestamp: "2026-10-01T02:00:00Z",
        action: "replace",
        actor: "user",
        target_atom_id: "a1",
        target_summary: "更正一次理解",
        before: { assertion: "原先的说法" },
        after: { assertion: "更正后的说法" },
        note: "本人补充",
      },
    ],
    total: 1,
    has_more: false,
  });
  const source = vi.fn();
  render(<MemoryJournal agentId="own" onSource={source} />);
  await screen.findByText("原先的说法");
  expect(screen.getByText("更正后的说法")).toBeTruthy();
  expect(screen.getByText("本人操作")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看记忆" }));
  expect(source).toHaveBeenCalledWith({
    layer: "atom",
    id: "a1",
    path: "atom/a1.md",
  });
});

it("resets journal pagination on action changes and preserves the agent scope", async () => {
  const list = vi.spyOn(memory, "listJournal").mockResolvedValue({
    items: [
      {
        id: "j",
        timestamp: "2026-10-01T02:00:00Z",
        action: "promote",
        actor: "system",
        target_summary: "合成整理",
      },
    ],
    total: 21,
    has_more: true,
  });
  render(<MemoryJournal agentId="own" onSource={vi.fn()} />);
  await screen.findByText("合成整理");
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith("own", {
      offset: 20,
      limit: 20,
      action: undefined,
    }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "整理动作" }), {
    target: { value: "replace" },
  });
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith("own", {
      offset: 0,
      limit: 20,
      action: "replace",
    }),
  );
});

it("shows candidate evidence and reasons directly while only offering editable conversation drafts", async () => {
  const base: CandidateItem = {
    id: "c1",
    raw_event_ids: ["raw-1", "raw-2"],
    candidate_type: "Preference",
    status: "needs_review",
    title: "工作节奏",
    assertion: "我希望留出思考时间",
    verbatim_quote: "我想慢一点想清楚",
    quote_event_id: "raw-1",
    subject_name: "我",
    subject_entity_type: "Person",
    target_entity_id: null,
    confidence: "medium",
    importance: "medium",
    recommended_action: "review",
    promotion_reason: "这是本人表达的当下偏好",
    extractor_version: "test",
    created_at: "2026-10-01T02:00:00Z",
  };
  vi.spyOn(memory, "listCandidates").mockResolvedValue({
    items: [
      base,
      { ...base, id: "c2", assertion: "另一条已有记忆", status: "promoted" },
    ],
    total: 2,
    has_more: false,
  });
  const promote = vi.spyOn(memory, "promoteCandidate");
  const source = vi.fn();
  const discuss = vi.fn();
  const { container } = render(
    <Review agentId="own" onSource={source} onDiscuss={discuss} />,
  );
  await screen.findByText(base.assertion);
  const row = screen.getByText(base.assertion).closest("article")!;
  expect(within(row).getByText(base.verbatim_quote)).toBeTruthy();
  expect(within(row).getByText(base.promotion_reason)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "采纳" })).toHaveLength(1);
  fireEvent.click(within(row).getByRole("button", { name: "查看原话" }));
  expect(source).toHaveBeenCalledWith({
    layer: "raw",
    id: "raw-1",
    path: "/raw_events/raw-1",
  });
  fireEvent.click(within(row).getByRole("button", { name: "一起核对" }));
  expect(discuss).toHaveBeenCalledWith(expect.stringContaining("raw-1、raw-2"));
  expect(promote).not.toHaveBeenCalled();
  expect(container.querySelector("details")).toBeNull();
});
