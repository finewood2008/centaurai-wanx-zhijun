import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnderstandingPanel } from "./UnderstandingPanel";
import { Conversation } from "./Conversation";
import { CareSettings } from "./MemorySettings";
import { understandingApi, type UnderstandingState } from "./understanding";
import { coreApi, ontologyApi, type OntologyClaim } from "./ontology";
import { octopThreadsApi } from "../../dashboard/src/api/modules/octopThreads";
import { agentApi } from "../../dashboard/src/api/modules/agent";
import { personalWeixinApi } from "../../dashboard/src/api/modules/personalWeixin";
import type { ProactiveCareConfig } from "../../dashboard/src/api/types";

const chat = vi.hoisted(() => ({
  send: vi.fn(),
  load: vi.fn(),
  streaming: false,
  voice: false,
}));
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("./VoiceInput", () => ({
  VoiceInput: ({
    onBusyChange,
  }: {
    onBusyChange: (value: boolean) => void;
  }) => (
    <button
      onClick={() => {
        chat.voice = !chat.voice;
        onBusyChange(chat.voice);
      }}
    >
      合成语音输入
    </button>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
vi.mock("../../dashboard/src/hooks/useServerUploadLimit", () => ({
  useServerUploadLimit: () => ({ maxUploadBytes: 1000000, maxUploadMb: 1 }),
}));
vi.mock("../../dashboard/src/pages/Chat/hooks/chatStore", () => ({
  removeSession: vi.fn(),
  setFocusedChatSession: vi.fn(),
  onStreamEvent: () => () => {},
}));
vi.mock("../../dashboard/src/pages/Chat/hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    isStreaming: chat.streaming,
    historyLoading: false,
    historyRefreshing: false,
    historyError: false,
    loadHistory: chat.load,
    sendMessage: chat.send,
  }),
}));

