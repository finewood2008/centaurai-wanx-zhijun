import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryPanel, Preferences } from "./MemoryViews";
import { memoryDashboardApi as memory } from "../../dashboard/src/api/modules/memoryDashboard";
import { providerApi } from "../../dashboard/src/api/modules/provider";
import { agentApi } from "../../dashboard/src/api/modules/agent";
import { personalWeixinApi as weixin } from "../../dashboard/src/api/modules/personalWeixin";
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
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const props = { agentId: "own", onSource: vi.fn(), onDiscuss: vi.fn() };
const preferences = {
  agent: { agent_id: "own", name: "知君" } as never,
  user: { username: "synthetic" } as never,
  logout: vi.fn(),
};
it("defaults to the unified personal ontology without duplicate profile requests", async () => {
  vi.mocked(memory.terminalAboutMe).mockResolvedValue({
    items: [{ id: "a", assertion: "合成画像", kind: "Preference" }],
  } as never);
  const themes = vi.spyOn(memory, "listEntities");
  render(<MemoryPanel {...props} />);
  await screen.findByText("个人本体");
  expect(
    screen
      .getByRole("button", { name: "用户画像" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(themes).not.toHaveBeenCalled();
  expect(memory.terminalAboutMe).not.toHaveBeenCalled();
});
it("sediment covers every native state and paginates conflicts", async () => {
  vi.spyOn(memory, "listCandidates").mockResolvedValue({
    items: [],
    total: 21,
    has_more: true,
  });
  render(<MemoryPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "记忆沉淀" }));
  await waitFor(() =>
    expect(memory.listCandidates).toHaveBeenCalledWith(
      "own",
      expect.objectContaining({ status: undefined }),
    ),
  );
  fireEvent.change(screen.getByLabelText("候选状态"), {
    target: { value: "conflict" },
  });
  await waitFor(() =>
    expect(memory.listCandidates).toHaveBeenLastCalledWith(
      "own",
      expect.objectContaining({ status: "conflict", offset: 0 }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() =>
    expect(memory.listCandidates).toHaveBeenLastCalledWith(
      "own",
      expect.objectContaining({ offset: 20 }),
    ),
  );
  expect(screen.getByRole("option", { name: "已提炼" })).toBeTruthy();
});
it("keeps raw source ids and extraction failures together in sediment", async () => {
  vi.spyOn(memory, "listCandidates").mockResolvedValue({
    items: [],
    total: 0,
    has_more: false,
  });
  vi.spyOn(memory, "listRawEvents").mockResolvedValue({
    items: [
      {
        id: "wx-raw",
        timestamp: "2026-10-01T02:00:00Z",
        event_type: "user_message",
        content: "合成微信原话",
      },
    ],
    total: 1,
    has_more: false,
  } as never);
  vi.spyOn(memory, "listJournal").mockResolvedValue({
    items: [
      {
        id: "j",
        timestamp: "2026-10-01T02:00:00Z",
        action: "extract_run",
        actor: "system",
        after: { failure_reason: "synthetic failure" },
      },
    ],
    total: 1,
    has_more: false,
  });
  render(<MemoryPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "记忆沉淀" }));
  fireEvent.click(screen.getByRole("button", { name: "原始素材" }));
  await screen.findByText("合成微信原话");
  fireEvent.click(screen.getByText("查看完整原话"));
  expect(props.onSource).toHaveBeenCalledWith({
    layer: "raw",
    id: "wx-raw",
    path: "/raw_events/wx-raw",
  });
  fireEvent.click(screen.getByRole("button", { name: "整理记录" }));
  await screen.findByText("提炼未完成：synthetic failure");
});
it("saves native model refs and verifies extraction settings", async () => {
  const cfg = {
    memory_enabled: true,
    extract_on_session_end: true,
    extract_trigger_mode: "idle" as const,
    extract_idle_seconds: 60,
    extract_interval_seconds: 600,
    aux_model: null,
  };
  vi.spyOn(memory, "getExtractConfig")
    .mockResolvedValueOnce(cfg)
    .mockResolvedValue({ ...cfg, aux_model: "local/model" });
  vi.spyOn(memory, "putExtractConfig").mockResolvedValue({
    ...cfg,
    aux_model: "local/model",
  });
  vi.spyOn(providerApi, "listResolvedModels").mockResolvedValue([
    {
      provider_id: 3,
      provider_name: "local",
      model: "model",
      name: "合成模型",
    },
  ] as never);
  render(<Preferences {...preferences} />);
  fireEvent.click(screen.getByRole("button", { name: "提炼设置" }));
  await screen.findByText("合成模型");
  fireEvent.change(screen.getByLabelText("提炼模型"), {
    target: { value: "local/model" },
  });
  fireEvent.click(screen.getByText("保存提炼设置"));
  await screen.findByText("已保存，并读取服务端配置核实。");
  expect(memory.putExtractConfig).toHaveBeenCalledWith(
    "own",
    expect.objectContaining({ aux_model: "local/model" }),
  );
});

it("keeps one detailed memory browser in the tree and configuration out of memory", async () => {
  vi.spyOn(memory, "listEntities").mockResolvedValue({
    items: [],
    total: 0,
    has_more: false,
  });
  vi.spyOn(memory, "listAtoms").mockResolvedValue({
    items: [],
    total: 0,
    has_more: false,
  });
  const extraction = vi.spyOn(memory, "getExtractConfig");
  const care = vi.spyOn(agentApi, "getProactiveCareConfig");
  const channels = vi.spyOn(weixin, "list");
  render(<MemoryPanel {...props} />);
  await screen.findByText("个人本体");
  expect(screen.queryByText("逐条查看与搜索")).toBeNull();
  expect(screen.queryByText("更多记忆功能")).toBeNull();
  for (const name of ["主动关心", "提炼设置", "微信对话"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "记忆树" }));
  fireEvent.click(screen.getByRole("button", { name: "全部记忆" }));
  await screen.findByRole("button", { name: "补充一条记忆" });
  expect(memory.listAtoms).toHaveBeenCalledWith(
    "own",
    expect.objectContaining({ limit: 20, offset: 0 }),
  );
  expect(screen.getAllByRole("textbox", { name: "搜索记忆" })).toHaveLength(1);
  expect(extraction).not.toHaveBeenCalled();
  expect(care).not.toHaveBeenCalled();
  expect(channels).not.toHaveBeenCalled();
});
it("loads settings on demand and leaves WeChat binding explicit", async () => {
  const extraction = vi.spyOn(memory, "getExtractConfig");
  const care = vi.spyOn(agentApi, "getProactiveCareConfig");
  const channels = vi.spyOn(weixin, "list").mockResolvedValue([]);
  const qr = vi.spyOn(weixin, "generate");
  render(<Preferences {...preferences} />);
  expect(screen.getByText("使用平台默认模型")).toBeTruthy();
  expect(extraction).not.toHaveBeenCalled();
  expect(care).not.toHaveBeenCalled();
  expect(channels).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "微信对话" }));
  await screen.findByText("尚未连接微信。扫码确认后才会绑定。");
  expect(channels).toHaveBeenCalledWith("own");
  expect(qr).not.toHaveBeenCalled();
});
it("keeps care off until saved and does not claim success on inconsistent readback", async () => {
  const cfg = {
    enabled: false,
    active_hours_start: "09:00",
    active_hours_end: "21:00",
    min_interval_hours: 24,
    max_interval_hours: 72,
  };
  vi.spyOn(agentApi, "getProactiveCareConfig").mockResolvedValue(cfg as never);
  const save = vi
    .spyOn(agentApi, "updateProactiveCareConfig")
    .mockResolvedValue({ ...cfg, enabled: true } as never);
  render(<Preferences {...preferences} />);
  fireEvent.click(screen.getByRole("button", { name: "主动关心" }));
  const toggle = (await screen.findByRole("checkbox", {
    name: "开启主动关心",
  })) as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "保存主动关心设置" }));
  await screen.findByText(/保存结果尚未核实/);
  expect(screen.queryByText("已保存，并读取服务端配置核实。")).toBeNull();
  expect(save).toHaveBeenCalledWith(
    "own",
    expect.objectContaining({ enabled: true }),
  );
});
