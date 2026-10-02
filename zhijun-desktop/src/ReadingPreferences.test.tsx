import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Preferences } from "./MemoryViews";
import {
  ReadingPreferences,
  applyReadingSize,
  readReadingSize,
} from "./ReadingPreferences";

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--reading-size");
});

it("changes reading size immediately, remembers it and leaves the conversation draft intact", () => {
  localStorage.setItem("zhijun:draft:synthetic", "还没有发出的草稿");
  const first = render(<ReadingPreferences />);
  fireEvent.click(screen.getByRole("button", { name: "较大" }));
  expect(
    document.documentElement.style.getPropertyValue("--reading-size"),
  ).toBe("19px");
  expect(readReadingSize()).toBe(19);
  expect(localStorage.getItem("zhijun:draft:synthetic")).toBe(
    "还没有发出的草稿",
  );
  first.unmount();
  render(<ReadingPreferences />);
  expect(
    screen.getByRole("button", { name: "较大" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByLabelText("字号预览").style.fontSize).toBe("19px");
});

it("uses a saved reading size and rejects an unsupported value", () => {
  localStorage.setItem("zhijun:reading-size", "21");
  applyReadingSize(readReadingSize());
  expect(
    document.documentElement.style.getPropertyValue("--reading-size"),
  ).toBe("21px");
  localStorage.setItem("zhijun:reading-size", "1000");
  expect(readReadingSize()).toBe(17);
});

it("provides the reading control directly in settings without requiring account or model changes", () => {
  render(
    <Preferences
      agent={{ agent_id: "synthetic" } as never}
      user={{ username: "synthetic" } as never}
      logout={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "阅读与显示" }));
  fireEvent.click(screen.getByRole("button", { name: "特大" }));
  expect(readReadingSize()).toBe(21);
  expect(screen.getByLabelText("字号预览").style.fontSize).toBe("21px");
  fireEvent.click(screen.getByRole("button", { name: "标准" }));
  expect(readReadingSize()).toBe(17);
});
