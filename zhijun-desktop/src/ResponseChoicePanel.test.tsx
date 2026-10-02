import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResponseChoicePanel } from "./ResponseChoicePanel";

afterEach(cleanup);
const props = () => ({
  invitation: {
    question: "这次你最想先聊哪个部分？",
    options: [
      { label: "眼下的研发", draft: "我想先聊眼下的研发。" },
      { label: "还不确定", draft: "我还不确定，慢慢说。" },
    ],
  },
  loading: false,
  error: "",
  onClose: vi.fn(),
  onRetry: vi.fn(),
  onDraft: vi.fn(),
});
it("preserves composer focus and offers only a draft, without a modal or separate input/send flow", () => {
  const callbacks = props();
  render(
    <>
      <textarea aria-label="我的输入框" />
    </>,
  );
  const input = screen.getByRole("textbox");
  input.focus();
  render(<ResponseChoicePanel {...callbacks} />);
  expect(document.activeElement).toBe(input);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /发送/ })).toBeNull();
  expect(callbacks.onDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "借用思路：眼下的研发" }));
  expect(callbacks.onDraft).toHaveBeenCalledWith("我想先聊眼下的研发。");
});
it("does not intercept ordinary typing or numeric keys and can be collapsed", () => {
  const callbacks = props();
  render(<ResponseChoicePanel {...callbacks} />);
  const panel = screen.getByRole("region", { name: "回应思路" });
  fireEvent.keyDown(panel, { key: "2" });
  fireEvent.keyDown(panel, { key: "Enter" });
  expect(callbacks.onDraft).not.toHaveBeenCalled();
  fireEvent.keyDown(panel, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "收起回应思路" }));
  expect(callbacks.onClose).toHaveBeenCalledTimes(2);
});
it("keeps loading and retry beside the composer, without suggested actions until ready", () => {
  const callbacks = props();
  const { rerender } = render(
    <ResponseChoicePanel {...callbacks} invitation={undefined} loading />,
  );
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /借用思路/ })).toBeNull();
  rerender(
    <ResponseChoicePanel
      {...callbacks}
      invitation={undefined}
      error="暂时未生成"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  expect(callbacks.onRetry).toHaveBeenCalledOnce();
});
