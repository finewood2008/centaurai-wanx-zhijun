import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KnowledgeLibrary, KnowledgeSource } from "./KnowledgeLibrary";
import { knowledgeBasesApi as knowledge } from "../../dashboard/src/api/modules/knowledgeBases";
import { understandingApi, type UnderstandingState } from "./understanding";
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
const capability = {
  backend: "onnx",
  usable: true,
  selected_model: "local-embedding",
  checks: {
    model_selected: true,
    model_downloaded: true,
    deps_available: true,
  },
  ocr: { backend: "onnx", usable: false },
};
const base = {
  id: "kb1",
  application_id: "zhijun",
  owner_user_id: 1,
  name: "阅读资料",
  shared: false,
  default_open: true,
};
const doc = (id: string, status = "ready") => ({
  id,
  kb_id: "kb1",
  filename: `${id}.txt`,
  status,
  byte_size: 100,
  has_original: true,
  error_message: "",
});
const understanding: UnderstandingState = {
  revision: "u1",
  enabled: false,
  weixin_reminders: false,
  libraries: [
    {
      kb_id: "kb1",
      name: "阅读资料",
      default_open: true,
      role: "mixed",
      selected: true,
    },
  ],
  model: { name: "test/local", local: true },
  progress: {
    status: "idle",
    documents_total: 0,
    documents_read: 0,
    characters_total: 0,
    characters_read: 0,
    pending_documents: 0,
    failed_documents: 0,
    last_error: null,
  },
  invitations: [],
};
beforeEach(() => {
  vi.spyOn(understandingApi, "get").mockResolvedValue(understanding);
  vi.spyOn(understandingApi, "save").mockResolvedValue({
    ...understanding,
    enabled: true,
    revision: "u2",
  });
  vi.spyOn(understandingApi, "run").mockResolvedValue({
    ...understanding,
    enabled: true,
    revision: "u3",
  });
  vi.spyOn(knowledge, "getCapability").mockResolvedValue(capability as never);
  vi.spyOn(knowledge, "list").mockResolvedValue([base] as never);
  vi.spyOn(knowledge, "personal").mockResolvedValue(base as never);
  vi.spyOn(knowledge, "get").mockResolvedValue(base as never);
  vi.spyOn(knowledge, "listDocuments").mockResolvedValue([]);
  vi.spyOn(understandingApi, "documents").mockImplementation(async (id) => {
    const items = await knowledge.listDocuments(id);
    return { items, total: items.length, has_more: false, next_cursor: null };
  });
  vi.spyOn(knowledge, "create").mockResolvedValue(base as never);
  vi.spyOn(knowledge, "previewDocument").mockResolvedValue({
    id: "ready",
    filename: "ready.txt",
    text: "合成资料正文",
  });
  vi.spyOn(knowledge, "reindexDocument").mockResolvedValue(
    doc("failed", "pending") as never,
  );
  vi.spyOn(knowledge, "uploadDocument").mockResolvedValue(
    doc("uploaded", "pending") as never,
  );
});

it("reads invitation source ranges by exact version and pages forward without using truncated previews", async () => {
  const text = vi.spyOn(understandingApi, "text").mockResolvedValue({
    kb_id: "kb1",
    document_id: "ready",
    filename: "ready.txt",
    source_version: "source-v1",
    text: "被引用的资料原文",
    start: 120,
    end: 6120,
    total_chars: 18000,
    has_more: true,
    status: "ready",
  });
  render(
    <KnowledgeSource
      kbId="kb1"
      docId="ready"
      sourceVersion="source-v1"
      start={120}
      end={140}
    />,
  );
  await screen.findByText("被引用的资料原文");
  expect(knowledge.previewDocument).not.toHaveBeenCalled();
  expect(knowledge.listDocuments).not.toHaveBeenCalled();
  text.mockResolvedValue({
    kb_id: "kb1",
    document_id: "ready",
    filename: "ready.txt",
    source_version: "source-v1",
    text: "下一段连续正文",
    start: 6120,
    end: 12120,
    total_chars: 18000,
    has_more: true,
    status: "ready",
  });
  fireEvent.click(screen.getByText("下一段正文"));
  await screen.findByText("下一段连续正文");
  expect(text).toHaveBeenLastCalledWith(
    expect.objectContaining({ source_version: "source-v1" }),
    6120,
    6000,
  );
});