const initial: UnderstandingState = {
  revision: "r1",
  enabled: false,
  weixin_reminders: false,
  libraries: [
    {
      kb_id: "PERSONAL",
      name: "我的过往",
      default_open: true,
      role: "mixed",
      selected: true,
    },
    {
      kb_id: "REF",
      name: "读书资料",
      default_open: false,
      role: "mixed",
      selected: false,
    },
  ],
  model: { name: "合成在线模型", local: false },
  progress: {
    status: "idle",
    documents_total: 0,
    documents_read: 0,
    characters_total: 0,
    characters_read: 0,
    pending_documents: 0,
    failed_documents: 0,
    last_error: null,
  },
  invitations: [],
};
const invite: UnderstandingState["invitations"][number] = {
  id: "INVITE",
  title: "九月的团队分工",
  question: "当时的分工，对你意味着什么？",
  summary: "可能值得核对的变化",
  quote: "我希望责任与决定权相配。",
  status: "pending",
  activation_phrase: "聊聊九月的团队分工",
  source: {
    kb_id: "PERSONAL",
    document_id: "DOC",
    filename: "九月记录.md",
    source_version: "hash-v1",
    start: 120,
    end: 139,
  },
};
let stored: UnderstandingState;
beforeEach(() => {
  stored = structuredClone(initial);
  chat.send.mockReset();
  chat.load.mockReset();
  chat.streaming = false;
  chat.voice = false;
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
  vi.spyOn(understandingApi, "get").mockImplementation(async () => stored);
  vi.spyOn(understandingApi, "save").mockImplementation(async (body) => {
    stored = {
      ...stored,
      ...body,
      revision: "r2",
      libraries: stored.libraries.map((row) => ({
        ...row,
        ...body.libraries.find((value) => value.kb_id === row.kb_id),
      })),
    };
    return stored;
  });
  vi.spyOn(understandingApi, "run").mockImplementation(async () => {
    stored = {
      ...stored,
      revision: "r3",
      enabled: true,
      progress: { ...stored.progress, status: "pending" },
    };
    return stored;
  });
  vi.spyOn(understandingApi, "pause").mockImplementation(async () => {
    stored = {
      ...stored,
      revision: "r4",
      enabled: false,
      progress: { ...stored.progress, status: "paused" },
    };
    return stored;
  });
  vi.spyOn(understandingApi, "review").mockImplementation(
    async (id, _revision, action) => {
      stored = {
        ...stored,
        revision: "review",
        invitations: stored.invitations.map((item) =>
          item.id !== id
            ? item
            : {
                ...item,
                read_at: "2026-10-02T00:00:00Z",
                status:
                  action === "read"
                    ? item.status
                    : action === "accept"
                    ? "active"
                    : action === "later"
                    ? "snoozed"
                    : action === "dismiss"
                    ? "dismissed"
                    : "resolved",
              },
        ),
      };
      return stored;
    },
  );
  vi.spyOn(understandingApi, "conversation").mockImplementation(async (id) => {
    stored = {
      ...stored,
      revision: "conversation",
      invitations: stored.invitations.map((item) =>
        item.id === id
          ? {
              ...item,
              read_at: "now",
              status: "active",
              discussion_thread_id: "reverb-thread",
            }
          : item,
      ),
    };
    return {
      state: stored,
      thread: {
        thread_id: "reverb-thread",
        session_key: "web:existing",
        channel_type: "web",
        title: "九月的团队分工",
        created_at: 0,
        last_active: 0,
      },
    };
  });
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
const input = () =>
  screen.getByRole("textbox", { name: "想说的话" }) as HTMLTextAreaElement;

it("shows the actual synthesis model and scope without starting; saves attribution and starts only on explicit action", async () => {
  render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
  await screen.findByText("合成在线模型");
  expect(screen.getByText("在线模型会读取所选资料正文")).toBeTruthy();
  expect(understandingApi.run).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox", { name: "我的过往" })).toHaveProperty(
    "checked",
    true,
  );
  expect(screen.getByRole("checkbox", { name: "读书资料" })).toHaveProperty(
    "checked",
    false,
  );
  fireEvent.change(screen.getByLabelText("我的过往的资料归属"), {
    target: { value: "personal" },
  });
  fireEvent.click(screen.getByText("开始深入理解"));
  await screen.findByText(/已开始深入理解/);
  expect(understandingApi.save).toHaveBeenCalledWith(
    expect.objectContaining({
      revision: "r1",
      enabled: true,
      libraries: [
        { kb_id: "PERSONAL", role: "personal", selected: true },
        { kb_id: "REF", role: "mixed", selected: false },
      ],
    }),
  );
  expect(understandingApi.run).toHaveBeenCalledWith("r2");
  fireEvent.click(screen.getByText("暂停持续理解"));
  await screen.findAllByText("已暂停");
  expect(understandingApi.pause).toHaveBeenCalledWith("r3");
});

it("keeps partial progress and failure truthful instead of presenting the corpus as complete", async () => {
  stored = {
    ...stored,
    enabled: true,
    progress: {
      status: "failed",
      documents_total: 12,
      documents_read: 3,
      characters_total: 80000,
      characters_read: 12000,
      pending_documents: 8,
      failed_documents: 1,
      last_error: "synthesis_unavailable",
    },
  };
  render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
  await screen.findAllByText("部分阅读未完成");
  expect(screen.getByText(/已读 3 \/ 12 份/)).toBeTruthy();
  expect(screen.getByText(/8 份尚待处理 · 1 份未完成/)).toBeTruthy();
  expect(screen.getByText(/综合理解暂未完成/)).toBeTruthy();
  expect(screen.queryByText("当前范围已读完")).toBeNull();
  expect(screen.getByText("阅读管理与详细进度").closest("details")!.open).toBe(
    true,
  );
});

it("keeps completed reading quiet while leaving management available on expansion", async () => {
  stored = {
    ...stored,
    enabled: true,
    progress: {
      ...stored.progress,
      status: "complete",
      documents_total: 7,
      documents_read: 7,
      characters_total: 10000,
      characters_read: 10000,
    },
  };
  render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
  const summary = await screen.findByText("阅读管理与详细进度");
  expect(summary.closest("details")!.open).toBe(false);
  expect(screen.getByText("当前范围已读完")).toBeTruthy();
  fireEvent.click(summary);
  expect(summary.closest("details")!.open).toBe(true);
  expect(screen.getByRole("button", { name: "暂停持续理解" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "调整阅读与资料性质" }),
  ).toBeTruthy();
  expect(understandingApi.pause).not.toHaveBeenCalled();
  expect(understandingApi.run).not.toHaveBeenCalled();
});

it("keeps document reading ranges quiet for older services and empty documents", async () => {
  const view = render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
  await screen.findByText("合成在线模型");
  expect(screen.queryByText(/资料阅读范围/)).toBeNull();
  stored = { ...stored, documents: {} };
  await act(async () => {
    window.dispatchEvent(new Event("zhijun-understanding-changed"));
  });
  expect(view.container.querySelector(".understanding-reading")).toBeNull();
});

it("discloses each current document's read range, pending state and actual failures in a collapsed section", async () => {
  const document = {
    kb_id: "PERSONAL",
    document_id: "DOC",
    filename: "已读资料.md",
    source_version: "hash-v1",
    offset: 4000,
    total_chars: 4000,
    status: "complete" as const,
  };
  stored.documents = {
    complete: document,
    partial: {
      ...document,
      filename: "长篇回忆.md",
      offset: 1200,
      status: "reading",
    },
    pending: {
      ...document,
      filename: "尚待处理.md",
      offset: 0,
      status: "pending",
    },
    unavailable: {
      ...document,
      filename: "正在提取.md",
      offset: 0,
      total_chars: 0,
      status: "unavailable",
      last_error: "source_not_ready",
    },
    failed: {
      ...document,
      filename: "尚未理解.md",
      offset: 2000,
      status: "failed",
      last_error: "synthesis_unavailable",
    },
    unknown: {
      ...document,
      filename: "需要检查.md",
      offset: 2000,
      status: "failed",
      last_error: "合成存储错误：原文暂不可读",
    },
  };
  render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
  const summary = await screen.findByText("资料阅读范围 · 6 份");
  const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  expect(screen.getByText("已读 1,200 / 4,000 字")).toBeTruthy();
  expect(screen.getByText("已读一部分")).toBeTruthy();
  expect(screen.getByText("当前版本已读完")).toBeTruthy();
  expect(screen.getByText("等待阅读")).toBeTruthy();
  expect(screen.getByText("正文尚未就绪")).toBeTruthy();
  expect(screen.getByText("已读 0 字 · 总字数尚未就绪")).toBeTruthy();
  expect(
    screen.getByText("部分资料正文尚未整理完成，会在就绪后继续阅读。"),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "综合理解暂未完成，已读进度和已有理解仍保留，可稍后重试。",
    ),
  ).toBeTruthy();
  expect(screen.getByText("合成存储错误：原文暂不可读")).toBeTruthy();
});

