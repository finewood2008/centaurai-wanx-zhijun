import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  octopThreadsApi as threads,
  type OctopThread,
} from "../../dashboard/src/api/modules/octopThreads";
import { ConversationRecords } from "./ConversationRecords";
import { ConversationsPanel } from "./TopicConversations";
import { formatServerDateTime } from "../../dashboard/src/utils/formatMessageTime";

vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
const stamp = Date.parse("2026-10-01T16:10:00Z") / 1000;
function row(
  id: string,
  channel_type = "dashboard",
  last_active = stamp,
): OctopThread {
  return {
    thread_id: id,
    title: `主题 ${id}`,
    channel_type,
    session_key: `${channel_type}:${id}`,
    created_at: stamp - 100,
    last_active,
  };
}
beforeEach(() => {
  vi.spyOn(threads, "list").mockResolvedValue([
    row("web"),
    row("wx", "weixin", stamp + 5),
    row("other", "custom", stamp - 5),
  ]);
  vi.spyOn(threads, "history").mockImplementation(async (_agent, id) => ({
    thread_id: id,
    messages: [{ role: "user", content: `原话 ${id}` }],
    has_more: false,
  }));
  vi.spyOn(threads, "create");
  vi.spyOn(threads, "rename");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("unifies the list and keeps reading separate from explicitly continuing a conversation", async () => {
  const select = vi.fn();
  const start = vi.fn();
  render(
    <>
      <textarea aria-label="已有草稿" defaultValue="还没说完的话" />
      <ConversationsPanel
        agentId="own-profile"
        current="web"
        onSelect={select}
        onNew={start}
      />
    </>,
  );
  expect(screen.queryByRole("tab")).toBeNull();
  await screen.findByRole("button", { name: "查看原文：主题 wx" });
  fireEvent.click(screen.getByRole("button", { name: "查看原文：主题 wx" }));
  await screen.findByText("原话 wx");
  expect(threads.history).toHaveBeenCalledWith("own-profile", "wx", {
    limit: 25,
    offset: 0,
    cursor: null,
  });
  expect(select).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect(threads.create).not.toHaveBeenCalled();
  expect(threads.rename).not.toHaveBeenCalled();
  expect((screen.getByLabelText("已有草稿") as HTMLTextAreaElement).value).toBe(
    "还没说完的话",
  );
  fireEvent.click(screen.getByRole("button", { name: "接着聊" }));
  expect(select).toHaveBeenCalledWith("wx");
});

it("lists every returned channel, filters records and formats times in server timezone", async () => {
  render(<ConversationRecords agentId="own-profile" />);
  await screen.findByRole("button", { name: "查看原文：主题 wx" });
  expect(threads.list).toHaveBeenCalledWith("own-profile", 100);
  const cards = document.querySelectorAll(".record-row");
  expect(cards[0].textContent).toContain("主题 wx");
  expect(cards[0].textContent).toContain("微信");
  expect(cards[0].textContent).toContain(
    formatServerDateTime(stamp + 5, "Asia/Shanghai"),
  );
  expect(screen.getByRole("option", { name: "custom" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("对话渠道"), {
    target: { value: "微信" },
  });
  expect(screen.getAllByRole("button", { name: /查看原文：/ })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("对话渠道"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByLabelText("查找对话"), {
    target: { value: "other" },
  });
  expect(
    screen.getByRole("button", { name: "查看原文：主题 other" }),
  ).toBeTruthy();
});

it("paginates the loaded records and resets to the first page after filtering", async () => {
  vi.mocked(threads.list).mockResolvedValue(
    Array.from({ length: 11 }, (_, n) =>
      row(String(n), n === 10 ? "weixin" : "dashboard", stamp - n),
    ),
  );
  render(<ConversationRecords agentId="own-profile" />);
  await screen.findByRole("button", { name: "查看原文：主题 0" });
  expect(screen.getAllByRole("button", { name: /查看原文：/ })).toHaveLength(
    10,
  );
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(
    screen.getByRole("button", { name: "查看原文：主题 10" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("对话渠道"), {
    target: { value: "网页" },
  });
  expect(screen.getByRole("button", { name: "查看原文：主题 0" })).toBeTruthy();
});

it("reads earlier history with the archive cursor and strips internal tool and thinking blocks", async () => {
  const historyPages = [
    {
      thread_id: "wx",
      messages: [
        { role: "user", content: "最近原话" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "不可展示的内部内容" },
            { type: "text", text: "知君的回答" },
          ],
        },
        { role: "tool", content: "内部工具结果" },
      ],
      has_more: true,
      next_cursor: "archive-cursor",
    },
    {
      thread_id: "wx",
      messages: [{ role: "user", content: "更早原话" }],
      has_more: false,
    },
  ];
  vi.mocked(threads.history).mockImplementation(async (_agent, id, params) =>
    params?.limit === 4
      ? { thread_id: id, messages: [] }
      : historyPages.shift()!,
  );
  render(<ConversationRecords agentId="own-profile" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "查看原文：主题 wx" }),
  );
  await screen.findByText("知君的回答");
  expect(screen.queryByText(/不可展示的内部内容|内部工具结果/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更早的记录" }));
  await screen.findByText("更早原话");
  expect(threads.history).toHaveBeenLastCalledWith("own-profile", "wx", {
    limit: 25,
    offset: 25,
    cursor: "archive-cursor",
  });
  expect(
    (screen.getByRole("button", { name: "更早的记录" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("does not present a history projection in progress as an empty conversation", async () => {
  vi.mocked(threads.history).mockResolvedValue({
    thread_id: "wx",
    messages: [],
    history_loading: true,
    history_status: "queued",
    history_retry_after_ms: 60000,
  });
  render(<ConversationRecords agentId="own-profile" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "查看原文：主题 wx" }),
  );
  await screen.findByText("正在读取这段对话的历史记录…");
  expect(screen.queryByText("这段记录中没有对话正文。")).toBeNull();
});

it("retains read failures and rejects history from a different thread", async () => {
  vi.mocked(threads.history).mockResolvedValue({
    thread_id: "another",
    messages: [{ role: "user", content: "错误归属原话" }],
  });
  render(<ConversationRecords agentId="own-profile" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "查看原文：主题 wx" }),
  );
  await screen.findByText(/对话归属未核实/);
  expect(screen.queryByText("错误归属原话")).toBeNull();
  vi.mocked(threads.history).mockRejectedValueOnce(new Error("离线"));
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  await screen.findByText(/离线/);
  expect(screen.queryByText("这段记录中没有对话正文。")).toBeNull();
});

it("ignores a late history response after returning to the records list", async () => {
  let finish!: (value: Awaited<ReturnType<typeof threads.history>>) => void;
  vi.mocked(threads.history).mockImplementation(async (_agent, id, params) =>
    params?.limit === 4
      ? { thread_id: id, messages: [] }
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  render(<ConversationRecords agentId="own-profile" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "查看原文：主题 wx" }),
  );
  await waitFor(() => expect(finish).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /返回对话/ }));
  finish({
    thread_id: "wx",
    messages: [{ role: "user", content: "迟到原话" }],
  });
  await screen.findByRole("button", { name: "查看原文：主题 wx" });
  expect(screen.queryByText("迟到原话")).toBeNull();
});

it("shows a sourced recent excerpt while excluding internal thinking and tool results", async () => {
  vi.mocked(threads.history).mockImplementation(async (_agent, id) => ({
    thread_id: id,
    messages: [
      { role: "user", content: "上次聊到工作里的选择" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "不应出现的推理" },
          { type: "text", text: "最近的一句**回答**" },
        ],
      },
      { role: "tool", content: "不应出现的工具结果" },
    ],
  }));
  render(<ConversationRecords agentId="own-profile" />);
  await waitFor(() =>
    expect(document.querySelector(".conversation-excerpt")?.textContent).toBe(
      "知君：最近的一句回答",
    ),
  );
  expect(screen.queryByText(/不应出现/)).toBeNull();
  expect(threads.create).not.toHaveBeenCalled();
});

it("limits preview reads to the visible page and keeps two reads in flight when filtering", async () => {
  vi.mocked(threads.list).mockResolvedValue(
    Array.from({ length: 30 }, (_, n) =>
      row(String(n), n === 29 ? "weixin" : "web", stamp - n),
    ),
  );
  const pending: (() => void)[] = [];
  vi.mocked(threads.history).mockImplementation(
    (_agent, id) =>
      new Promise((resolve) => {
        pending.push(() =>
          resolve({
            thread_id: id,
            messages: [{ role: "user", content: `摘录 ${id}` }],
          }),
        );
      }),
  );
  render(<ConversationRecords agentId="own-profile" />);
  await waitFor(() => expect(threads.history).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText("对话渠道"), {
    target: { value: "微信" },
  });
  expect(threads.history).toHaveBeenCalledTimes(2);
  await act(async () => {
    pending[0]();
    pending[1]();
  });
  await waitFor(() => expect(threads.history).toHaveBeenCalledTimes(3));
  expect(threads.history).toHaveBeenLastCalledWith("own-profile", "29", {
    limit: 4,
    offset: 0,
  });
  expect(screen.queryByText(/摘录 0|摘录 1/)).toBeNull();
  await act(async () => pending[2]());
  await screen.findByText("摘录 29");
});

it("keeps a failed or unverified preview out of the conversation excerpt", async () => {
  vi.mocked(threads.history).mockResolvedValue({
    thread_id: "wrong-thread",
    messages: [{ role: "user", content: "其他对话的内容" }],
  });
  render(<ConversationRecords agentId="own-profile" />);
  await screen.findAllByText("打开原文，找回当时的对话。");
  expect(screen.queryByText("其他对话的内容")).toBeNull();
  expect(
    screen.getByRole("button", { name: "查看原文：主题 wx" }),
  ).toBeTruthy();
});

it("does not read previews for conversations that have not started", async () => {
  vi.mocked(threads.list).mockResolvedValue([
    { ...row("blank"), has_messages: false },
  ]);
  render(<ConversationRecords agentId="own-profile" />);
  await screen.findByText("还没开始说，随时可以聊起。");
  expect(threads.history).not.toHaveBeenCalled();
});
