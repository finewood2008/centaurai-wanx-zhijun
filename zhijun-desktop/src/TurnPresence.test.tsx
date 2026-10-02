import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../dashboard/src/pages/Chat/hooks/sseHelpers";
import { TurnPresence, turnActivity } from "./TurnPresence";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const message = (partial: Partial<ChatMessage>): ChatMessage => ({
  id: "new",
  role: "assistant",
  content: "",
  timestamp: 1000,
  status: "streaming",
  ...partial,
});

it("describes actual current-turn events and never uses earlier tools or hidden reasoning as a reply", () => {
  const old = message({ toolData: { name: "memory_search" } });
  const user = message({
    id: "user",
    role: "user",
    content: "这次的问题",
    status: "done",
  });
  const thinking = message({
    contentBlocks: [{ type: "thinking", content: "内部思考" }],
  });
  expect(turnActivity([old, user]).phase).toBe("waiting");
  expect(turnActivity([old, user, thinking])).toMatchObject({
    phase: "thinking",
    hasReply: false,
  });
  expect(
    turnActivity([
      user,
      thinking,
      message({ toolData: { name: "zhijun_episode_get" } }),
    ]).phase,
  ).toBe("memory");
  expect(
    turnActivity([
      user,
      message({ toolData: { name: "zhijun_knowledge_get" } }),
    ]).phase,
  ).toBe("sources");
  expect(
    turnActivity([user, message({ toolData: { name: "another_tool" } })]).phase,
  ).toBe("working");
  expect(
    turnActivity([user, message({ content: "真正的回答" })]),
  ).toMatchObject({ phase: "replying", hasReply: true });
  expect(
    turnActivity([user, message({ content: "旧回答" })], true),
  ).toMatchObject({ phase: "waiting", hasReply: false });
});

it("leaves a pending user decision to the approval card instead of claiming continued thought", () => {
  expect(
    turnActivity([
      message({ hitlData: { status: "pending", action_requests: [] } }),
    ]).requiresDecision,
  ).toBe(true);
});

it("offers stopping after a long wait without inventing completed stages or automatically resending", () => {
  vi.useFakeTimers();
  const stop = vi.fn();
  const { rerender, unmount } = render(
    <TurnPresence
      phase="waiting"
      compact={false}
      preparing={false}
      onStop={stop}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("知君正在接话");
  expect(screen.queryByRole("button", { name: "先停止回答" })).toBeNull();
  act(() => {
    vi.advanceTimersByTime(45000);
  });
  expect(screen.getByText(/这次等待较久/)).toBeTruthy();
  expect(stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "先停止回答" }));
  expect(stop).toHaveBeenCalledTimes(1);
  rerender(
    <TurnPresence phase="replying" compact preparing={false} onStop={stop} />,
  );
  expect(screen.queryByText(/这次等待较久/)).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("知君正在回应");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps a resumed long wait honest and does not offer stopping during thread preparation", () => {
  vi.useFakeTimers();
  render(
    <TurnPresence
      phase="waiting"
      compact={false}
      preparing
      startedAt={Date.now() - 60000}
      onStop={vi.fn()}
    />,
  );
  expect(screen.getByText(/这次等待较久/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "先停止回答" })).toBeNull();
});