it("paginates document reading ranges in groups of twenty", async () => {
  stored.documents = Object.fromEntries(
    Array.from({ length: 21 }, (_, index) => [
      `DOC${index}`,
      {
        kb_id: "PERSONAL",
        document_id: `DOC${index}`,
        filename: `第${index + 1}份合成资料.md`,
        source_version: "hash-v1",
        offset: 0,
        total_chars: 100,
        status: "pending" as const,
      },
    ]),
  );
  render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
  const summary = await screen.findByText("资料阅读范围 · 21 份");
  const details = summary.closest("details")!;
  fireEvent.click(summary);
  const section = within(details);
  expect(details.querySelectorAll("article")).toHaveLength(20);
  expect(section.queryByText("第21份合成资料.md")).toBeNull();
  fireEvent.click(section.getByRole("button", { name: "下一页" }));
  expect(details.querySelectorAll("article")).toHaveLength(1);
  expect(section.getByText("第21份合成资料.md")).toBeTruthy();
  expect(section.getByRole("button", { name: "下一页" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(section.getByRole("button", { name: "上一页" }));
  expect(section.getByText("第1份合成资料.md")).toBeTruthy();
});

it("offers source-bound personal understanding as a collapsed review rather than a one-click confirmed principle", async () => {
  stored = {
    ...stored,
    enabled: true,
    invitations: [
      {
        ...invite,
        role: "personal",
        suggested_statement: "我希望责任与决定权相配。",
        meaning: "投入前会留意分工与决定权。",
        conditions: "涉及重要合作时",
        time_scope: "2026年九月",
        exceptions: "短期协助尚待了解",
      },
    ],
  };
  const source = vi.fn();
  render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={source}
      onUpdated={vi.fn()}
    />,
  );
  const summary = await screen.findByText("待核对的理解 · 1");
  expect(summary.closest("details")).toHaveProperty("open", false);
  fireEvent.click(summary);
  expect(screen.getByText(/不会直接成为个人本体/)).toBeTruthy();
  expect(screen.getByText("涉及重要合作时")).toBeTruthy();
  expect(screen.getByText("2026年九月")).toBeTruthy();
  expect(screen.getByText("短期协助尚待了解")).toBeTruthy();
  expect(screen.getByText(/可能的含义：投入前会留意分工与决定权/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /确认|采纳|符合我的理解/ }),
  ).toBeNull();
  expect(screen.queryByText("资料中，值得一起聊的线索")).toBeNull();
  fireEvent.click(screen.getByText("查看原文依据"));
  expect(source).toHaveBeenCalledWith(
    expect.objectContaining({ id: "DOC", sourceVersion: "hash-v1" }),
  );
});

it("omits unavailable source proposals and invitations, and does not expose their acceptance action", async () => {
  stored = {
    ...stored,
    enabled: true,
    invitations: [
      {
        ...invite,
        role: "personal",
        suggested_statement: "已失效的建议",
        source_available: false,
      },
    ],
  };
  render(
    <>
      <UnderstandingPanel
        agentId="owned"
        expanded
        onToggle={vi.fn()}
        onSource={vi.fn()}
        onUpdated={vi.fn()}
      />
      <Conversation {...props()} />
    </>,
  );
  await waitFor(() => expect(chat.load).toHaveBeenCalledWith("existing"));
  expect(screen.queryByText("已失效的建议")).toBeNull();
  expect(screen.queryByText(/待核对的理解/)).toBeNull();
  expect(screen.queryByLabelText("来自资料的交谈邀请")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "聊聊", exact: true }),
  ).toBeNull();
  expect(understandingApi.review).not.toHaveBeenCalled();
});

