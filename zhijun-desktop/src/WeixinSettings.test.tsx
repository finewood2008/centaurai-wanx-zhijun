import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WeixinSettings } from "./WeixinSettings";
import { personalWeixinApi as api } from "../../dashboard/src/api/modules/personalWeixin";
import { notificationApi } from "./notifications";
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
beforeEach(() => {
  vi.spyOn(api, "list").mockResolvedValue([]);
  vi.spyOn(notificationApi, "list").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("only generates a QR after explicit action and verifies the persisted profile", async () => {
  vi.spyOn(api, "generate").mockResolvedValue({
    qrcode_token: "nonce",
    qrcode_url: "https://weixin.qq.com/qr",
  });
  vi.spyOn(api, "poll").mockResolvedValue({
    status: "success",
    channel_id: "channel",
  });
  render(<WeixinSettings agentId="own" />);
  await screen.findByText("尚未连接微信。扫码确认后才会绑定。");
  expect(api.generate).not.toHaveBeenCalled();
  vi.mocked(api.list).mockResolvedValue([
    {
      id: "channel",
      agent_id: "own",
      kind: "weixin",
      name: "知君微信",
      enabled: true,
      runtime: { connected: false, detail: "runtime unavailable" },
    },
  ]);
  fireEvent.click(screen.getByText("连接微信"));
  await screen.findByText("微信绑定已保存。连接运行后可在微信中交谈。");
  await screen.findByText("已保存 · 通道暂未连接");
  expect(screen.getByText("runtime unavailable")).toBeTruthy();
  expect(api.poll).toHaveBeenCalledWith(
    "own",
    "nonce",
    expect.any(AbortSignal),
  );
});
it("never claims success when readback is missing", async () => {
  vi.spyOn(api, "generate").mockResolvedValue({
    qrcode_token: "n",
    qrcode_url: "qr",
  });
  vi.spyOn(api, "poll").mockResolvedValue({
    status: "success",
    channel_id: "missing",
  });
  render(<WeixinSettings agentId="own" />);
  fireEvent.click(await screen.findByText("连接微信"));
  await screen.findByText(/连接尚未读回/);
  expect(screen.queryByText(/微信绑定已保存/)).toBeNull();
});
it("aborts account-switch polls and ignores late confirmation", async () => {
  vi.spyOn(api, "generate").mockResolvedValue({
    qrcode_token: "n",
    qrcode_url: "qr",
  });
  let complete!: (v: { status: "success"; channel_id: string }) => void;
  vi.spyOn(api, "poll").mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { rerender } = render(<WeixinSettings key="a" agentId="a" />);
  fireEvent.click(await screen.findByText("连接微信"));
  await waitFor(() => expect(api.poll).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.poll).mock.calls[0][2]!;
  rerender(<WeixinSettings key="b" agentId="b" />);
  expect(signal.aborted).toBe(true);
  complete({ status: "success", channel_id: "old" });
  await screen.findByText("尚未连接微信。扫码确认后才会绑定。");
  expect(screen.queryByText(/微信绑定已保存/)).toBeNull();
});
it("requires paused state to be read back", async () => {
  const row = {
    id: "channel",
    agent_id: "own",
    kind: "weixin",
    name: "知君微信",
    enabled: true,
  };
  vi.mocked(api.list).mockResolvedValue([row]);
  vi.spyOn(api, "setEnabled").mockResolvedValue({ ...row, enabled: false });
  render(<WeixinSettings agentId="own" />);
  fireEvent.click(await screen.findByText("暂停"));
  await screen.findByText(/连接状态尚未读回/);
  expect(screen.queryByText("已暂停微信对话，记忆继续保留。")).toBeNull();
});

it("defaults to work and requires the explicit private declaration to read back", async () => {
  const row = {
    id: "channel",
    agent_id: "own",
    kind: "weixin",
    name: "知君微信",
    enabled: true,
  };
  vi.mocked(api.list).mockResolvedValue([row]);
  vi.spyOn(notificationApi, "setPurpose").mockImplementation(
    async (channel_id, purpose) => {
      const policy = { channel_id, purpose, declared: true };
      vi.mocked(notificationApi.list).mockResolvedValue([policy]);
      return policy;
    },
  );
  render(<WeixinSettings agentId="own" />);
  const select = await screen.findByLabelText("知君微信的渠道用途");
  await waitFor(() =>
    expect((select as HTMLSelectElement).disabled).toBe(false),
  );
  expect((select as HTMLSelectElement).value).toBe("work");
  expect(notificationApi.setPurpose).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: "private" } });
  await screen.findByText("已标为私人渠道，仅允许发送你确认的回访摘要。");
  expect(notificationApi.setPurpose).toHaveBeenCalledWith("channel", "private");
});
