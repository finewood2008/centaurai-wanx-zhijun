import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EpisodeDetail,
  Episodes,
  MemoryPanel,
  Preferences,
} from "./MemoryViews";
import { memoryDashboardApi as memory } from "../../dashboard/src/api/modules/memoryDashboard";
vi.mock("./PersonalOntology", () => ({
  PersonalOntologyView: () => <div>个人本体</div>,
}));
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
beforeEach(() => {
  for (const key of [
    "terminalAboutMe",
    "terminalCurrentFocus",
    "terminalThingsYouToldMe",
    "terminalEntities",
  ] as const)
    vi.spyOn(memory, key).mockResolvedValue({ items: [] } as never);
  vi.spyOn(memory, "listEpisodes").mockResolvedValue({
    items: [
      {
        id: "ep1",
        occurred_at: "2026-10-01T02:00:00Z",
        summary: "一次重要交谈",
        emotion: "anxious",
        topics: ["工作"],
      },
    ],
    total: 21,
    has_more: true,
  } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("filters complete server-timezone dates, paginates and only prepares drafts", async () => {
  const discuss = vi.fn();
  const source = vi.fn();
  render(<Episodes agentId="personal" onSource={source} onDiscuss={discuss} />);
  await screen.findByText("一次重要交谈");
  fireEvent.click(screen.getByText("查找与筛选"));
  fireEvent.change(screen.getByRole("combobox", { name: "情绪筛选" }), {
    target: { value: "anxious" },
  });
  fireEvent.change(screen.getByLabelText("经历开始日期"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("经历结束日期"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "筛选经历" }));
  await waitFor(() =>
    expect(memory.listEpisodes).toHaveBeenLastCalledWith(
      "personal",
      expect.objectContaining({
        emotion: "anxious",
        date_from: "2026-09-30T16:00:00.000Z",
        date_to: "2026-10-01T16:00:00.000Z",
        offset: 0,
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() =>
    expect(memory.listEpisodes).toHaveBeenLastCalledWith(
      "personal",
      expect.objectContaining({ offset: 20 }),
    ),
  );
  fireEvent.click(await screen.findByRole("button", { name: "回看这段经历" }));
  expect(discuss).toHaveBeenCalledWith(
    expect.stringContaining("/episodes/ep1"),
  );
  expect(discuss).toHaveBeenCalledWith(
    expect.stringContaining("zhijun_episode_get"),
  );
  expect(source).not.toHaveBeenCalled();
});
it("reads episode raw provenance and makes a missing source visible without pretending to edit emotion", async () => {
  vi.spyOn(memory, "getEpisode").mockResolvedValue({
    id: "ep1",
    occurred_at: "2026-10-01T02:00:00Z",
    summary: "经历详情",
    emotion: "紧张",
    intensity: 3,
    raw_event_ids: ["raw1", "missing"],
    quote_event_id: "raw1",
  } as never);
  vi.spyOn(memory, "getRawEvent").mockImplementation(async (_aid, id) => {
    if (id === "missing") throw new Error("unavailable");
    return { id, content: "本人原话" };
  });
  const discuss = vi.fn();
  render(<EpisodeDetail agentId="personal" id="ep1" onDiscuss={discuss} />);
  await screen.findByText("本人原话");
  expect(screen.getByText(/这些来源暂时无法读取/).textContent).toContain(
    "missing",
  );
  expect(screen.getByText(/情绪标签目前只读/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "在对话里补充感受" }));
  expect(discuss).toHaveBeenCalledWith(
    expect.stringContaining("不直接修改情绪标签"),
  );
});
it("expands native entity-to-atom branches with paginated summaries and a record-bound draft", async () => {
  vi.spyOn(memory, "listEntities").mockResolvedValue({
    items: [{ id: "theme1", canonical_name: "我的项目", atom_count: 22 }],
    total: 1,
    has_more: false,
  } as never);
  vi.spyOn(memory, "getEntity").mockResolvedValue({
    canonical_name: "我的项目",
    page: { summary_markdown: "原生主题摘要", dirty: true },
  } as never);
  vi.spyOn(memory, "listAtoms").mockResolvedValue({
    items: [{ id: "atom1", assertion: "原生具体记忆", kind: "Fact" }],
    total: 22,
    has_more: true,
  } as never);
  const discuss = vi.fn();
  render(
    <MemoryPanel agentId="personal" onSource={vi.fn()} onDiscuss={discuss} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "记忆树" }));
  fireEvent.click(await screen.findByRole("button", { name: /我的项目/ }));
  await screen.findByText("原生主题摘要");
  expect(memory.getEntity).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /我的项目/ }));
  fireEvent.click(screen.getByRole("button", { name: /我的项目/ }));
  expect(memory.getEntity).toHaveBeenCalledOnce();
  expect(screen.getByText(/正在等待原生重新整理/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "沿着这个主题继续聊" }));
  expect(discuss).toHaveBeenCalledWith(
    expect.stringContaining("page/theme1.md"),
  );
  const nextButtons = screen.getAllByRole("button", { name: "下一页" });
  fireEvent.click(
    nextButtons.find((button) => !(button as HTMLButtonElement).disabled)!,
  );
  await waitFor(() =>
    expect(memory.listAtoms).toHaveBeenLastCalledWith(
      "personal",
      expect.objectContaining({ entity_id: "theme1", offset: 20 }),
    ),
  );
});