it("shows verification failure in Chinese and leaves unfamiliar actual errors visible", async () => {
  stored = {
    ...stored,
    enabled: true,
    progress: {
      ...stored.progress,
      status: "failed",
      last_error: "unverified_reading_proposal",
    },
  };
  const panel = render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
  await screen.findByText(/本次理解线索尚未通过原文核验/);
  expect(screen.queryByText("unverified_reading_proposal")).toBeNull();
  panel.unmount();
  stored = {
    ...stored,
    progress: {
      ...stored.progress,
      last_error: "资料读取失败：无法解析该格式",
    },
  };
  render(
    <UnderstandingPanel
      agentId="owned"
      expanded
      onToggle={vi.fn()}
      onSource={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
  await screen.findByText("资料读取失败：无法解析该格式");
});

it("keeps multiple material invitations outside the composer and preserves the original draft when opening their topic", async () => {
  stored = {
    ...stored,
    enabled: false,
    invitations: [invite, { ...invite, id: "SECOND", title: "另一条思考" }],
  };
  const p = props();
  render(<Conversation {...p} />);
  const entry = await screen.findByRole("button", { name: /2 项待处理/ });
  fireEvent.change(input(), { target: { value: "原对话的草稿" } });
  input().focus();
  fireEvent.mouseEnter(entry.parentElement!);
  expect(
    screen.getByRole("dialog", { name: /回响/ }).closest(".composer"),
  ).toBeNull();
  expect(screen.queryByText(invite.quote)).toBeNull();
  expect(understandingApi.review).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input());
  fireEvent.click(screen.getByRole("button", { name: /九月的团队分工/ }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "聊聊", exact: true })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(understandingApi.review).toHaveBeenCalledWith("INVITE", "r1", "read");
  expect(screen.getByRole("button", { name: /2 项待处理/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "聊聊", exact: true }));
  await screen.findByLabelText("回响话题");
  expect(screen.queryByText("从此刻在意的事，聊起。")).toBeNull();
  expect(screen.queryByRole("button", { name: "说说近况" })).toBeNull();
  expect(screen.queryByRole("button", { name: "一起拿主意" })).toBeNull();
  await waitFor(() => expect(input().value).toBe(""));
  expect(chat.send).not.toHaveBeenCalled();
  expect(localStorage.getItem("zhijun:draft:1:owned:existing")).toBe(
    "原对话的草稿",
  );
  fireEvent.click(screen.getByRole("button", { name: /返回原对话/ }));
  await waitFor(() => expect(input().value).toBe("原对话的草稿"));
  expect(screen.queryByLabelText("来自资料的交谈邀请")).toBeNull();
});

it("opens a candidate discussion without the new-conversation welcome and restores the original draft on return", async () => {
  const candidate: OntologyClaim = {
    id: "candidate",
    kind: "response",
    title: "愿意主动来往的关系",
    statement: "有内容可聊的关系，让我愿意主动来往。",
    conditions: "对方能给出建议时。",
    exceptions: "",
    state: "draft",
    source_kind: "inference",
    version: "v1",
    evidence_valid: true,
    reviewed_at: null,
    core_status: "pending",
    evidence: [],
  };
  const bound = { ...candidate, discussion_thread_id: "candidate-thread" };
  vi.spyOn(coreApi, "list").mockResolvedValue({
    revision: "core-r1",
    items: [candidate],
    total: 1,
    pending_count: 1,
    offset: 0,
    has_more: false,
  });
  vi.spyOn(ontologyApi, "get").mockResolvedValue({
    claims: [bound],
  } as never);
  vi.spyOn(coreApi, "conversation").mockResolvedValue({
    claim: bound,
    thread: {
      thread_id: "candidate-thread",
      session_key: "web:candidate-thread",
      channel_type: "web",
      title: candidate.title,
      created_at: 0,
      last_active: 0,
    },
  });
  render(<Conversation {...props()} />);
  await waitFor(() => expect(chat.load).toHaveBeenCalledWith("existing"));
  fireEvent.change(input(), { target: { value: "原对话尚未发出的草稿" } });
  const entry = await screen.findByRole("button", { name: /1 项待处理/ });
  fireEvent.mouseEnter(entry.parentElement!);
  fireEvent.click(screen.getByRole("button", { name: /愿意主动来往的关系/ }));
  fireEvent.click(screen.getByRole("button", { name: /聊聊这项理解/ }));
  await screen.findByLabelText("本体候选话题");
  expect(screen.queryByText("知君 · 听你说")).toBeNull();
  expect(screen.queryByText("从此刻在意的事，聊起。")).toBeNull();
  expect(screen.queryByRole("button", { name: "说说近况" })).toBeNull();
  expect(screen.queryByRole("button", { name: "一起拿主意" })).toBeNull();
  await waitFor(() =>
    expect(chat.load).toHaveBeenCalledWith("candidate-thread"),
  );
  expect(input().value).toBe("");
  expect(chat.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /返回原对话/ }));
  await waitFor(() => expect(input().value).toBe("原对话尚未发出的草稿"));
  expect(screen.queryByLabelText("本体候选话题")).toBeNull();
});