it("does not show old source text or fake verified state when the document version changed", async () => {
  vi.spyOn(understandingApi, "text").mockResolvedValue({
    kb_id: "kb1",
    document_id: "ready",
    filename: "ready.txt",
    source_version: "source-v2",
    text: "",
    start: 120,
    end: 120,
    total_chars: 18000,
    has_more: false,
    status: "stale",
  });
  render(
    <KnowledgeSource
      kbId="kb1"
      docId="ready"
      sourceVersion="source-v1"
      start={120}
    />,
  );
  await screen.findByText(/资料正文或版本已变化/);
  expect(screen.queryByText(/来源版本已核验/)).toBeNull();
  expect(knowledge.previewDocument).not.toHaveBeenCalled();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const props = () => ({
  userId: 1,
  agentId: "own",
  onDiscuss: vi.fn(),
  onBack: vi.fn(),
  onSource: vi.fn(),
});
async function openLibrary() {
  await screen.findByRole("button", { name: "上传资料" });
}

it("starts material understanding inside the library only after the owner chooses to run", async () => {
  render(<KnowledgeLibrary {...props()} />);
  await screen.findByText("让知君，更理解你");
  await screen.findByText("test/local");
  expect(screen.queryByText("到用户画像，深入理解")).toBeNull();
  expect(understandingApi.save).not.toHaveBeenCalled();
  expect(understandingApi.run).not.toHaveBeenCalled();
  vi.mocked(understandingApi.get).mockResolvedValue({
    ...understanding,
    enabled: true,
    revision: "u3",
  });
  fireEvent.click(screen.getByText("开始深入理解"));
  await screen.findByText(/已开始深入理解/);
  expect(understandingApi.save).toHaveBeenCalledWith({
    revision: "u1",
    enabled: true,
    libraries: [{ kb_id: "kb1", role: "mixed", selected: true }],
  });
  expect(understandingApi.run).toHaveBeenCalledWith("u2");
});

it("ignores a late material understanding result after changing accounts", async () => {
  let finish!: (value: UnderstandingState) => void;
  vi.mocked(understandingApi.run).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<KnowledgeLibrary key="own" {...props()} />);
  fireEvent.click(await screen.findByText("开始深入理解"));
  await waitFor(() => expect(understandingApi.run).toHaveBeenCalledOnce());
  vi.mocked(understandingApi.get).mockResolvedValue({
    ...understanding,
    libraries: [],
  });
  vi.mocked(knowledge.personal).mockResolvedValue({
    ...base,
    id: "kb2",
    owner_user_id: 2,
  } as never);
  view.rerender(
    <KnowledgeLibrary
      key="another"
      {...props()}
      userId={2}
      agentId="another"
    />,
  );
  await act(async () => {
    finish({ ...understanding, enabled: true, revision: "u3" });
  });
  await screen.findByRole("button", { name: "上传资料" });
  expect(screen.queryByText(/已开始深入理解/)).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "阅读资料" })).toBeNull();
});

