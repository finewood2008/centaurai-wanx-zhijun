import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CoreCandidates, useCoreCandidates } from "./CoreCandidates";
import {
  coreApi,
  ontologyApi,
  type OntologyClaim,
  type PersonalOntology,
} from "./ontology";
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
const c: OntologyClaim = {
  id: "c",
  version: "v1",
  kind: "principle",
  title: "方向与责任",
  statement: "重要方向由我决定，最终责任也由我承担。",
  conditions: "与 AI 协作",
  exceptions: "",
  state: "draft",
  core_status: "pending",
  evidence_valid: true,
  reviewed_at: null,
  evidence: [],
};
const doc: PersonalOntology = {
  revision: "r",
  claims: [c],
  generated_at: null,
  outdated: false,
  coverage: {
    read_atoms: 0,
    total_atoms: 0,
    eligible_sources: 0,
    independent_events: 0,
    has_more: false,
  },
};
function props() {
  return {
    queue: {
      scope: "test",
      page: {
        revision: "r",
        items: [c],
        total: 1,
        pending_count: 1,
        offset: 0,
        has_more: false,
      },
      error: "",
      refresh: vi.fn().mockResolvedValue(undefined),
      offset: 0,
      setOffset: vi.fn(),
    } as ReturnType<typeof useCoreCandidates>,
    selectedId: "c",
    onSelect: vi.fn(),
    onDiscuss: vi.fn().mockResolvedValue(true),
    onSource: vi.fn(),
    switchingDisabled: false,
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("reads back owner admission and exposes undo only after verified saving", async () => {
  const saved = {
    ...c,
    version: "v2",
    state: "confirmed" as const,
    core_status: "admitted" as const,
    admitted_version: "v2",
    admitted_at: "2026-10-02",
    admitted_by: 7,
  };
  const review = vi.spyOn(coreApi, "review").mockResolvedValue({
    status: "ready",
    ontology: { ...doc, claims: [saved] },
    changed_id: "c",
    previous_version: "v1",
  });
  vi.spyOn(ontologyApi, "get").mockResolvedValue({ ...doc, claims: [saved] });
  render(<CoreCandidates {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "确认加入本体" }));
  await screen.findByText("已加入本体");
  expect(screen.getByRole("button", { name: "撤销" })).toBeTruthy();
  expect(review).toHaveBeenCalledWith(
    "c",
    expect.objectContaining({ action: "admit", expected_version: "v1" }),
  );
});
it("editing a candidate never implicitly admits it", async () => {
  const saved = { ...c, version: "v2", statement: "我希望保留最终决定权" };
  const review = vi.spyOn(coreApi, "review").mockResolvedValue({
    status: "ready",
    ontology: { ...doc, claims: [saved] },
    changed_id: "c",
    previous_version: "v1",
  });
  vi.spyOn(ontologyApi, "get").mockResolvedValue({ ...doc, claims: [saved] });
  render(<CoreCandidates {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "改一下" }));
  fireEvent.change(screen.getByLabelText("候选表述"), {
    target: { value: saved.statement },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存改写" }));
  await screen.findByText("已保存改写，请确认最终表述后加入本体。");
  expect(review).toHaveBeenCalledOnce();
  expect(review).toHaveBeenCalledWith(
    "c",
    expect.objectContaining({ action: "edit_candidate" }),
  );
  expect(screen.getByRole("button", { name: "确认加入本体" })).toBeTruthy();
});
it("does not show success when the persisted version differs", async () => {
  vi.spyOn(coreApi, "review").mockResolvedValue({
    status: "ready",
    ontology: { ...doc, claims: [{ ...c, version: "v2" }] },
  });
  vi.spyOn(ontologyApi, "get").mockResolvedValue(doc);
  render(<CoreCandidates {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "确认加入本体" }));
  await screen.findByText("保存结果尚未核实，请重新读取。");
  expect(screen.queryByText("已加入本体")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "确认加入本体" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("allows browsing while streaming but blocks topic switching", async () => {
  const p = props();
  render(<CoreCandidates {...p} switchingDisabled />);
  await screen.findByRole("heading", { name: c.statement });
  expect(
    (screen.getByRole("button", { name: /聊聊这项理解/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(p.onDiscuss).not.toHaveBeenCalled();
});
it("ignores a late response from another account", async () => {
  let finish: (value: any) => void = () => {};
  vi.spyOn(coreApi, "list")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({
      revision: "new",
      items: [],
      total: 0,
      pending_count: 0,
      offset: 0,
      has_more: false,
    });
  function Probe({ scope }: { scope: string }) {
    const queue = useCoreCandidates(scope);
    return <div>{queue.page?.revision}</div>;
  }
  const ui = render(<Probe scope="old" />);
  ui.rerender(<Probe scope="new" />);
  await screen.findByText("new");
  finish({
    revision: "old",
    items: [c],
    total: 1,
    pending_count: 1,
    offset: 0,
    has_more: false,
  });
  await waitFor(() => expect(screen.queryByText("old")).toBeNull());
});

it.each([false, true])(
  "returns to a valid page when a refreshed queue shrinks to eight items (processed=%s)",
  async (processed) => {
    let total = 16;
    const items = Array.from({ length: 16 }, (_, i) => ({
      ...c,
      id: `candidate-${i}`,
      title: `待核对理解 ${i + 1}`,
    }));
    const list = vi
      .spyOn(coreApi, "list")
      .mockImplementation(async (offset = 0) => ({
        revision: `r-${total}`,
        items: items.slice(0, total).slice(offset, offset + 8),
        total,
        pending_count: processed ? 0 : total,
        offset,
        has_more: offset + 8 < total,
      }));
    function Probe() {
      const queue = useCoreCandidates("owned", processed);
      return <CoreCandidates {...props()} queue={queue} selectedId="" />;
    }
    render(<Probe />);
    await screen.findByRole("button", { name: /待核对理解 1 与/ });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("button", { name: /待核对理解 9 与/ });
    total = 8;
    act(() => window.dispatchEvent(new Event("zhijun-memory-changed")));
    await screen.findByRole("button", { name: /待核对理解 1 与/ });
    expect(screen.getAllByRole("button", { name: /待核对理解/ })).toHaveLength(
      8,
    );
    expect(
      screen.queryByText("新的长期理解会先留在这里，等你亲自确认。"),
    ).toBeNull();
    expect(list).toHaveBeenLastCalledWith(0, processed);
  },
);