it("keeps the pocket browsable during drafting and recording, but blocks switching during recording", async () => {
  stored = { ...stored, invitations: [invite] };
  render(<Conversation {...props()} />);
  fireEvent.mouseEnter(
    (await screen.findByRole("button", { name: /1 项待处理/ })).parentElement!,
  );
  fireEvent.click(screen.getByRole("button", { name: /九月的团队分工/ }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "聊聊", exact: true })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.change(input(), { target: { value: "继续写草稿" } });
  fireEvent.click(screen.getByText("合成语音输入"));
  expect(screen.getByText(invite.question)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "聊聊", exact: true })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(understandingApi.conversation).not.toHaveBeenCalled();
});

it("does not navigate to a late conversation result after the owner chooses another thread", async () => {
  stored = { ...stored, invitations: [{ ...invite, read_at: "now" }] };
  let finish!: (
    value: Awaited<ReturnType<typeof understandingApi.conversation>>,
  ) => void;
  vi.mocked(understandingApi.conversation).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const p = props();
  const view = render(<Conversation {...p} />);
  fireEvent.mouseEnter(
    (await screen.findByRole("button", { name: /回响 · 知君小机器人/ }))
      .parentElement!,
  );
  fireEvent.click(screen.getByRole("button", { name: /九月的团队分工/ }));
  fireEvent.click(screen.getByRole("button", { name: "聊聊", exact: true }));
  view.rerender(
    <Conversation {...p} selectedThread={{ id: "other", key: 1 }} />,
  );
  await waitFor(() => expect(chat.load).toHaveBeenCalledWith("other"));
  stored = {
    ...stored,
    revision: "conversation",
    invitations: [
      {
        ...invite,
        status: "active",
        read_at: "now",
        discussion_thread_id: "reverb-thread",
      },
    ],
  };
  await act(async () =>
    finish({
      state: stored,
      thread: {
        thread_id: "reverb-thread",
        session_key: "web:existing",
        title: invite.title,
        channel_type: "web",
        created_at: 0,
        last_active: 0,
      },
    }),
  );
  expect(screen.queryByLabelText("回响话题")).toBeNull();
  expect(chat.load).not.toHaveBeenCalledWith("reverb-thread");
});

