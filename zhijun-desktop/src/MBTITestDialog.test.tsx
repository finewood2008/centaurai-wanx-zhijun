import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mbtiApi } from "../../dashboard/src/api/modules/mbti";
import type {
  MBTITestQuestion,
  MBTITestResult,
} from "../../dashboard/src/api/types/mbti";
import { MBTITestDialog } from "./MBTITestDialog";
import { DialogueStyle } from "./DialogueStyle";

const questions = ["ei", "sn", "tf", "jp"].map((dimension, i) => ({
  id: i + 1,
  dimension,
  question_zh: `问题 ${i + 1}`,
  option_a_zh: `选择 A ${i + 1}`,
  option_b_zh: `选择 B ${i + 1}`,
})) as MBTITestQuestion[];
const result = {
  code: "INFJ",
  applied: false,
  profile: {
    code: "INFJ",
    name_zh: "提倡者",
    summary_zh: "温和地理解，也认真地思考。",
    behavior: {
      answer_style_zh: "回答方式",
      casual_chat_zh: "交谈方式",
      emotion_zh: "情绪回应",
    },
  },
  dimensions: { ei: ["I", 85], sn: ["N", 85], tf: ["F", 85], jp: ["J", 85] },
} as MBTITestResult;
const apply = vi.fn(async () => true);
const refresh = vi.fn();
function Harness({
  disabled = false,
  applying = false,
  parentEscape = vi.fn(),
} = {}) {
  const [open, setOpen] = useState(true);
  return (
    <div onKeyDown={parentEscape}>
      <button onClick={() => setOpen(true)}>重新打开</button>
      <MBTITestDialog
        open={open}
        agentId="my-zhijun"
        current=""
        applying={applying}
        disabled={disabled}
        onClose={() => setOpen(false)}
        onApply={apply}
        applyError=""
        onRefreshStyle={refresh}
      />
    </div>
  );
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    writable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    writable: true,
    value: function () {
      this.removeAttribute("open");
    },
  });
  vi.spyOn(mbtiApi, "getMBTITestQuestions").mockResolvedValue(questions);
  vi.spyOn(mbtiApi, "submitMBTITest").mockResolvedValue(result);
  apply.mockClear();
  refresh.mockClear();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function start() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "开始测试" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "开始测试" }));
}
async function finish() {
  await start();
  for (let i = 1; i <= 4; i++) {
    fireEvent.click(screen.getByRole("button", { name: `A 选择 A ${i}` }));
    fireEvent.click(
      screen.getByRole("button", { name: i === 4 ? "查看结果" : "下一题" }),
    );
  }
  await screen.findByText("按这次作答，你更接近");
}
it("reads the native profile-scoped questionnaire, scores only, then waits for explicit apply", async () => {
  localStorage.setItem("octop.pendingChatMessage", "原来的草稿");
  render(<Harness />);
  await finish();
  expect(mbtiApi.getMBTITestQuestions).toHaveBeenCalledWith("my-zhijun");
  expect(mbtiApi.submitMBTITest).toHaveBeenCalledWith(
    { "1": "A", "2": "A", "3": "A", "4": "A" },
    false,
    "zh",
    "my-zhijun",
  );
  expect(apply).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "提倡者" }),
  );
  expect(localStorage.getItem("octop.pendingChatMessage")).toBe("原来的草稿");
  fireEvent.click(screen.getByRole("button", { name: "应用到知君的对话风格" }));
  expect(apply).toHaveBeenCalledWith("INFJ");
});
it("preserves answers across closing, revisiting, and editing without changing a chat draft", async () => {
  render(<Harness />);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "A 选择 A 1" }));
  fireEvent.click(screen.getByRole("button", { name: "下一题" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭 MBTI 测试" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新打开" }));
  expect(screen.getByRole("heading", { name: "问题 2" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "上一题" }));
  expect(
    screen
      .getByRole("button", { name: "A 选择 A 1" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "B 选择 B 1" }));
  expect(
    screen
      .getByRole("button", { name: "B 选择 B 1" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(mbtiApi.getMBTITestQuestions).toHaveBeenCalledTimes(1);
});
it("returns to the first unanswered question instead of submitting a partial test", async () => {
  render(<Harness />);
  await start();
  fireEvent.click(screen.getByRole("button", { name: "第 4 题，未作答" }));
  fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
  expect(screen.getByRole("alert").textContent).toContain("还有 4 题未作答");
  expect(screen.getByRole("heading", { name: "问题 1" })).toBeTruthy();
  expect(mbtiApi.submitMBTITest).not.toHaveBeenCalled();
});
it("can retry loading and scoring without losing answers", async () => {
  vi.mocked(mbtiApi.getMBTITestQuestions).mockRejectedValueOnce(
    new Error("暂时无法读取"),
  );
  vi.mocked(mbtiApi.submitMBTITest).mockRejectedValueOnce(
    new Error("暂时无法计分"),
  );
  render(<Harness />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "重新读取题目" }));
  await start();
  for (let i = 1; i <= 4; i++) {
    fireEvent.click(screen.getByRole("button", { name: `A 选择 A ${i}` }));
    fireEvent.click(
      screen.getByRole("button", { name: i === 4 ? "查看结果" : "下一题" }),
    );
  }
  await screen.findByText("暂时无法计分");
  expect(
    screen
      .getByRole("button", { name: "A 选择 A 4" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
  await screen.findByText("按这次作答，你更接近");
  expect(mbtiApi.submitMBTITest).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "重新测试" }));
  await start();
  expect(screen.getByText("已答 0 题")).toBeTruthy();
});
it("keeps the parent drawer open on Escape and blocks dismissal during an apply", async () => {
  const parentEscape = vi.fn();
  const view = render(<Harness parentEscape={parentEscape} />);
  await start();
  const dialog = screen.getByRole("dialog");
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(parentEscape).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<Harness applying />);
  fireEvent.click(screen.getByRole("button", { name: "重新打开" }));
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "关闭 MBTI 测试",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("allows testing during a conversation, but waits to apply until the turn ends", async () => {
  render(<Harness disabled />);
  await finish();
  expect(
    (
      screen.getByRole("button", {
        name: "应用到知君的对话风格",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(apply).not.toHaveBeenCalled();
});
it("applies the result through the native style API and confirms readback, keeping the result on failure", async () => {
  vi.spyOn(mbtiApi, "listMBTITypes").mockResolvedValue([result.profile]);
  const current = vi
    .spyOn(mbtiApi, "getCurrentMBTI")
    .mockResolvedValue({ code: "", configured: false });
  const nativeApply = vi
    .spyOn(mbtiApi, "applyMBTIType")
    .mockRejectedValueOnce(new Error("知君正在回应"))
    .mockResolvedValue({ success: true, code: "INFJ", message: "" });
  render(
    <DialogueStyle agentId="my-zhijun">
      <input aria-label="原来的搜索" defaultValue="旅行" />
    </DialogueStyle>,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择对话风格" }));
  await screen.findByRole("button", { name: "预览 INFJ · 提倡者" });
  fireEvent.click(screen.getByRole("button", { name: /做一次 MBTI 测试/ }));
  await finish();
  expect(nativeApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "应用到知君的对话风格" }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByText("知君正在回应");
  expect(within(dialog).queryByText(/知君正在使用/)).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "重新读取风格" }));
  await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
  current.mockResolvedValue({ code: "INFJ", configured: true });
  fireEvent.click(screen.getByRole("button", { name: "应用到知君的对话风格" }));
  await within(dialog).findByText("知君正在使用 INFJ · 提倡者 风格。");
  expect(nativeApply).toHaveBeenLastCalledWith("INFJ", "zh", "my-zhijun");
  fireEvent.click(screen.getByRole("button", { name: "关闭 MBTI 测试" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /做一次 MBTI 测试/ }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "← 返回对话" }));
  expect((screen.getByLabelText("原来的搜索") as HTMLInputElement).value).toBe(
    "旅行",
  );
});
it("drops a late read from an unmounted profile", async () => {
  let resolve!: (value: MBTITestQuestion[]) => void;
  vi.mocked(mbtiApi.getMBTITestQuestions).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const view = render(<Harness />);
  view.unmount();
  await act(async () => resolve(questions));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mbtiApi.submitMBTITest).not.toHaveBeenCalled();
});
