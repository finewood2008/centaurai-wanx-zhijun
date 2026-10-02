import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MemoryMaintenanceAction,
  ArchivedMemories,
  ThreadDeletion,
} from "./MemoryMaintenance";
import { maintenanceApi, type MaintenanceRecord } from "./maintenance";
import { octopThreadsApi as threads } from "../../dashboard/src/api/modules/octopThreads";
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
const row: MaintenanceRecord = {
  kind: "atom",
  id: "atom1",
  title: "synthetic memory",
  content: "full original content",
  version: "v1",
  counts: { atoms: 1, candidates: 1 },
  archive_id: "archive1",
  at: "2026-10-02T00:00:00Z",
  status: "archived",
};
beforeEach(() => {
  vi.spyOn(maintenanceApi, "preview").mockResolvedValue(row);
  vi.spyOn(maintenanceApi, "write").mockResolvedValue(row);
  vi.spyOn(maintenanceApi, "list").mockResolvedValue({ items: [row] });
  vi.spyOn(maintenanceApi, "archive").mockResolvedValue({
    ...row,
    status: "restored",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function selectMemory() {
  render(<MemoryMaintenanceAction kind="atom" id="atom1" />);
  fireEvent.click(screen.getByRole("button", { name: "移出 / 删除" }));
  await screen.findByText(/涉及 1 条记忆/);
}
it("previews exact scope and archives only after the owner confirms", async () => {
  await selectMemory();
  expect(maintenanceApi.write).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "停止使用并移出：synthetic memory" }),
  );
  expect(maintenanceApi.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认停止使用并移出" }));
  await screen.findByText("已移出日常记忆");
  expect(maintenanceApi.write).toHaveBeenCalledWith(row, "archive");
});
it("does not claim success when readback is pending", async () => {
  vi.mocked(maintenanceApi.list).mockResolvedValue({
    items: [{ ...row, status: "prepared" }],
  });
  await selectMemory();
  fireEvent.click(
    screen.getByRole("button", { name: "停止使用并移出：synthetic memory" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认停止使用并移出" }));
  await screen.findByText(/服务端结果尚未读回/);
  expect(screen.queryByText("已移出日常记忆")).toBeNull();
  expect(maintenanceApi.write).toHaveBeenCalledOnce();
});
it("purge is separate and cancellation never writes", async () => {
  await selectMemory();
  fireEvent.click(
    screen.getByRole("button", { name: "彻底删除：synthetic memory" }),
  );
  await screen.findByText(/不能撤销/);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(maintenanceApi.write).not.toHaveBeenCalled();
});
it("shows archived original content and waits for restoration readback", async () => {
  render(<ArchivedMemories agentId="personal" />);
  await screen.findByText("synthetic memory");
  fireEvent.click(screen.getByText("查看移出的内容"));
  expect(screen.getByText("full original content")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "恢复：synthetic memory" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
  await screen.findByText(/恢复尚未核实/);
  expect(maintenanceApi.archive).toHaveBeenCalledOnce();
});
it("does not delete a currently streaming conversation", async () => {
  vi.spyOn(threads, "history").mockResolvedValue({
    thread_id: "t1",
    messages: [],
    turn_active: true,
  });
  const remove = vi.spyOn(threads, "delete").mockResolvedValue();
  render(
    <ThreadDeletion
      agentId="personal"
      id="t1"
      title="test"
      onDeleted={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "删除对话：test" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除对话" }));
  await screen.findByText(/正在进行/);
  expect(remove).not.toHaveBeenCalled();
});
it("leaves the current topic only after native deletion is verified", async () => {
  vi.spyOn(threads, "history")
    .mockResolvedValueOnce({ thread_id: "t1", messages: [] })
    .mockRejectedValueOnce(new Error("404 NOT_FOUND"));
  vi.spyOn(threads, "delete").mockResolvedValue();
  const changed = vi.fn();
  render(
    <ThreadDeletion
      agentId="personal"
      id="t1"
      title="test"
      onDeleted={changed}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "删除对话：test" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除对话" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(threads.delete).toHaveBeenCalledWith("personal", "t1");
});