it("opens the account-bound archive automatically without create, select or delete-library controls", async () => {
  render(<KnowledgeLibrary {...props()} />);
  await openLibrary();
  expect(knowledge.personal).toHaveBeenCalled();
  expect(knowledge.create).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("资料库名称")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "选择资料库" })).toBeNull();
  expect(screen.queryByRole("button", { name: "删除资料库" })).toBeNull();
  expect(screen.getByText(/上传不代表已成为关于你的记忆/)).toBeTruthy();
});
it("shows unavailable local processing and never offers a remote fallback or fake ready state", async () => {
  vi.mocked(knowledge.getCapability).mockResolvedValue({
    ...capability,
    usable: false,
    checks: {
      model_selected: true,
      model_downloaded: false,
      deps_available: true,
    },
  } as never);
  render(<KnowledgeLibrary {...props()} />);
  await screen.findByText("本地资料检索尚未就绪");
  expect(screen.getByText("本地模型尚未下载")).toBeTruthy();
  await openLibrary();
  expect(
    screen.getByRole("button", { name: "上传资料" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByText("本地资料检索已就绪")).toBeNull();
  expect(knowledge.create).not.toHaveBeenCalled();
});
it("keeps native pending/processing/failed distinct and only drafts discussion after ready; reindex reads server truth", async () => {
  vi.mocked(knowledge.listDocuments).mockResolvedValue([
    doc("ready"),
    doc("pending", "pending"),
    doc("processing", "processing"),
    { ...doc("failed", "failed"), error_message: "local parse failed" },
  ] as never);
  const initial = props();
  render(<KnowledgeLibrary {...initial} />);
  await openLibrary();
  await screen.findByText("failed.txt");
  expect(screen.getByText(/等待整理/)).toBeTruthy();
  expect(screen.getByText(/本地整理中/)).toBeTruthy();
  expect(screen.getByText(/整理未完成/)).toBeTruthy();
  const discuss = screen.getAllByRole("button", { name: "围绕资料聊" });
  expect(discuss.map((button) => button.hasAttribute("disabled"))).toEqual([
    false,
    true,
    true,
    true,
  ]);
  fireEvent.click(discuss[0]);
  expect(initial.onDiscuss).toHaveBeenCalledWith(
    expect.stringContaining("「阅读资料」中的「ready.txt」"),
    { id: "kb1", name: "阅读资料" },
  );
  vi.mocked(knowledge.listDocuments).mockResolvedValue([
    doc("failed", "pending"),
  ] as never);
  fireEvent.click(screen.getByRole("button", { name: "重试整理" }));
  await waitFor(() =>
    expect(knowledge.reindexDocument).toHaveBeenCalledWith("kb1", "failed"),
  );
  await waitFor(() => expect(screen.queryByText(/可供检索/)).toBeNull());
  expect(
    screen.getByRole("button", { name: "围绕资料聊" }).hasAttribute("disabled"),
  ).toBe(true);
});
it("retains file failures for explicit retry and treats upload completion separately from indexing", async () => {
  vi.mocked(knowledge.uploadDocument).mockRejectedValueOnce(
    new Error("upload interrupted"),
  );
  render(<KnowledgeLibrary {...props()} />);
  await openLibrary();
  fireEvent.change(screen.getByLabelText("选择资料库文件"), {
    target: { files: [new File(["body"], "资料.txt")] },
  });
  await screen.findByText("上传未完成");
  expect(screen.queryByText(/已上传 · 整理状态/)).toBeNull();
  vi.mocked(knowledge.listDocuments).mockResolvedValue([
    doc("uploaded", "pending"),
  ] as never);
  fireEvent.click(screen.getByRole("button", { name: "重试上传 资料.txt" }));
  await screen.findByText(/已上传 · 整理状态/);
  await screen.findByText("uploaded.txt");
  expect(
    screen.getByRole("button", { name: "围绕资料聊" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(knowledge.uploadDocument).toHaveBeenCalledTimes(2);
});
it("does not carry pending upload results into a different account", async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof knowledge.uploadDocument>>,
  ) => void;
  vi.mocked(knowledge.uploadDocument).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<KnowledgeLibrary key="1" {...props()} />);
  await openLibrary();
  fireEvent.change(screen.getByLabelText("选择资料库文件"), {
    target: { files: [new File(["body"], "旧库.txt")] },
  });
  await screen.findByText("旧库.txt");
  vi.mocked(knowledge.personal).mockResolvedValue({
    ...base,
    id: "kb2",
    owner_user_id: 2,
  } as never);
  vi.mocked(knowledge.get).mockResolvedValue({
    ...base,
    id: "kb2",
    owner_user_id: 2,
  } as never);
  view.rerender(
    <KnowledgeLibrary key="2" {...props()} userId={2} agentId="another" />,
  );
  await openLibrary();
  await act(async () => finish(doc("old", "pending") as never));
  expect(screen.queryByText("旧库.txt")).toBeNull();
  expect(screen.queryByText(/已上传 · 整理状态/)).toBeNull();
});
it("does not fallback when a selected library disappears or source access fails", async () => {
  render(<KnowledgeLibrary {...props()} />);
  await openLibrary();
  vi.mocked(knowledge.personal).mockRejectedValue(
    new Error("账号资料库暂不可用"),
  );
  fireEvent.click(screen.getByRole("button", { name: "刷新资料库与处理状态" }));
  await screen.findByText(/账号资料库暂不可用/);
  expect(screen.queryByRole("button", { name: "上传资料" })).toBeNull();
  expect(knowledge.create).not.toHaveBeenCalled();
  cleanup();
  vi.mocked(knowledge.get).mockRejectedValue(new Error("knowledge not found"));
  render(<KnowledgeSource kbId="kb1" docId="ready" />);
  await screen.findByText(/knowledge not found/);
  expect(knowledge.previewDocument).not.toHaveBeenCalled();
});
it("opens the verified document as plaintext and keeps non-ready sources visible", async () => {
  vi.mocked(knowledge.listDocuments).mockResolvedValue([doc("ready")] as never);
  vi.mocked(knowledge.previewDocument).mockResolvedValue({
    id: "ready",
    filename: "ready.txt",
    text: '<img src=x onerror="danger()"> 原文',
  });
  const { container } = render(<KnowledgeSource kbId="kb1" docId="ready" />);
  await screen.findByText(/<img src=x/);
  expect(container.querySelector("img")).toBeNull();
  expect(knowledge.previewDocument).toHaveBeenCalledWith("kb1", "ready");
  cleanup();
  vi.mocked(knowledge.listDocuments).mockResolvedValue([
    doc("pending", "pending"),
  ] as never);
  vi.mocked(knowledge.previewDocument).mockClear();
  render(<KnowledgeSource kbId="kb1" docId="pending" />);
  await screen.findByText(/正文尚未整理完成/);
  expect(knowledge.previewDocument).not.toHaveBeenCalled();
});
it("rejects a mismatched application domain instead of listing WANX libraries", async () => {
  vi.mocked(knowledge.personal).mockResolvedValue({
    ...base,
    application_id: "wanx",
  } as never);
  render(<KnowledgeLibrary {...props()} />);
  await screen.findByText(/资料库归属未核实/);
  expect(screen.queryByRole("combobox", { name: "选择资料库" })).toBeNull();
});

it("refreshes shared model and policy on focus without losing the selected library or upload drafts", async () => {
  render(<KnowledgeLibrary {...props()} />);
  await openLibrary();
  vi.mocked(knowledge.uploadDocument).mockRejectedValueOnce(
    new Error("upload interrupted"),
  );
  fireEvent.change(screen.getByLabelText("选择资料库文件"), {
    target: { files: [new File(["body"], "留存.txt")] },
  });
  await screen.findByText("上传未完成");
  vi.mocked(knowledge.getCapability).mockResolvedValue({
    ...capability,
    selected_model: "new-platform-model",
    chunk_size: 1000,
    chunk_overlap: 200,
    retrieval_k: 3,
  } as never);
  fireEvent(window, new Event("focus"));
  await screen.findByText("new-platform-model");
  expect(screen.getByText(/分段 1000 字/)).toBeTruthy();
  expect(screen.getByText("上传未完成")).toBeTruthy();
  expect(screen.getByText("留存.txt")).toBeTruthy();
});

it("shows the platform disable state rather than keeping a stale ready state", async () => {
  render(<KnowledgeLibrary {...props()} />);
  await openLibrary();
  vi.mocked(knowledge.getCapability).mockResolvedValue({
    ...capability,
    feature_enabled: false,
    usable: false,
    ocr: { backend: "onnx", enabled: false, usable: false },
  } as never);
  fireEvent(window, new Event("focus"));
  await screen.findByText("万象尚未启用知识库");
  expect(screen.getByText("万象已关闭图片识字")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "上传资料" }).hasAttribute("disabled"),
  ).toBe(true);
});

it("shows reading progress without claiming a percentage of personal understanding", async () => {
  vi.mocked(understandingApi.get).mockResolvedValue({
    ...understanding,
    progress: {
      ...understanding.progress,
      status: "complete",
      documents_total: 7,
      documents_read: 7,
      characters_total: 10100,
      characters_read: 10100,
    },
  });
  render(<KnowledgeLibrary {...props()} />);
  await screen.findByText("正文已读");
  expect(screen.getByText("阅读进度，不等于对你的理解程度")).toBeTruthy();
  expect(screen.getByText("100")).toBeTruthy();
});