it("sends only the actual reply with the selected invitation and keeps a draft when its source becomes invalid", async () => {
  stored = {
    ...stored,
    invitations: [
      {
        ...invite,
        status: "active",
        read_at: "now",
        discussion_thread_id: "existing",
      },
    ],
  };
  render(<Conversation {...props()} />);
  await screen.findByLabelText("回响话题");
  fireEvent.change(input(), { target: { value: "我想补充真正的想法" } });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(chat.send).toHaveBeenCalledOnce());
  expect(chat.send.mock.calls[0][0]).toBe("我想补充真正的想法");
  expect(chat.send.mock.calls[0][14]).toBe("INVITE");
  fireEvent.change(input(), { target: { value: "另外的真实回复" } });
  stored = { ...stored, invitations: [{ ...invite, status: "invalid" }] };
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await screen.findByText(/资料邀请已变化，请核对后重新发送/);
  expect(chat.send).toHaveBeenCalledOnce();
  expect(input().value).toBe("另外的真实回复");
});

it("keeps WeChat reminders off unless both native care and the owner's connected channel allow them", async () => {
  const care: ProactiveCareConfig = {
    enabled: false,
    active_hours_start: "09:00",
    active_hours_end: "20:00",
    min_interval_hours: 4,
    max_interval_hours: 24,
  } as ProactiveCareConfig;
  vi.spyOn(agentApi, "getProactiveCareConfig").mockResolvedValue(care);
  vi.spyOn(agentApi, "updateProactiveCareConfig").mockImplementation(
    async (_id, value) => {
      vi.mocked(agentApi.getProactiveCareConfig).mockResolvedValue(
        value as ProactiveCareConfig,
      );
      return value as never;
    },
  );
  vi.spyOn(personalWeixinApi, "list").mockResolvedValue([
    {
      id: "wx",
      agent_id: "owned",
      kind: "weixin",
      name: "本人微信",
      enabled: true,
      runtime: { connected: true },
    },
  ]);
  render(<CareSettings agentId="owned" />);
  const checkbox = await screen.findByLabelText("在微信接收资料理解邀请");
  await screen.findByText("先开启主动关心，再选择微信提醒。");
  expect(checkbox).toHaveProperty("disabled", true);
  expect(checkbox).toHaveProperty("checked", false);
  expect(understandingApi.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("开启主动关心"));
  fireEvent.click(screen.getByText("保存主动关心设置"));
  await waitFor(() => expect(checkbox).toHaveProperty("disabled", false));
  fireEvent.click(checkbox);
  await screen.findByText("邀请设置已保存，并读取服务端核实。");
  expect(understandingApi.save).toHaveBeenCalledWith(
    expect.objectContaining({ weixin_reminders: true }),
  );
});
