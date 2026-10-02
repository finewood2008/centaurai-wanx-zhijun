import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { octopThreadsApi as threads } from "../../dashboard/src/api/modules/octopThreads";
import { ConversationsPanel } from "./TopicConversations";

vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
const row = {
  thread_id: "existing",
  title: "我的产品",
  channel_type: "web",
  session_key: "web:existing",
  created_at: 1790816400,
  last_active: 1790816400,
  has_messages: true,
};
beforeEach(() => {
  vi.spyOn(threads, "list").mockResolvedValue([row]);
  vi.spyOn(threads, "history").mockImplementation(async (_aid, id) => ({
    thread_id: id,
    messages: [],
  }));
  vi.spyOn(threads, "create");
  vi.spyOn(threads, "rename");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("recovers the unified list without sending or losing the title filter", async () => {
  vi.mocked(threads.list)
    .mockRejectedValueOnce(
      new Error(
        'Request failed: 502 Bad Gateway - {"error":{"message":"本机 WANX 未连接，请先启动万象。"}}',
      ),
    )
    .mockResolvedValue([row]);
  const select = vi.fn();
  render(
    <ConversationsPanel
      agentId="personal"
      current="existing"
      onSelect={select}
    />,
  );
  await screen.findByText(/本机 WANX 未连接/);
  expect(screen.queryByText(/Request failed/)).toBeNull();
  const query = screen.getByLabelText("查找对话");
  fireEvent.change(query, { target: { value: "产品" } });
  act(() => window.dispatchEvent(new Event("zhijun-service-restored")));
  await screen.findByRole("button", { name: "接着聊：我的产品" });
  expect((query as HTMLInputElement).value).toBe("产品");
  expect(threads.list).toHaveBeenCalledTimes(2);
  expect(threads.create).not.toHaveBeenCalled();
  expect(threads.rename).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it("starts a blank conversation directly without creating or naming a server thread", async () => {
  const start = vi.fn();
  const select = vi.fn();
  render(
    <ConversationsPanel
      agentId="personal"
      current="existing"
      onSelect={select}
      onNew={start}
    />,
  );
  const resume = await screen.findByRole("button", {
    name: "接着聊：我的产品",
  });
  expect(resume.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "开启新对话" }));
  expect(start).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  expect(threads.create).not.toHaveBeenCalled();
  expect(threads.rename).not.toHaveBeenCalled();
});

it("disables switching during a turn while keeping original history readable", async () => {
  const select = vi.fn();
  const start = vi.fn();
  const props = {
    agentId: "personal",
    current: "existing",
    onSelect: select,
    onNew: start,
  };
  const { rerender } = render(<ConversationsPanel {...props} />);
  await screen.findByRole("button", { name: "接着聊：我的产品" });
  rerender(<ConversationsPanel {...props} disabled />);
  fireEvent.click(screen.getByRole("button", { name: "接着聊：我的产品" }));
  fireEvent.click(screen.getByRole("button", { name: "开启新对话" }));
  expect(select).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看原文：我的产品" }));
  await screen.findByText("这段记录中没有对话正文。");
  expect(
    (screen.getByRole("button", { name: "接着聊" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("searches loaded titles, loads older conversations and explicitly continues an existing one", async () => {
  vi.mocked(threads.list).mockResolvedValue(
    Array.from({ length: 100 }, (_, index) => ({
      ...row,
      thread_id: `t${index}`,
      title: `产品 ${index}`,
    })),
  );
  const select = vi.fn();
  render(
    <ConversationsPanel agentId="personal" current={null} onSelect={select} />,
  );
  await screen.findByRole("button", { name: "接着聊：产品 0" });
  fireEvent.change(screen.getByLabelText("查找对话"), {
    target: { value: "42" },
  });
  expect(screen.getAllByRole("button", { name: /接着聊：产品/ })).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole("button", { name: "接着聊：产品 42" }));
  expect(select).toHaveBeenCalledWith("t42");
  fireEvent.click(screen.getByRole("button", { name: "读取更早的对话" }));
  await waitFor(() =>
    expect(threads.list).toHaveBeenLastCalledWith("personal", 200),
  );
  expect(threads.create).not.toHaveBeenCalled();
});
