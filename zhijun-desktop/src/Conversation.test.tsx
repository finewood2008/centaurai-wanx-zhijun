import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Conversation } from "./Conversation";
import { octopThreadsApi } from "../../dashboard/src/api/modules/octopThreads";
import { removeSession } from "../../dashboard/src/pages/Chat/hooks/chatStore";
import { uploadFile } from "../../dashboard/src/api/modules/upload";
import type { ChatMessage } from "../../dashboard/src/pages/Chat/hooks/useChat";
const mock = vi.hoisted(() => ({
  load: vi.fn(),
  send: vi.fn(),
  streaming: false,
  messages: [] as ChatMessage[],
}));
vi.mock("../../dashboard/src/hooks/useServerUploadLimit", () => ({
  useServerUploadLimit: () => ({ maxUploadBytes: 1024 * 1024, maxUploadMb: 1 }),
}));
vi.mock("../../dashboard/src/api/modules/upload", () => ({
  uploadFile: vi.fn(),
}));
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
vi.mock("../../dashboard/src/pages/Chat/hooks/chatStore", () => ({
  setFocusedChatSession: vi.fn(),
  removeSession: vi.fn(),
  onStreamEvent: vi.fn(() => () => {}),
}));
vi.mock("../../dashboard/src/pages/Chat/hooks/useChat", () => ({
  useChat: () => ({
    messages: mock.messages,
    isStreaming: mock.streaming,
    historyLoading: false,
    historyError: false,
    loadHistory: mock.load,
    sendMessage: mock.send,
  }),
}));
beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  mock.send.mockReset();
  mock.load.mockReset();
  mock.streaming = false;
  mock.messages = [];
  vi.mocked(uploadFile).mockReset();
  vi.mocked(uploadFile).mockResolvedValue({
    filename: "材料.txt",
    media_type: "text/plain",
    workspace_path: "inbound/material.txt",
    path: "inbound/material.txt",
    access_url: "/api/agents/owned/upload/source?path=inbound%2Fmaterial.txt",
    url: "/api/agents/owned/upload/source?path=inbound%2Fmaterial.txt",
  });
  vi.mocked(removeSession).mockClear();
  vi.spyOn(octopThreadsApi, "list").mockResolvedValue([
    { thread_id: "existing", session_key: "web:existing", channel_type: "web" },
  ] as never);
  vi.spyOn(octopThreadsApi, "create").mockResolvedValue({
    thread_id: "new",
    session_key: "web:new",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const props = () => ({
  agentId: "owned",
  scope: "1:owned",
  blocked: false,
  prefill: null,
  selectedThread: null,
  onThread: vi.fn(),
  onStreaming: vi.fn(),
  onReferences: vi.fn(),
  onSource: vi.fn(),
});
it("restores existing history and never sends a draft on reconnect", async () => {
  localStorage.setItem("zhijun:draft:1:owned:existing", "未发送的草稿");
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalledWith("existing"));
  await waitFor(() =>
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "未发送的草稿",
    ),
  );
  rerender(<Conversation {...initial} blocked />);
  rerender(<Conversation {...initial} />);
  expect(mock.send).not.toHaveBeenCalled();
  expect(octopThreadsApi.create).not.toHaveBeenCalled();
});
it("sends to the restored thread and the explicitly bound agent", async () => {
  render(<Conversation {...props()} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "合成材料" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(mock.send).toHaveBeenCalledWith(
    "合成材料",
    "web:existing",
    "owned",
    undefined,
    "existing",
  );
  expect(octopThreadsApi.create).not.toHaveBeenCalled();
});
it("never inherits another account's draft", async () => {
  localStorage.setItem("zhijun:draft:2:owned:existing", "另一账号的内容");
  render(<Conversation {...props()} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalled());
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
});
it("discards visited native message caches and sockets when leaving the account", async () => {
  const { unmount } = render(<Conversation {...props()} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalledWith("existing"));
  unmount();
  expect(removeSession).toHaveBeenCalledWith("existing");
});
it("blocks sending when the thread list could not be recovered", async () => {
  vi.spyOn(octopThreadsApi, "list").mockRejectedValue(
    new Error("history unavailable"),
  );
  render(<Conversation {...props()} />);
  await screen.findByText(/history unavailable/);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "保留草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(mock.send).not.toHaveBeenCalled();
  expect(octopThreadsApi.create).not.toHaveBeenCalled();
});
it("sends a successful file without text, clears the draft and never resends on reconnect", async () => {
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("选择对话文件"), {
    target: {
      files: [new File(["合成正文"], "材料.txt", { type: "text/plain" })],
    },
  });
  await screen.findByText("已上传 · 尚未发送");
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(mock.send).toHaveBeenCalledWith(
    "",
    "web:existing",
    "owned",
    [
      expect.objectContaining({
        workspacePath: "inbound/material.txt",
        filename: "材料.txt",
        kind: "file",
      }),
    ],
    "existing",
  );
  expect(screen.queryByLabelText("待发送文件")).toBeNull();
  rerender(<Conversation {...initial} blocked />);
  rerender(<Conversation {...initial} />);
  expect(mock.send).toHaveBeenCalledTimes(1);
});
it("preserves successful files when another fails, blocks send, and supports retry or removal", async () => {
  vi.mocked(uploadFile).mockImplementation(async (_agent, file) => {
    if (file.name === "失败.txt") throw new Error("upload lost");
    return {
      filename: file.name,
      workspace_path: `inbound/${file.name}`,
      path: `inbound/${file.name}`,
      media_type: "text/plain",
      url: "source",
      access_url: "source",
    };
  });
  render(<Conversation {...props()} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("选择对话文件"), {
    target: {
      files: [new File(["a"], "成功.txt"), new File(["b"], "失败.txt")],
    },
  });
  await screen.findByText("上传未完成");
  expect(screen.getByText("已上传 · 尚未发送")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "发送", exact: true })
      .hasAttribute("disabled"),
  ).toBe(true);
  vi.mocked(uploadFile).mockResolvedValueOnce({
    filename: "失败.txt",
    workspace_path: "inbound/retry.txt",
    path: "inbound/retry.txt",
    media_type: "text/plain",
    url: "source",
    access_url: "source",
  });
  fireEvent.click(screen.getByRole("button", { name: "重试上传 失败.txt" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "发送", exact: true })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "移除 失败.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(mock.send.mock.calls[0][3]).toHaveLength(1);
  expect(mock.send.mock.calls[0][3][0].filename).toBe("成功.txt");
});
it("discards pending files and ignores late upload completion on thread and account changes", async () => {
  let finish!: (value: Awaited<ReturnType<typeof uploadFile>>) => void;
  vi.mocked(uploadFile).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.spyOn(octopThreadsApi, "list").mockResolvedValue([
    { thread_id: "existing", session_key: "web:existing", channel_type: "web" },
    { thread_id: "other", session_key: "web:other", channel_type: "web" },
  ] as never);
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalledWith("existing"));
  fireEvent.change(screen.getByLabelText("选择对话文件"), {
    target: { files: [new File(["secret"], "旧会话.txt")] },
  });
  await screen.findByText("正在上传…");
  rerender(
    <Conversation {...initial} selectedThread={{ id: "other", key: 1 }} />,
  );
  await waitFor(() => expect(mock.load).toHaveBeenCalledWith("other"));
  expect(screen.queryByLabelText("待发送文件")).toBeNull();
  rerender(<Conversation {...initial} scope="2:owned" />);
  await act(async () =>
    finish({
      filename: "旧会话.txt",
      workspace_path: "inbound/old.txt",
      path: "inbound/old.txt",
      media_type: "text/plain",
      url: "source",
      access_url: "source",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText("已上传 · 尚未发送")).toBeNull(),
  );
  expect(screen.queryByLabelText("待发送文件")).toBeNull();
  expect(mock.send).not.toHaveBeenCalled();
});
it("creates a thread for a file-only first message and displays attachment-only history", async () => {
  vi.spyOn(octopThreadsApi, "list").mockResolvedValue([]);
  const attachment = {
    filename: "材料.txt",
    kind: "file" as const,
    workspacePath: "inbound/material.txt",
    url: "source",
  };
  const onAttachment = vi.fn();
  const { rerender } = render(
    <Conversation {...props()} onAttachment={onAttachment} />,
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "添加到对话" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("选择对话文件"), {
    target: { files: [new File(["body"], "材料.txt")] },
  });
  await screen.findByText("已上传 · 尚未发送");
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith(
      "",
      "web:new",
      "owned",
      expect.any(Array),
      "new",
    ),
  );
  mock.messages = [
    {
      id: "attachment-only",
      role: "user",
      status: "done",
      content: "",
      timestamp: Date.now(),
      attachments: [attachment],
    },
  ];
  rerender(<Conversation {...props()} onAttachment={onAttachment} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "材料.txt · 查看来源" }),
  );
  expect(onAttachment).toHaveBeenCalledWith(attachment);
});
it("keeps composer actions under one plus and closes them on Escape", async () => {
  render(<Conversation {...props()} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "上传文件" })).toBeNull();
  expect(screen.queryByRole("button", { name: "复盘一件事" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "添加到对话" }));
  expect(screen.getByRole("button", { name: /添加附件/ })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("button", { name: /添加附件/ })).toBeNull();
});
it("opens a blank conversation without deleting the prior draft or sending", async () => {
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "留在旧会话的草稿" },
  });
  rerender(<Conversation {...initial} selectedThread={{ id: null, key: 1 }} />);
  await screen.findByText("从此刻在意的事，聊起。");
  expect(localStorage.getItem("zhijun:draft:1:owned:existing")).toBe(
    "留在旧会话的草稿",
  );
  expect(localStorage.getItem("zhijun:thread:1:owned")).toBe("");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  expect(mock.send).not.toHaveBeenCalled();
});
it("carries an explicit private library selection with a discussion draft", async () => {
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await waitFor(() => expect(mock.load).toHaveBeenCalled());
  rerender(
    <Conversation
      {...initial}
      prefill={{
        text: "聊聊资料",
        key: 1,
        knowledge: { id: "OWNKB1", name: "我的资料" },
      }}
    />,
  );
  expect(screen.getByText("这次参考 · 我的资料")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(mock.send).toHaveBeenCalledWith(
    "聊聊资料",
    "web:existing",
    "owned",
    undefined,
    "existing",
    undefined,
    undefined,
    ["OWNKB1"],
  );
  expect(screen.queryByText("这次参考 · 我的资料")).toBeNull();
});