it("groups native emotions by the server's calendar day and opens their actual source", async () => {
  vi.mocked(memory.listEpisodes).mockResolvedValue({
    items: [
      {
        id: "ep1",
        occurred_at: "2026-10-01T02:00:00Z",
        summary: "合成早晨",
        emotion: "anxious",
        intensity: 3,
        topics: [],
      },
      {
        id: "ep2",
        occurred_at: "2026-09-30T17:00:00Z",
        summary: "合成凌晨",
        emotion: "happy",
        intensity: 2,
        topics: [],
      },
      {
        id: "ep3",
        occurred_at: "2026-09-30T12:00:00Z",
        summary: "合成前晚",
        emotion: "tired",
        intensity: 1,
        topics: [],
      },
    ],
    total: 3,
    has_more: false,
  } as never);
  const source = vi.fn();
  const discuss = vi.fn();
  vi.spyOn(memory, "listEntities").mockResolvedValue({
    items: [],
    total: 0,
    has_more: false,
  });
  render(
    <MemoryPanel agentId="personal" onSource={source} onDiscuss={discuss} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "情绪日记" }));
  await screen.findByText("合成早晨");
  const day = screen.getByRole("region", { name: "2026-10-01 的情绪日记" });
  expect(day.textContent).toContain("合成早晨");
  expect(day.textContent).toContain("合成凌晨");
  expect(day.textContent).not.toContain("合成前晚");
  expect(
    screen.getByRole("region", { name: "2026-09-30 的情绪日记" }).textContent,
  ).toContain("合成前晚");
  expect(
    screen.getByLabelText("情绪强度 3/5").querySelectorAll(".filled"),
  ).toHaveLength(3);
  fireEvent.click(screen.getAllByRole("button", { name: "查看经历与原话" })[0]);
  expect(source).toHaveBeenCalledWith({
    layer: "episode",
    id: "ep1",
    path: "/episodes/ep1",
  });
  expect(discuss).not.toHaveBeenCalled();
  expect(
    screen.getByText("回看一段时间").parentElement?.hasAttribute("open"),
  ).toBe(false);
  fireEvent.click(screen.getByText("回看一段时间"));
  fireEvent.click(screen.getByRole("button", { name: "回看最近七天" }));
  expect(discuss).toHaveBeenCalledWith(
    expect.stringContaining("只依据实际读到的材料"),
  );
});

it("shows the platform model fallback as read-only when the profile has no override", async () => {
  vi.spyOn(memory, "getExtractConfig").mockResolvedValue({
    memory_enabled: true,
    extract_trigger_mode: "idle",
    extract_idle_seconds: 60,
  } as never);
  vi.spyOn(memory, "listJournal").mockResolvedValue({
    items: [],
    total: 0,
    has_more: false,
  });
  const props = {
    agent: { agent_id: "personal", name: "知君", default_model: null } as never,
    user: { username: "synthetic" } as never,
    logout: vi.fn(),
  };
  const { rerender } = render(<Preferences {...props} />);
  await screen.findByText("使用平台默认模型");
  expect(screen.getByText("使用平台默认模型")).toBeTruthy();
  expect(screen.queryByText("尚未配置")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  rerender(
    <Preferences
      {...props}
      agent={
        {
          agent_id: "personal",
          name: "知君",
          default_model: "provider/model",
        } as never
      }
    />,
  );
  expect(screen.getByText("provider/model")).toBeTruthy();
  expect(screen.queryByText("使用平台默认模型")).toBeNull();
});
