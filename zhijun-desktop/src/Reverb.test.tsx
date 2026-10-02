import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Reverb, REVERB_IDLE_MS, REVERB_COOLDOWN_MS } from "./Reverb";
import type { UnderstandingState } from "./understanding";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
const invitation = {
  id: "one",
  title: "团队分工",
  question: "当时你是怎么想的？",
  summary: "",
  quote: "原文内容",
  activation_phrase: "聊聊团队分工",
  source: {
    kb_id: "kb",
    document_id: "doc",
    filename: "记录.md",
    source_version: "v1",
    start: 0,
    end: 4,
  },
  status: "pending" as const,
  created_at: "2026-10-02T09:00:00Z",
};
const props = () => ({
  scope: "owner",
  state: { invitations: [invitation] } as UnderstandingState,
  busy: false,
  error: "",
  hidden: false,
  switchingDisabled: false,
  onReview: vi.fn(),
  onDiscuss: vi.fn(),
  onSource: vi.fn(),
  onRetry: vi.fn(),
});
it("counts available unfinished items even after reading, and excludes finished or withdrawn items", () => {
  const p = props();
  p.state.invitations.push(
    { ...invitation, id: "read", title: "已读问题", read_at: "now" },
    { ...invitation, id: "gone", source_available: false },
    { ...invitation, id: "done", title: "往日思考", status: "resolved" },
    { ...invitation, id: "no", status: "dismissed" },
  );
  render(<Reverb {...p} />);
  fireEvent.mouseEnter(
    screen.getByRole("button", { name: /2 项待处理/ }).parentElement!,
  );
  expect(p.onReview).not.toHaveBeenCalled();
  expect(screen.getByText("已交流 · 1 条")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /团队分工/ }));
  expect(p.onReview).toHaveBeenCalledWith("one", "read");
  expect(p.onDiscuss).not.toHaveBeenCalled();
  expect(screen.getByText(invitation.question)).toBeTruthy();
});

it("keeps remaining invitations visible when their list shrinks below the current page", () => {
  const p = props();
  p.state.invitations = Array.from({ length: 16 }, (_, i) => ({
    ...invitation,
    id: `invitation-${i}`,
    title: `资料问题 ${i + 1}`,
  }));
  const ui = render(<Reverb {...p} />);
  fireEvent.click(screen.getByRole("button", { name: /16 项待处理/ }));
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByText("第 2 页")).toBeTruthy();
  ui.rerender(
    <Reverb
      {...p}
      state={{ ...p.state, invitations: p.state.invitations.slice(0, 8) }}
    />,
  );
  expect(screen.getByRole("button", { name: /8 项待处理/ })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /资料问题/ })).toHaveLength(8);
  expect(screen.getByRole("button", { name: /资料问题 1 记录/ })).toBeTruthy();
});
it("pins a selected detail, closes with Escape, and clears it when the account changes", () => {
  const p = props();
  const view = render(<Reverb {...p} />);
  const trigger = screen.getByRole("button", { name: /1 项待处理/ });
  fireEvent.focus(trigger);
  fireEvent.click(screen.getByRole("button", { name: /团队分工/ }));
  const back = screen.getByRole("button", { name: /所有回响/ });
  back.focus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: /团队分工/ }));
  view.rerender(
    <Reverb
      {...p}
      scope="other"
      state={{ invitations: [] } as unknown as UnderstandingState}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("closes the floating detail only after a discussion opened successfully", async () => {
  const p = props();
  p.onDiscuss.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<Reverb {...p} />);
  fireEvent.click(screen.getByRole("button", { name: /1 项待处理/ }));
  fireEvent.click(screen.getByRole("button", { name: /团队分工/ }));
  fireEvent.click(screen.getByRole("button", { name: "聊聊", exact: true }));
  await waitFor(() => expect(p.onDiscuss).toHaveBeenCalledOnce());
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "聊聊", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

function idleClock() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
}
it("opens a specific question after foreground inactivity without stealing focus or marking it read", () => {
  idleClock();
  const p = props();
  render(
    <>
      <textarea aria-label="草稿" />
      <Reverb {...p} />
    </>,
  );
  const input = screen.getByLabelText("草稿");
  input.focus();
  act(() => vi.advanceTimersByTime(REVERB_IDLE_MS - 1));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText(invitation.question)).toBeTruthy();
  expect(document.activeElement).toBe(input);
  expect(p.onReview).not.toHaveBeenCalled();
  expect(p.onDiscuss).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "a" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("resets the idle countdown on activity, but repeated data refreshes do not restart it", () => {
  idleClock();
  const p = props();
  const view = render(<Reverb {...p} />);
  act(() => vi.advanceTimersByTime(40_000));
  fireEvent.pointerMove(document.body);
  act(() => vi.advanceTimersByTime(30_000));
  view.rerender(
    <Reverb
      {...p}
      state={{ ...p.state, invitations: [...p.state.invitations] }}
    />,
  );
  act(() => vi.advanceTimersByTime(29_999));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText(invitation.question)).toBeTruthy();
});
it.each(["idleBlocked", "switchingDisabled", "hidden"] as const)(
  "does not initiate a question while %s",
  (key) => {
    idleClock();
    render(<Reverb {...props()} {...{ [key]: true }} />);
    act(() => vi.advanceTimersByTime(2 * REVERB_IDLE_MS));
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);
it("waits for foreground focus and does not remind about a snoozed or current discussion", () => {
  idleClock();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const p = props();
  p.state.invitations.push({
    ...invitation,
    id: "later",
    status: "snoozed",
    snoozed_until: "2026-10-03T09:00:00Z",
  });
  const view = render(<Reverb {...p} />);
  act(() => vi.advanceTimersByTime(REVERB_IDLE_MS));
  expect(screen.queryByRole("dialog")).toBeNull();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  view.rerender(<Reverb {...p} activeInvitationId="one" />);
  fireEvent.focus(window);
  act(() => vi.advanceTimersByTime(REVERB_IDLE_MS));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: /1 项待处理/ })).toBeTruthy();
});
it("cools down after closing, moves to another question and never repeats the same one in this session", () => {
  idleClock();
  const p = props();
  p.state.invitations.push({
    ...invitation,
    id: "two",
    title: "另一个问题",
    question: "还有一件想问你。",
  });
  render(<Reverb {...p} />);
  act(() => vi.advanceTimersByTime(REVERB_IDLE_MS));
  expect(screen.getByText(invitation.question)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭回响" }));
  act(() => vi.advanceTimersByTime(REVERB_COOLDOWN_MS - 1));
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText("还有一件想问你。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭回响" }));
  act(() => vi.advanceTimersByTime(REVERB_COOLDOWN_MS));
  expect(screen.queryByRole("dialog")).toBeNull();
});
