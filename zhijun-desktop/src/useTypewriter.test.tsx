import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { replyGraphemes, useTypewriter } from "./useTypewriter";
let reduced = false;
let onChange: (() => void) | null;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  onChange = null;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_event: string, callback: () => void) => {
      onChange = callback;
    },
    removeEventListener: () => {
      onChange = null;
    },
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const initial = { id: "new", text: "A👩‍💻B", streaming: true, eligible: true };
it("reveals graphemes without tearing joined emoji, combining marks or surrogate pairs", () => {
  expect(replyGraphemes("e\u0301👨‍👩‍👧‍👦🇨🇳\ud83d")).toEqual(["e\u0301", "👨‍👩‍👧‍👦", "🇨🇳"]);
  const { result, rerender } = renderHook((props) => useTypewriter(props), {
    initialProps: initial,
  });
  expect(result.current.displayedText).toBe("");
  act(() => {
    vi.advanceTimersByTime(24);
  });
  expect(result.current.displayedText).toBe("A");
  act(() => {
    vi.advanceTimersByTime(24);
  });
  expect(result.current.displayedText).toBe("A👩‍💻");
  rerender({ ...initial, streaming: false });
  act(() => {
    vi.advanceTimersByTime(24);
  });
  expect(result.current.displayedText).toBe(initial.text);
  expect(result.current.isRevealing).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it("never replays a reply first loaded from history or a reconnected live stream", () => {
  const { result, rerender } = renderHook((props) => useTypewriter(props), {
    initialProps: { ...initial, streaming: false, eligible: false },
  });
  expect(result.current.displayedText).toBe(initial.text);
  rerender({ ...initial, text: "历史后续内容" });
  expect(result.current.displayedText).toBe("历史后续内容");
  rerender({ ...initial, id: "reconnect", eligible: false });
  expect(result.current.displayedText).toBe(initial.text);
  rerender({ ...initial, id: "reconnect", text: `${initial.text}C` });
  expect(result.current.displayedText).toBe(`${initial.text}C`);
  expect(vi.getTimerCount()).toBe(0);
});
it("respects reduced motion initially and when the preference changes, without replaying on re-enable", () => {
  reduced = true;
  const { result, rerender } = renderHook((props) => useTypewriter(props), {
    initialProps: initial,
  });
  expect(result.current.displayedText).toBe(initial.text);
  act(() => {
    reduced = false;
    onChange?.();
  });
  expect(result.current.displayedText).toBe(initial.text);
  rerender({ ...initial, id: "second" });
  expect(result.current.displayedText).toBe("");
  act(() => {
    reduced = true;
    onChange?.();
  });
  expect(result.current.displayedText).toBe(initial.text);
  expect(vi.getTimerCount()).toBe(0);
});
it("animates an eligible short reply first observed as done after batched tokens", () => {
  const { result } = renderHook((props) => useTypewriter(props), {
    initialProps: { ...initial, streaming: false },
  });
  expect(result.current.displayedText).toBe("");
  act(() => {
    vi.advanceTimersByTime(24);
  });
  expect(result.current.displayedText).toBe("A");
  act(() => {
    vi.advanceTimersByTime(48);
  });
  expect(result.current.displayedText).toBe(initial.text);
  expect(vi.getTimerCount()).toBe(0);
});
it("can show all immediately and keeps subsequent chunks visible", () => {
  const { result, rerender } = renderHook((props) => useTypewriter(props), {
    initialProps: initial,
  });
  act(() => {
    result.current.revealAll();
  });
  expect(result.current.displayedText).toBe(initial.text);
  rerender({ ...initial, text: `${initial.text}后来` });
  expect(result.current.displayedText).toBe(`${initial.text}后来`);
  expect(result.current.isRevealing).toBe(false);
});
it("accelerates a backlog and reveals while token chunks arrive faster than the clock", () => {
  const { result, rerender } = renderHook((props) => useTypewriter(props), {
    initialProps: { ...initial, text: "字".repeat(1000) },
  });
  act(() => {
    vi.advanceTimersByTime(24);
  });
  expect(replyGraphemes(result.current.displayedText).length).toBeGreaterThan(
    30,
  );
  rerender({ ...initial, id: "fast", text: "开始" });
  for (let i = 0; i < 12; i++) {
    act(() => {
      vi.advanceTimersByTime(10);
    });
    rerender({ ...initial, id: "fast", text: `开始${"字".repeat(i + 1)}` });
  }
  expect(result.current.displayedText.length).toBeGreaterThan(0);
});
it("does not rewind a rewritten response, and a new reply starts independently", () => {
  const { result, rerender } = renderHook((props) => useTypewriter(props), {
    initialProps: initial,
  });
  act(() => {
    vi.advanceTimersByTime(24);
  });
  rerender({ ...initial, text: "服务端恢复的正文" });
  expect(result.current.displayedText).toBe("服务端恢复的正文");
  expect(vi.getTimerCount()).toBe(0);
  rerender({ ...initial, id: "second" });
  expect(result.current.displayedText).toBe("");
});
it("finishes a long completed answer within 240ms without delaying new streamed chunks", () => {
  const text = "知君".repeat(500);
  const { result, rerender } = renderHook((props) => useTypewriter(props), {
    initialProps: { ...initial, text },
  });
  act(() => {
    vi.advanceTimersByTime(24);
  });
  expect(result.current.displayedText.length).toBeGreaterThan(100);
  rerender({ ...initial, text, streaming: false });
  act(() => {
    vi.advanceTimersByTime(240);
  });
  expect(result.current.displayedText).toBe(text);
  expect(result.current.isRevealing).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
