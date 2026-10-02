import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OntologyMap } from "./OntologyMap";
import type { PersonalOntology } from "./ontology";
afterEach(cleanup);
it("limits dense radar categories, exposes the remainder, and supports keyboard selection", () => {
  const claims = Array.from({ length: 37 }, (_, i) => ({
    id: "c" + i,
    version: "v" + i,
    kind: "principle" as const,
    title: "这是一段很长但需要完整保留的个人理解 " + i,
    statement: "这是一段很长但需要完整保留的个人理解 " + i,
    conditions: "合作",
    exceptions: "",
    state: "confirmed" as const,
    core_status: "admitted" as const,
    admitted_by: 7,
    admitted_at: "today",
    admitted_version: "v" + i,
    importance: 1 as const,
    evidence_valid: true,
    reviewed_at: null,
    evidence: [],
  }));
  const doc = { revision: "r", claims } as PersonalOntology;
  const choose = vi.fn();
  const ui = render(<OntologyMap doc={doc} selected="" onSelect={choose} />);
  const radar = screen.getByRole("group", { name: "个人本体雷达图" });
  expect(within(radar).getAllByRole("button")).toHaveLength(2);
  fireEvent.keyDown(within(radar).getAllByRole("button")[0], { key: "Enter" });
  expect(choose).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: "价值与原则 · 37 项 ↗" }),
  );
  fireEvent.click(screen.getByRole("button", { name: claims[36].title }));
  expect(choose).toHaveBeenLastCalledWith("c36");
  ui.rerender(<OntologyMap doc={doc} selected="c36" onSelect={choose} />);
  expect(within(radar).getAllByRole("button")).toHaveLength(2);
  expect(
    within(radar)
      .getByRole("button", { name: "本人确认 " + claims[36].statement })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
