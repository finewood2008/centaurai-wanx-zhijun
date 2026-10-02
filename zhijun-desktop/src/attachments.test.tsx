import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  renderHook,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttachmentSource, useAttachmentDraft } from "./attachments";
import * as uploadModule from "../../dashboard/src/api/modules/upload";
import { inboundPath, attachmentPath } from "./attachmentPaths";
import { request } from "../../dashboard/src/api/request";
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/api/request", () => ({ request: vi.fn() }));
vi.mock("../../dashboard/src/hooks/useServerUploadLimit", () => ({
  useServerUploadLimit: () => ({ maxUploadBytes: 1000000, maxUploadMb: 1 }),
}));
const source = {
  ok: true,
  path: "inbound/file.txt",
  filename: "file.txt",
  media_type: "text/plain",
  content: '<script>alert("example")</script> 合成正文',
  status: "ready",
  truncated: true,
  total_chars: 7000,
  stored_chars: 7000,
  has_more: true,
  offset: 0,
  limit: 6000,
};
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(request).mockResolvedValue(source);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("opens only registered inbound paths through the dedicated plaintext source endpoint and paginates", async () => {
  const { container } = render(
    <AttachmentSource agentId="owned" path="inbound/file.txt" />,
  );
  await screen.findByText(/<script>alert/);
  expect(container.querySelector("script")).toBeNull();
  expect(request).toHaveBeenCalledWith(
    "/agents/owned/upload/source?path=inbound%2Ffile.txt&offset=0&limit=6000",
  );
  expect(screen.getByText(/内容有截断/)).toBeTruthy();
  vi.mocked(request).mockResolvedValue({
    ...source,
    content: "后一段正文",
    offset: 6000,
    has_more: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "下一段" }));
  await screen.findByText("后一段正文");
  expect(request).toHaveBeenLastCalledWith(
    "/agents/owned/upload/source?path=inbound%2Ffile.txt&offset=6000&limit=6000",
  );
  expect(
    screen.getByRole("button", { name: "下一段" }).hasAttribute("disabled"),
  ).toBe(true);
});
it("shows real unsupported extraction and retryable read failures without pretending a body exists", async () => {
  vi.mocked(request).mockResolvedValue({
    ...source,
    ok: false,
    status: "unsupported",
    content: "",
    error: "此格式不能在本机读取",
    has_more: false,
  });
  render(<AttachmentSource agentId="owned" path="inbound/file.txt" />);
  await screen.findByText("暂不支持读取此格式 · text/plain");
  expect(screen.getByText("此格式不能在本机读取")).toBeTruthy();
  expect(screen.queryByText("正文已读取 · text/plain")).toBeNull();
  vi.mocked(request).mockRejectedValue(new Error("source unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await screen.findByText(/source unavailable/);
  expect(screen.queryByText(/合成正文/)).toBeNull();
});
it("rejects unsafe paths and mismatched readback instead of exposing another file", async () => {
  render(<AttachmentSource agentId="owned" path="inbound/../SOUL.md" />);
  await screen.findByText(/文件来源路径无效/);
  expect(request).not.toHaveBeenCalled();
  cleanup();
  vi.mocked(request).mockResolvedValue({
    ...source,
    path: "inbound/other.txt",
  });
  render(<AttachmentSource agentId="owned" path="inbound/file.txt" />);
  await screen.findByText(/读取结果与文件来源不一致/);
  expect(screen.queryByText(/合成正文/)).toBeNull();
});
it("extracts the inbound path from native history access URLs without following their origin", () => {
  expect(
    attachmentPath({
      kind: "file",
      url: "https://untrusted.example/api/agents/other/upload/source?path=inbound%2Ffile.txt",
    }),
  ).toBe("inbound/file.txt");
  expect(inboundPath("/inbound/file.txt")).toBe("inbound/file.txt");
  for (const path of [
    "inbound/",
    "inbound/../SOUL.md",
    "SOUL.md",
    "inbound/\\secret",
    "/etc/passwd",
  ])
    expect(inboundPath(path)).toBeNull();
});

it("keeps an attachment and its pending upload with the original thread while browsing another topic", async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof uploadModule.uploadFile>>,
  ) => void;
  vi.spyOn(uploadModule, "uploadFile").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender } = renderHook(
    ({ thread }) => useAttachmentDraft("owned", `owner:${thread}`),
    { initialProps: { thread: "original" } },
  );
  act(() =>
    result.current.add([
      new File(["hello"], "draft.txt", { type: "text/plain" }),
    ]),
  );
  expect(result.current.busy).toBe(true);
  rerender({ thread: "reverb" });
  expect(result.current.items).toHaveLength(0);
  await act(async () =>
    finish({
      filename: "draft.txt",
      path: "inbound/draft.txt",
      workspace_path: "inbound/draft.txt",
      media_type: "text/plain",
      url: "",
      access_url: "",
      extraction_status: "ready",
    }),
  );
  rerender({ thread: "original" });
  expect(result.current.ready[0].filename).toBe("draft.txt");
  expect(result.current.busy).toBe(false);
  act(() => result.current.clear());
  expect(result.current.items).toHaveLength(0);
});

it("does not restore an attachment or late upload across different profile owners", async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof uploadModule.uploadFile>>,
  ) => void;
  vi.spyOn(uploadModule, "uploadFile").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender } = renderHook(
    ({ agent }) => useAttachmentDraft(agent, `${agent}:original`),
    { initialProps: { agent: "one" } },
  );
  act(() => result.current.add([new File(["hello"], "private.txt")]));
  rerender({ agent: "two" });
  await act(async () =>
    finish({
      filename: "private.txt",
      path: "inbound/private.txt",
      workspace_path: "inbound/private.txt",
      media_type: "text/plain",
      url: "",
      access_url: "",
    }),
  );
  expect(result.current.items).toHaveLength(0);
});
