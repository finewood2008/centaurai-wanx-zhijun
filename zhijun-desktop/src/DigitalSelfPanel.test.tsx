import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DigitalSelf } from "./DigitalSelfPanel";
import {
  digitalSelfApi as api,
  type SelfState,
  type SelfCard,
  type SelfHistory,
} from "./digitalSelfApi";

vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("./VoiceInput", () => ({
  VoiceInput: ({ onTranscript }: { onTranscript: (text: string) => void }) => (
    <button type="button" onClick={() => onTranscript("语音草稿")}>
      语音输入
    </button>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
const card: SelfCard = {
  id: "published",
  name: "合成专家",
  bio: "判断方法",
  topics: ["研究"],
  questions: ["怎么比较条件？"],
  works: ["我的方法"],
  updated_at: "2026-10-02T00:00:00Z",
  version: "pub1",
  online: true,
  access: "approval",
  access_status: "approved",
  model: "synthetic:model",
  model_local: true,
  owner_visible: true,
  contact_status: "none",
};
const history: SelfHistory = {
  revision: "h1",
  messages: [
    {
      id: "answer1",
      role: "assistant",
      text: "可以先看这个判断的前提。",
      at: "2026-10-02T00:00:00Z",
      publication_version: "pub1",
      sources: [],
      options: ["先说说我的条件"],
      request_id: "request",
    },
  ],
  memory: [],
  total: 1,
  has_more: false,
  pending_request: null,
  pending_text: "",
  pending_status: null,
};
const owner: SelfState = {
  id: "mine",
  revision: "r1",
  status: "unpublished",
  draft: {
    name: "合成专家",
    bio: "判断方法",
    topics: [],
    style: "简洁具体",
    boundaries: "不承诺",
    questions: [],
    entries: [
      {
        id: "method",
        title: "我的方法",
        text: "我希望先看前提",
        source: null,
        recognized: false,
      },
    ],
    access: "approval",
    visitor_daily_limit: 10,
    daily_limit: 100,
  },
  publication: null,
  visitors: [],
  usage: {},
  network_status: "contract_pending",
};
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(api, "discover").mockResolvedValue({
    items: [card],
    total: 1,
    has_more: false,
    unavailable_profiles: 0,
    network_status: "contract_pending",
  });
  vi.spyOn(api, "card").mockResolvedValue(card);
  vi.spyOn(api, "historyPage").mockResolvedValue(history);
  vi.spyOn(api, "me").mockResolvedValue(structuredClone(owner));
  vi.spyOn(api, "sources").mockResolvedValue({
    items: [],
    has_more: false,
    libraries: [],
  });
  vi.spyOn(api, "turn").mockResolvedValue(history);
  vi.spyOn(api, "update").mockImplementation(async (_rev, _action, draft) => ({
    ...owner,
    revision: "r2",
    draft: draft || owner.draft,
  }));
  vi.spyOn(api, "clear").mockResolvedValue({
    ...history,
    revision: "h2",
    messages: [],
    memory: [],
    pending_request: null,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function enter() {
  render(<DigitalSelf userId={2} />);
  fireEvent.click(await screen.findByRole("button", { name: "了解与交流" }));
  await screen.findByRole("textbox", { name: "对分身说的话" });
}
it("provides explicit pending cross-device state and never sends a recommended question", async () => {
  await enter();
  expect(screen.getByText(/跨设备发现与交流尚未开放/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "怎么比较条件？" }));
  expect(
    (
      screen.getByRole("textbox", {
        name: "对分身说的话",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("怎么比较条件？");
  expect(api.turn).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "发送" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("guided replies and voice remain editable drafts; sending needs owner visibility acknowledgment", async () => {
  await enter();
  fireEvent.click(screen.getByRole("button", { name: "先说说我的条件" }));
  fireEvent.change(screen.getByRole("textbox", { name: "对分身说的话" }), {
    target: { value: "我重新表达条件" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "我已了解，愿意开始交流" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(api.turn).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.turn).mock.calls[0][1]).toMatchObject({
    text: "我重新表达条件",
    assisted: true,
    acknowledge_owner_visibility: true,
    publication_version: "pub1",
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "对分身说的话",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(""),
  );
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  expect(
    (
      screen.getByRole("textbox", {
        name: "对分身说的话",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("语音草稿");
  expect(api.turn).toHaveBeenCalledTimes(1);
});
it("offline is unavailable, preserves typed draft and never submits", async () => {
  vi.mocked(api.card).mockResolvedValue({ ...card, online: false });
  await enter();
  fireEvent.change(screen.getByRole("textbox", { name: "对分身说的话" }), {
    target: { value: "等上线再说" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "我已了解，愿意开始交流" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(api.turn).not.toHaveBeenCalled();
  expect(screen.getByText("离线或暂停")).toBeTruthy();
});
it("requires explicit entry recognition and resets recognition after rewriting", async () => {
  render(<DigitalSelf userId={1} />);
  fireEvent.click(screen.getByRole("tab", { name: "我的分身" }));
  const publish = await screen.findByRole("button", { name: "确认发布" });
  expect((publish as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "我认可这项对外表述及其适用范围" }),
  );
  expect((publish as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("对外表述"), {
    target: { value: "新的适用条件" },
  });
  expect((publish as HTMLButtonElement).disabled).toBe(true);
  expect(api.update).not.toHaveBeenCalled();
});
it("requires rewriting an unverified ontology before owner recognition", async () => {
  const unverified = structuredClone(owner);
  unverified.draft.entries[0].source = {
    kind: "ontology",
    id: "node1",
    version: "v1",
    title: "待核对的理解",
    text: unverified.draft.entries[0].text,
    needs_review: true,
    total_chars: unverified.draft.entries[0].text.length,
    next_start: null,
  };
  vi.mocked(api.me).mockResolvedValue(unverified);
  render(<DigitalSelf userId={1} />);
  fireEvent.click(screen.getByRole("tab", { name: "我的分身" }));
  const recognition = await screen.findByRole("checkbox", {
    name: "我认可这项对外表述及其适用范围",
  });
  expect((recognition as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("对外表述"), {
    target: { value: "在合作分工这类事情上，我希望先说清前提。" },
  });
  expect((recognition as HTMLInputElement).disabled).toBe(false);
});
it("clearing is confirmed and synchronizes the returned empty state", async () => {
  await enter();
  fireEvent.click(
    screen.getByRole("button", {
      name: "删除：与合成专家分身的交谈和来往记忆",
    }),
  );
  expect(api.clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(api.clear).toHaveBeenCalledWith("published", "h1"),
  );
  await waitFor(() =>
    expect(screen.queryByText("可以先看这个判断的前提。")).toBeNull(),
  );
});
it("a lost request reads server state without resending and keeps the draft", async () => {
  await enter();
  vi.mocked(api.turn).mockRejectedValueOnce(new Error("连接中断"));
  vi.mocked(api.historyPage).mockResolvedValue({
    ...history,
    revision: "h2",
    pending_request: "pending",
    pending_text: "等结果",
    pending_status: "unknown",
  });
  fireEvent.change(screen.getByRole("textbox", { name: "对分身说的话" }), {
    target: { value: "等结果" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "我已了解，愿意开始交流" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText(/上一轮结果尚未恢复/);
  expect(api.turn).toHaveBeenCalledTimes(1);
  expect(
    (
      screen.getByRole("textbox", {
        name: "对分身说的话",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("等结果");
});
