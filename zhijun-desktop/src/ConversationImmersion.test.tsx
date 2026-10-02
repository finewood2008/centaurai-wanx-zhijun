import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Conversation } from "./Conversation";
import * as ontology from "./ontology";
import { responseOptionsApi } from "./responseOptions";
import { octopThreadsApi } from "../../dashboard/src/api/modules/octopThreads";
import type { ChatMessage } from "../../dashboard/src/pages/Chat/hooks/sseHelpers";
type NativeEvent = {
  kind: "streamStart" | "streamEnd" | "streamResume";
  sessionId: string;
};
const native = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  streaming: false,
  loading: false,
  refreshing: false,
  load: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  listeners: new Set<(event: NativeEvent) => void>(),
}));
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("./VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
vi.mock("../../dashboard/src/hooks/useServerUploadLimit", () => ({
  useServerUploadLimit: () => ({ maxUploadBytes: 1000000, maxUploadMb: 1 }),
}));
vi.mock("../../dashboard/src/pages/Chat/hooks/chatStore", () => ({
  removeSession: vi.fn(),
  setFocusedChatSession: vi.fn(),
  onStreamEvent: (listener: (event: NativeEvent) => void) => {
    native.listeners.add(listener);
    return () => native.listeners.delete(listener);
  },
}));
vi.mock("../../dashboard/src/pages/Chat/hooks/useChat", () => ({
  useChat: () => ({
    messages: native.messages,
    isStreaming: native.streaming,
    historyLoading: native.loading,
    historyRefreshing: native.refreshing,
    historyError: false,
    loadHistory: native.load,
    sendMessage: native.send,
    cancelStream: native.cancel,
  }),
}));
let reduced = true;
beforeEach(() => {
  vi.spyOn(ontology, "recordAssistedReply").mockResolvedValue({
    recorded: true,
  });
  vi.spyOn(ontology, "ontologyContext").mockResolvedValue({
    available: false,
    revision: "",
    claims: [],
  });
  vi.spyOn(responseOptionsApi, "generate").mockResolvedValue({
    status: "not_needed",
    invitation: null,
  });
  native.messages = [];
  native.streaming = false;
  native.loading = false;
  native.refreshing = false;
  native.listeners.clear();
  native.load.mockReset();
  native.send.mockReset();
  native.cancel.mockReset();
  reduced = true;
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(octopThreadsApi, "list").mockResolvedValue([
    { thread_id: "existing", session_key: "web:existing", channel_type: "web" },
    { thread_id: "other", session_key: "web:other", channel_type: "web" },
  ] as never);
  vi.spyOn(octopThreadsApi, "create").mockResolvedValue({
    thread_id: "new",
    session_key: "web:new",
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
const question = "你想先从哪里说起？";
const optionDraft = "我想先说眼下发生的具体事情。";
const optionsTool = () =>
  ({
    id: "options-tool",
    role: "assistant",
    status: "done",
    timestamp: 1000,
    content: "",
    toolData: {
      name: "zhijun_response_options",
      output: JSON.stringify({
        ok: true,
        version: 1,
        kind: "expression_invitation",
        question,
        options: [
          { label: "说具体的事", draft: optionDraft },
          { label: "暂不展开", draft: "我现在暂时不想展开。" },
        ],
      }),
    },
  }) as ChatMessage;
const reply = (id: string, status: "streaming" | "done" = "done") =>
  ({
    id,
    role: "assistant",
    status,
    timestamp: 2000,
    content: `我在这里。${question}`,
  }) as ChatMessage;
const input = () =>
  screen.getByRole("textbox", { name: "想说的话" }) as HTMLTextAreaElement;
async function ready() {
  await waitFor(() => expect(native.load).toHaveBeenCalledWith("existing"));
}
function send() {
  fireEvent.change(input(), { target: { value: "想聊聊" } });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
}

it("does not show the new-conversation welcome while restoring an existing empty conversation", async () => {
  native.loading = true;
  const p = props();
  const { rerender } = render(<Conversation {...p} />);
  await ready();
  expect(screen.queryByText("从此刻在意的事，聊起。")).toBeNull();
  expect(screen.queryByRole("button", { name: "说说近况" })).toBeNull();
  native.loading = false;
  rerender(<Conversation {...p} />);
  expect(screen.queryByText("从此刻在意的事，聊起。")).toBeNull();
  expect(screen.queryByRole("button", { name: "一起拿主意" })).toBeNull();
  expect(input()).toBeTruthy();
});

it("shows the current wait through reasoning and tool gaps, keeps drafts editable and removes it on completion", async () => {
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  native.streaming = true;
  native.messages = [
    { id: "user", role: "user", content: "刚发的话", timestamp: 1000 },
  ];
  rerender(<Conversation {...initial} />);
  expect(screen.getByText("知君正在接话…")).toBeTruthy();
  native.messages.push({
    ...reply("thinking", "streaming"),
    content: "",
    contentBlocks: [{ type: "thinking", content: "内部思考" }],
  });
  rerender(<Conversation {...initial} />);
  expect(screen.getByText("让我想一想…")).toBeTruthy();
  expect(screen.queryByText("内部思考")).toBeNull();
  fireEvent.change(input(), { target: { value: "我的下一句话" } });
  expect(input().value).toBe("我的下一句话");
  expect(native.send).not.toHaveBeenCalled();
  native.messages.push({
    ...optionsTool(),
    status: "streaming",
    toolData: { name: "zhijun_episode_search" },
  });
  rerender(<Conversation {...initial} />);
  expect(screen.getByText("我在回看相关记忆…")).toBeTruthy();
  native.messages[native.messages.length - 1].status = "done";
  native.messages.push(reply("visible", "streaming"));
  rerender(<Conversation {...initial} />);
  expect(screen.getByText("知君正在回应…")).toBeTruthy();
  native.streaming = false;
  native.messages[native.messages.length - 1].status = "done";
  rerender(<Conversation {...initial} />);
  expect(screen.queryByText("知君正在回应…")).toBeNull();
  expect(input().value).toBe("我的下一句话");
});

it("acknowledges sending immediately while a new thread is still being created", async () => {
  vi.mocked(octopThreadsApi.list).mockResolvedValue([]);
  vi.mocked(octopThreadsApi.create).mockImplementation(
    () => new Promise(() => {}),
  );
  render(<Conversation {...props()} />);
  await waitFor(() => expect(octopThreadsApi.list).toHaveBeenCalled());
  fireEvent.change(input(), { target: { value: "新的话题" } });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "发送",
          exact: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(screen.getByText("知君正在接话…")).toBeTruthy();
  expect(native.send).not.toHaveBeenCalled();
});

it("reads native text blocks without replaying history, and restores the latest unanswered choices", async () => {
  reduced = false;
  native.messages = [
    optionsTool(),
    {
      ...reply("history"),
      content: "错误回退正文",
      contentBlocks: [
        { type: "thinking", content: "内部思考不可作为回复" },
        { type: "text", content: "历史自然正文。" },
        { type: "text", content: question },
      ],
    },
  ];
  render(<Conversation {...props()} />);
  await ready();
  expect(
    screen.getByText(`历史自然正文。 ${question}`, { exact: false }),
  ).toBeTruthy();
  expect(screen.queryByText("内部思考不可作为回复")).toBeNull();
  expect(screen.queryByText("错误回退正文")).toBeNull();
  expect(screen.queryByRole("button", { name: "立即显示" })).toBeNull();
  expect(screen.queryByLabelText("回应思路")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  expect(screen.getByLabelText("回应思路")).toBeTruthy();
  expect(native.send).not.toHaveBeenCalled();
});
it("protects an existing draft and lets the user edit a choice before sending", async () => {
  const initial = props();
  native.messages = [optionsTool(), reply("question-reply")];
  render(<Conversation {...initial} />);
  await ready();
  fireEvent.change(input(), { target: { value: "已经写了一半" } });
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  expect(input().value).toBe("已经写了一半");
  expect(screen.queryByLabelText("回应思路")).toBeNull();
  expect(screen.getByText(/输入框里还有文字或资料/)).toBeTruthy();
  fireEvent.change(input(), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  fireEvent.click(screen.getByRole("button", { name: "借用思路：说具体的事" }));
  expect(native.send).not.toHaveBeenCalled();
  expect(input().value).toBe(optionDraft);
  expect(document.activeElement).toBe(input());
  expect(localStorage.getItem("zhijun:draft:1:owned:existing")).toBe(
    optionDraft,
  );
  expect(screen.queryByLabelText("回应思路")).toBeNull();
});
it("sends the fully visible selected response once, without leaving stale choices after another user turn", async () => {
  const initial = props();
  native.messages = [optionsTool(), reply("question-reply")];
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  const choice = screen.getByRole("button", { name: "借用思路：说具体的事" });
  expect(screen.getByText(optionDraft)).toBeTruthy();
  fireEvent.click(choice);
  expect(native.send).not.toHaveBeenCalled();
  expect(input().value).toBe(optionDraft);
  fireEvent.change(input(), {
    target: { value: optionDraft + "我还想补充一点。" },
  });
  const confirm = screen.getByRole("button", { name: "发送", exact: true });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(native.send).toHaveBeenCalledTimes(1));
  expect(native.send).toHaveBeenCalledWith(
    optionDraft + "我还想补充一点。",
    "web:existing",
    "owned",
    undefined,
    "existing",
  );
  expect(input().value).toBe("");
  expect(screen.queryByLabelText("回应思路")).toBeNull();
  native.messages = [
    ...native.messages,
    {
      id: "answered",
      role: "user",
      content: optionDraft,
      status: "done",
      timestamp: 3000,
    } as ChatMessage,
  ];
  rerender(<Conversation {...initial} />);
  expect(screen.queryByLabelText("回应思路")).toBeNull();
});
it("does not expose choices for an older question already followed by a user reply", async () => {
  native.messages = [
    optionsTool(),
    reply("older"),
    {
      id: "answered",
      role: "user",
      content: "我想先说工作。",
      status: "done",
      timestamp: 3000,
    } as ChatMessage,
  ];
  render(<Conversation {...props()} />);
  await ready();
  expect(screen.queryByLabelText("回应思路")).toBeNull();
  expect(native.send).not.toHaveBeenCalled();
});
it("keeps selected knowledge context intact instead of silently sending it with a suggested response", async () => {
  const initial = props();
  localStorage.setItem(
    "zhijun:draft:1:owned:existing:knowledge",
    JSON.stringify({ id: "OWNKB", name: "阅读资料" }),
  );
  native.messages = [optionsTool(), reply("question-reply")];
  render(<Conversation {...initial} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  expect(native.send).not.toHaveBeenCalled();
  expect(screen.getByText("这次参考 · 阅读资料")).toBeTruthy();
  expect(input().value).toBe("");
});
it("retains the selected reply as a draft when native send fails", async () => {
  native.send.mockImplementation(() => {
    throw new Error("connection lost");
  });
  native.messages = [optionsTool(), reply("question-reply")];
  render(<Conversation {...props()} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  fireEvent.click(screen.getByRole("button", { name: "借用思路：说具体的事" }));
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(input().value).toBe(optionDraft);
  expect(await screen.findByText(/connection lost/)).toBeTruthy();
  expect(localStorage.getItem("zhijun:draft:1:owned:existing")).toBe(
    optionDraft,
  );
});
it("animates a batched new done reply but a native streamResume immediately reveals resumed text without replay", async () => {
  reduced = false;
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  vi.useFakeTimers();
  send();
  native.messages = [reply("batched-new")];
  rerender(<Conversation {...initial} />);
  expect(screen.getByRole("button", { name: "立即显示" })).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(24);
  });
  expect(screen.queryByText(`我在这里。${question}`)).toBeNull();
  native.streaming = true;
  native.messages = [optionsTool(), reply("resumed-buffer", "streaming")];
  act(() => {
    for (const listener of native.listeners)
      listener({ kind: "streamResume", sessionId: "existing" });
  });
  rerender(<Conversation {...initial} />);
  expect(screen.getByText(`我在这里。${question}`)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "立即显示" })).toBeNull();
  expect(screen.queryByLabelText("回应思路")).toBeNull();
  expect(native.send).toHaveBeenCalledTimes(1);
});
it("keeps private-library context with its thread draft and restores it without carrying it to another thread", async () => {
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  const prefill = {
    text: "围绕资料聊",
    key: 1,
    knowledge: { id: "OWNKB", name: "阅读资料" },
  };
  rerender(<Conversation {...initial} prefill={prefill} />);
  expect(screen.getByText("这次参考 · 阅读资料")).toBeTruthy();
  rerender(
    <Conversation
      {...initial}
      prefill={prefill}
      selectedThread={{ id: "other", key: 2 }}
    />,
  );
  await waitFor(() => expect(native.load).toHaveBeenCalledWith("other"));
  expect(input().value).toBe("");
  expect(screen.queryByText("这次参考 · 阅读资料")).toBeNull();
  expect(localStorage.getItem("zhijun:draft:1:owned:existing:knowledge")).toBe(
    JSON.stringify(prefill.knowledge),
  );
  rerender(
    <Conversation
      {...initial}
      prefill={prefill}
      selectedThread={{ id: "existing", key: 3 }}
    />,
  );
  await waitFor(() => expect(input().value).toBe("围绕资料聊"));
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(native.send).toHaveBeenCalledWith(
    "围绕资料聊",
    "web:existing",
    "owned",
    undefined,
    "existing",
    undefined,
    undefined,
    ["OWNKB"],
  );
  expect(
    localStorage.getItem("zhijun:draft:1:owned:existing:knowledge"),
  ).toBeNull();
});
it("opens a new conversation with its stored draft, preserves the prior draft, and sends once to the newly created thread", async () => {
  localStorage.setItem("zhijun:draft:1:owned:new", "留在白纸上的草稿");
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  fireEvent.change(input(), { target: { value: "留在旧会话里的草稿" } });
  rerender(<Conversation {...initial} selectedThread={{ id: null, key: 1 }} />);
  await screen.findByText("从此刻在意的事，聊起。");
  expect(input().value).toBe("留在白纸上的草稿");
  expect(localStorage.getItem("zhijun:thread:1:owned")).toBe("");
  expect(localStorage.getItem("zhijun:draft:1:owned:existing")).toBe(
    "留在旧会话里的草稿",
  );
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() =>
    expect(native.send).toHaveBeenCalledWith(
      "留在白纸上的草稿",
      "web:new",
      "owned",
      undefined,
      "new",
    ),
  );
  expect(localStorage.getItem("zhijun:draft:1:owned:new")).toBe("");
  expect(native.load).not.toHaveBeenCalledWith("new");
});
it("follows a growing reply until the user scrolls up to read earlier text", async () => {
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  const flow = screen.getByLabelText("与知君的对话");
  let height = 900;
  Object.defineProperty(flow, "scrollHeight", {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(flow, "clientHeight", {
    configurable: true,
    value: 500,
  });
  native.messages = [reply("growing")];
  rerender(<Conversation {...initial} />);
  expect(flow.scrollTop).toBe(900);
  flow.scrollTop = 100;
  fireEvent.scroll(flow);
  height = 1200;
  native.messages = [reply("growing"), reply("next")];
  rerender(<Conversation {...initial} />);
  expect(flow.scrollTop).toBe(100);
  flow.scrollTop = 700;
  fireEvent.scroll(flow);
  height = 1400;
  native.messages = [...native.messages, reply("another")];
  rerender(<Conversation {...initial} />);
  expect(flow.scrollTop).toBe(1400);
  flow.scrollTop = 100;
  fireEvent.scroll(flow);
  fireEvent.click(screen.getByRole("button", { name: "回到最新对话 ↓" }));
  expect(flow.scrollTop).toBe(1400);
  expect(screen.queryByRole("button", { name: "回到最新对话 ↓" })).toBeNull();
});
it("restores an explicitly blank conversation and its draft after remount instead of selecting old history", async () => {
  const initial = props();
  const first = render(<Conversation {...initial} />);
  await ready();
  first.rerender(
    <Conversation {...initial} selectedThread={{ id: null, key: 1 }} />,
  );
  await screen.findByText("从此刻在意的事，聊起。");
  fireEvent.change(input(), { target: { value: "这份草稿还没发出去" } });
  expect(localStorage.getItem("zhijun:thread:1:owned")).toBe("");
  first.unmount();
  native.load.mockClear();
  render(<Conversation {...initial} />);
  await screen.findByText("从此刻在意的事，聊起。");
  expect(input().value).toBe("这份草稿还没发出去");
  expect(native.load).not.toHaveBeenCalled();
  expect(native.send).not.toHaveBeenCalled();
  expect(octopThreadsApi.create).not.toHaveBeenCalled();
});

it("automatically generates and opens choices for a new follow-up even when the Agent did not call the tool", async () => {
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  send();
  vi.mocked(responseOptionsApi.generate).mockResolvedValue({
    status: "ready",
    invitation: {
      question,
      options: [
        { label: "说具体的事", draft: optionDraft },
        { label: "暂不展开", draft: "暂时不展开。" },
      ],
    },
  });
  input().focus();
  native.messages = [reply("new-question")];
  rerender(<Conversation {...initial} />);
  const panel = await screen.findByRole("region", { name: "回应思路" });
  expect(panel.closest(".composer")).toBe(input().closest(".composer"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(input());
  expect(responseOptionsApi.generate).toHaveBeenCalledTimes(1);
  expect(responseOptionsApi.generate).toHaveBeenCalledWith(
    "existing",
    `我在这里。${question}`,
    false,
    expect.any(AbortSignal),
  );
  expect(native.send).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "收起回应思路" }));
  rerender(<Conversation {...initial} />);
  expect(screen.queryByRole("region", { name: "回应思路" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  expect(screen.getByRole("region", { name: "回应思路" })).toBeTruthy();
  expect(responseOptionsApi.generate).toHaveBeenCalledTimes(1);
});
it("waits for the typewriter, does not auto-open history, and exposes generation failure with retry", async () => {
  reduced = false;
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  send();
  native.messages = [reply("typed-question")];
  rerender(<Conversation {...initial} />);
  expect(responseOptionsApi.generate).not.toHaveBeenCalled();
  vi.mocked(responseOptionsApi.generate).mockResolvedValue({
    status: "unavailable",
    invitation: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "立即显示" }));
  await waitFor(() =>
    expect(responseOptionsApi.generate).toHaveBeenCalledOnce(),
  );
  expect(screen.queryByRole("region", { name: "回应思路" })).toBeNull();
  expect(screen.queryByText(/选项暂时没准备好/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  await screen.findByRole("button", { name: "重新生成" });
  expect(responseOptionsApi.generate).toHaveBeenCalledTimes(2);
});
it("never opens a late choice response after the user begins a new message or switches thread", async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof responseOptionsApi.generate>>,
  ) => void;
  vi.mocked(responseOptionsApi.generate).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  send();
  native.messages = [reply("late-question")];
  rerender(<Conversation {...initial} />);
  await waitFor(() =>
    expect(responseOptionsApi.generate).toHaveBeenCalledOnce(),
  );
  fireEvent.change(input(), { target: { value: "我想自己说" } });
  await act(async () =>
    finish({
      status: "ready",
      invitation: {
        question,
        options: [
          { label: "聊事情", draft: optionDraft },
          { label: "先等等", draft: "等等再说。" },
        ],
      },
    }),
  );
  expect(screen.queryByRole("region", { name: "回应思路" })).toBeNull();
  expect(input().value).toBe("我想自己说");
  fireEvent.change(input(), { target: { value: "" } });
  expect(screen.queryByRole("region", { name: "回应思路" })).toBeNull();
  rerender(
    <Conversation {...initial} selectedThread={{ id: "other", key: 5 }} />,
  );
  await waitFor(() => expect(native.load).toHaveBeenCalledWith("other"));
  expect(screen.queryByRole("region", { name: "回应思路" })).toBeNull();
});

it("lets the user keep thinking and typing while automatic directions quietly fold away", async () => {
  const initial = props();
  const { rerender } = render(<Conversation {...initial} />);
  await ready();
  send();
  native.messages = [optionsTool(), reply("optional-directions")];
  input().focus();
  rerender(<Conversation {...initial} />);
  await screen.findByRole("region", { name: "回应思路" });
  expect(document.activeElement).toBe(input());
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  fireEvent.change(input(), { target: { value: "我有自己的理解，不必选" } });
  expect(screen.queryByRole("region", { name: "回应思路" })).toBeNull();
  expect(input().value).toBe("我有自己的理解，不必选");
  expect(document.activeElement).toBe(input());
  expect(native.send).toHaveBeenCalledTimes(1);
  fireEvent.change(input(), { target: { value: "" } });
  expect(screen.queryByRole("region", { name: "回应思路" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  expect(screen.getByRole("region", { name: "回应思路" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "帮我选着说" }));
  expect(screen.queryByRole("region", { name: "回应思路" })).toBeNull();
});
