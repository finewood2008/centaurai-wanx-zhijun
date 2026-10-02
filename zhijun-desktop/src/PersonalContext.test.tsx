import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { PersonalContext } from "./PersonalContext";
import * as api from "./ontology";
import type { ContextNode, PersonalOntology } from "./ontology";

vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
const node: ContextNode = {
  id: "person:one",
  kind: "person",
  title: "林安",
  statement: "林安",
  version: "v1",
  state: "active",
  source_kind: "native",
  owner_edited: false,
  evidence_valid: true,
  conditions: "团队分工",
  time_scope: "",
  aliases: [],
  native_ids: ["one"],
  evidence: [
    {
      atom_id: "a1",
      event_id: "raw1",
      quote: "林安负责技术",
      timestamp: "2026-10-02T00:00:00Z",
    },
  ],
  history: [],
  changed: false,
  core: false,
  emotion: "",
  occurred_at: "",
  merged_into: "",
};
const doc: PersonalOntology = {
  revision: "r1",
  generated_at: null,
  outdated: false,
  coverage: {
    read_atoms: 1,
    total_atoms: 1,
    eligible_sources: 1,
    independent_events: 1,
    has_more: false,
  },
  claims: [],
  nodes: [node],
  links: [],
};
const source = vi.fn(),
  discuss = vi.fn();
function Fixture({ initial = doc }: { initial?: PersonalOntology }) {
  const [actual, setActual] = useState(initial),
    [selected, select] = useState(node.id);
  return (
    <PersonalContext
      doc={actual}
      selected={selected}
      onSelect={select}
      onChange={setActual}
      onSource={source}
      onDiscuss={discuss}
      onClaim={() => {}}
    />
  );
}
beforeEach(() => {
  source.mockReset();
  discuss.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("defaults evidence open, distinguishes native extraction, and opens original quotes", () => {
  render(<Fixture />);
  expect(
    screen.getByText("记忆资料 · 事实与来源").closest("details"),
  ).toHaveProperty("open", true);
  expect(screen.getByText("原生提炼 · 可查证")).toBeTruthy();
  fireEvent.click(screen.getByText("查看完整原话"));
  expect(source).toHaveBeenCalledWith({
    layer: "raw",
    id: "raw1",
    path: "/raw_events/raw1",
  });
  fireEvent.click(screen.getByText("与知君聊聊"));
  expect(discuss).toHaveBeenCalledWith(
    expect.stringContaining("/ontology/context/person:one"),
  );
});

it("saves by target version and accepts unrelated background document progress", async () => {
  const changed = {
    ...node,
    title: "林岸",
    statement: "林岸",
    version: "v2",
    source_kind: "self_report" as const,
    owner_edited: true,
  };
  const result = { ...doc, revision: "background-1", nodes: [changed] };
  const edit = vi
    .spyOn(api, "editContextNode")
    .mockResolvedValue({
      status: "ready",
      ontology: result,
      changed_id: node.id,
      previous_version: "v1",
    });
  vi.spyOn(api.ontologyApi, "get").mockResolvedValue({
    ...result,
    revision: "background-2",
  });
  render(<Fixture />);
  fireEvent.click(screen.getByText("修改当前表述"));
  fireEvent.change(screen.getByLabelText("当前表述"), {
    target: { value: "林岸" },
  });
  fireEvent.click(screen.getByText("保存当前表述"));
  await screen.findByText("已更新个人上下文，之后的交谈会使用当前表述。");
  expect(edit).toHaveBeenCalledWith(
    node.id,
    expect.objectContaining({ expected_version: "v1", statement: "林岸" }),
  );
  expect(
    screen.queryByText(
      "这项内容已有修改。你的文字仍保留，请查看当前内容后再保存。",
    ),
  ).toBeNull();
});

it("preserves draft on a real target conflict and requires checking the new version", async () => {
  vi.spyOn(api, "editContextNode").mockResolvedValue({
    status: "stale",
    ontology: {
      ...doc,
      revision: "r2",
      nodes: [{ ...node, version: "v2", statement: "已有修改" }],
    },
  });
  render(<Fixture />);
  fireEvent.click(screen.getByText("修改当前表述"));
  fireEvent.change(screen.getByLabelText("当前表述"), {
    target: { value: "我的新文字" },
  });
  fireEvent.click(screen.getByText("保存当前表述"));
  await screen.findByText(
    "这项内容已有修改。你的文字仍保留，请查看当前内容后再保存。",
  );
  expect((screen.getByLabelText("当前表述") as HTMLTextAreaElement).value).toBe(
    "我的新文字",
  );
  expect((screen.getByText("保存当前表述") as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByText("已核对当前内容，继续编辑"));
  expect((screen.getByText("保存当前表述") as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it("does not claim success or repeat an uncertain write before readback", async () => {
  const edit = vi
    .spyOn(api, "editContextNode")
    .mockRejectedValue(new Error("timeout"));
  vi.spyOn(api.ontologyApi, "get").mockResolvedValue(doc);
  render(<Fixture />);
  fireEvent.click(screen.getByText("修改当前表述"));
  fireEvent.click(screen.getByText("保存当前表述"));
  await screen.findByText(/结果尚未核实：timeout/);
  fireEvent.click(screen.getByText("保存当前表述"));
  expect(edit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("重新读取当前内容"));
  await screen.findByText("已重新读取，请核对当前内容。草稿仍保留。");
});

it("requires explicitly selecting both identities for a merge", async () => {
  const second = {
    ...node,
    id: "person:two",
    title: "林岸",
    statement: "林岸",
    version: "other-v1",
  };
  const edit = vi
    .spyOn(api, "editContextNode")
    .mockResolvedValue({ status: "ready", ontology: doc, changed_id: node.id });
  vi.spyOn(api.ontologyApi, "get").mockResolvedValue(doc);
  render(<Fixture initial={{ ...doc, nodes: [node, second] }} />);
  fireEvent.click(screen.getByText("与另一项合并"));
  expect(screen.queryByText("确认合并")).toBeNull();
  fireEvent.change(screen.getByLabelText("合并到另一项"), {
    target: { value: second.id },
  });
  fireEvent.click(screen.getByText("确认合并"));
  await waitFor(() =>
    expect(edit).toHaveBeenCalledWith(
      node.id,
      expect.objectContaining({
        action: "merge",
        expected_version: "v1",
        merge_target_version: "other-v1",
      }),
    ),
  );
});

it("hides stopped items from daily view and retains a history and restore entry", () => {
  render(
    <Fixture
      initial={{
        ...doc,
        nodes: [
          {
            ...node,
            state: "withdrawn",
            history: [
              {
                version: "old",
                at: "2026-10-02T00:00:00Z",
                reason: "disable",
                value: { statement: "林安" },
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("恢复此版本")).toBeTruthy();
  fireEvent.click(screen.getByText("查看当前"));
  expect(
    screen.getByText("这里暂时没有记录，可以从对话或一句补充开始。"),
  ).toBeTruthy();
});
