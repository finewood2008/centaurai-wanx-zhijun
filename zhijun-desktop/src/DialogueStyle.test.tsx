import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mbtiApi } from "../../dashboard/src/api/modules/mbti";
import type { MBTIType } from "../../dashboard/src/api/types/mbti";
import { DialogueStyle } from "./DialogueStyle";

const catalog = ["INFJ", "ESTJ"].map((code) => ({
  code,
  name_zh: code === "INFJ" ? "提倡者" : "总经理",
  descriptors_zh: code === "INFJ" ? "理想主义、洞察力" : "务实、直接",
  behavior: {
    answer_style_zh: `${code} 回答方式`,
    casual_chat_zh: `${code} 交谈方式`,
    emotion_zh: `${code} 情绪回应`,
  },
})) as MBTIType[];
beforeEach(() => {
  vi.spyOn(mbtiApi, "listMBTITypes").mockResolvedValue(catalog);
  vi.spyOn(mbtiApi, "getCurrentMBTI").mockResolvedValue({
    code: "",
    configured: false,
  });
  vi.spyOn(mbtiApi, "applyMBTIType").mockResolvedValue({
    success: true,
    code: "INFJ",
    message: "",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function open() {
  render(
    <DialogueStyle agentId="my-zhijun">
      <input aria-label="保留的搜索" defaultValue="原来的内容" />
    </DialogueStyle>,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择对话风格" }));
}
it("previews native behavior without applying and preserves the underlying view", async () => {
  open();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "← 返回对话" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "预览 INFJ · 提倡者" }),
  );
  expect(screen.getByText("INFJ 回答方式")).toBeTruthy();
  expect(mbtiApi.applyMBTIType).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "← 返回对话" }));
  expect((screen.getByLabelText("保留的搜索") as HTMLInputElement).value).toBe(
    "原来的内容",
  );
  expect(mbtiApi.listMBTITypes).toHaveBeenCalledWith("my-zhijun");
  expect(mbtiApi.getCurrentMBTI).toHaveBeenCalledWith("my-zhijun");
});
it("confirms persisted selection from the exact profile before reporting success", async () => {
  open();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览 ESTJ · 总经理" }),
  );
  vi.mocked(mbtiApi.getCurrentMBTI).mockResolvedValue({
    code: "ESTJ",
    configured: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "使用这种风格" }));
  await screen.findByText("已换成 ESTJ · 总经理，从下一次回答开始。");
  expect(mbtiApi.applyMBTIType).toHaveBeenCalledWith("ESTJ", "zh", "my-zhijun");
  expect(mbtiApi.getCurrentMBTI).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "← 返回对话" }));
  expect(screen.getByText("ESTJ · 总经理")).toBeTruthy();
});
it("restores natural style through the same native API and readback", async () => {
  vi.mocked(mbtiApi.getCurrentMBTI).mockResolvedValue({
    code: "INFJ",
    configured: true,
  });
  open();
  fireEvent.click(await screen.findByRole("button", { name: /自然/ }));
  vi.mocked(mbtiApi.getCurrentMBTI).mockResolvedValue({
    code: "",
    configured: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "恢复自然风格" }));
  await screen.findByText("已恢复自然风格，从下一次回答开始。");
  expect(mbtiApi.applyMBTIType).toHaveBeenCalledWith(
    "_default",
    "zh",
    "my-zhijun",
  );
});
it("shows unavailable state instead of inventing a natural default and retries reads", async () => {
  vi.mocked(mbtiApi.getCurrentMBTI).mockRejectedValueOnce(
    new Error("暂时离线"),
  );
  open();
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: /预览 INFJ/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await screen.findByRole("button", { name: "预览 INFJ · 提倡者" });
  expect(mbtiApi.applyMBTIType).not.toHaveBeenCalled();
});
it("does not claim success when save fails or readback disagrees", async () => {
  open();
  fireEvent.click(
    await screen.findByRole("button", { name: "预览 INFJ · 提倡者" }),
  );
  vi.mocked(mbtiApi.applyMBTIType).mockRejectedValueOnce(
    new Error("知君正在回应"),
  );
  fireEvent.click(screen.getByRole("button", { name: "使用这种风格" }));
  await screen.findByText("知君正在回应");
  expect(screen.queryByText(/已换成/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "预览 INFJ · 提倡者" }));
  fireEvent.click(screen.getByRole("button", { name: "使用这种风格" }));
  await screen.findByText("暂时无法确认保存结果，请重新读取后再试。");
  expect(screen.queryByText(/已换成/)).toBeNull();
});
it("allows reading styles during a turn but prevents apply", async () => {
  render(
    <DialogueStyle agentId="my-zhijun" disabled>
      <p>原来的对话</p>
    </DialogueStyle>,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择对话风格" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "预览 INFJ · 提倡者" }),
  );
  const apply = screen.getByRole("button", {
    name: "使用这种风格",
  }) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  fireEvent.click(apply);
  expect(mbtiApi.applyMBTIType).not.toHaveBeenCalled();
});
it("keeps an in-flight save attached to its original profile after navigating away", async () => {
  let finish!: (result: {
    success: boolean;
    code: string;
    message: string;
  }) => void;
  vi.mocked(mbtiApi.applyMBTIType).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(
    <DialogueStyle key="first" agentId="first">
      <p>原对话</p>
    </DialogueStyle>,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择对话风格" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "预览 INFJ · 提倡者" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "使用这种风格" }));
  rerender(
    <DialogueStyle key="second" agentId="second">
      <p>第二个档案</p>
    </DialogueStyle>,
  );
  await act(async () => finish({ success: true, code: "INFJ", message: "" }));
  await waitFor(() =>
    expect(mbtiApi.getCurrentMBTI).toHaveBeenCalledWith("second"),
  );
  expect(mbtiApi.applyMBTIType).toHaveBeenCalledOnce();
  expect(mbtiApi.applyMBTIType).toHaveBeenCalledWith("INFJ", "zh", "first");
  expect(screen.queryByText(/已换成/)).toBeNull();
});
