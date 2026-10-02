import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { personalWeixinApi as api } from "../../dashboard/src/api/modules/personalWeixin";
import { Notice } from "./App";
import { State, useResource } from "./memoryUi";
import { notificationApi, type ChannelPolicy } from "./notifications";

export function WeixinSettings({ agentId }: { agentId: string }) {
  const data = useResource(agentId, () => api.list(agentId));
  const policies = useResource(agentId, notificationApi.list);
  const [qr, setQr] = useState<{
    qrcode_token: string;
    qrcode_url: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
    },
    [agentId],
  );
  const cancel = () => {
    epoch.current++;
    controller.current?.abort();
    setQr(null);
    setBusy(false);
    setStatus("已停止等待。若已在手机确认，请刷新连接状态核对。");
    data.refresh();
  };
  const connect = async () => {
    if (busy) return;
    const turn = ++epoch.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setStatus("");
    setQr(null);
    try {
      const result = await api.generate(agentId, abort.signal);
      if (turn !== epoch.current) return;
      setQr(result);
      setStatus("请用希望与知君交谈的微信扫码，并在手机确认。");
      const started = Date.now();
      while (turn === epoch.current && Date.now() - started < 300000) {
        const current = await api.poll(
          agentId,
          result.qrcode_token,
          abort.signal,
        );
        if (turn !== epoch.current) return;
        if (current.status === "error")
          throw new Error(
            current.message || "扫码尚未完成，请重新获取二维码。",
          );
        if (current.status === "success") {
          if (!current.channel_id) throw new Error("服务端未返回连接编号");
          const rows = await api.list(agentId);
          if (turn !== epoch.current) return;
          if (
            !rows.some(
              (row) =>
                row.id === current.channel_id &&
                row.agent_id === agentId &&
                row.kind === "weixin",
            )
          )
            throw new Error("连接尚未读回");
          setQr(null);
          setStatus("微信绑定已保存。连接运行后可在微信中交谈。");
          data.refresh();
          policies.refresh();
          return;
        }
      }
      if (turn === epoch.current)
        throw new Error("二维码等待已结束，请重新获取并扫码。");
    } catch (e) {
      if (turn === epoch.current) {
        setError(
          `连接结果尚未核实：${(e as Error).message}。请刷新状态后再操作。`,
        );
        data.refresh();
      }
    } finally {
      if (turn === epoch.current) setBusy(false);
    }
  };
  const purpose = async (id: string, value: ChannelPolicy["purpose"]) => {
    if (busy) return;
    const turn = epoch.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await notificationApi.setPurpose(id, value);
      const saved = await notificationApi.list();
      if (turn !== epoch.current) return;
      if (
        !saved.some(
          (p) => p.channel_id === id && p.purpose === value && p.declared,
        )
      )
        throw new Error("渠道用途尚未读回");
      setStatus(
        value === "private"
          ? "已标为私人渠道，仅允许发送你确认的回访摘要。"
          : "已按工作渠道处理，只发送无内容提醒。",
      );
      policies.refresh();
    } catch (e) {
      if (turn === epoch.current) {
        setError((e as Error).message);
        policies.refresh();
      }
    } finally {
      if (turn === epoch.current) setBusy(false);
    }
  };
  const toggle = async (id: string, enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    const turn = epoch.current;
    try {
      await api.setEnabled(agentId, id, enabled);
      const rows = await api.list(agentId);
      if (turn !== epoch.current) return;
      if (!rows.some((r) => r.id === id && r.enabled === enabled))
        throw new Error("连接状态尚未读回");
      setStatus(
        enabled ? "已启用微信对话。" : "已暂停微信对话，记忆继续保留。",
      );
      data.refresh();
    } catch (e) {
      if (turn === epoch.current) {
        setError(`操作结果尚未核实：${(e as Error).message}`);
        data.refresh();
      }
    } finally {
      if (turn === epoch.current) setBusy(false);
    }
  };
  return (
    <section className="weixin-settings">
      <h3>微信对话</h3>
      <p className="muted">
        把知君带到微信里。与桌面共用这份档案和记忆，会话各自保留。
      </p>
      <p className="muted fine">
        使用万象的微信扫码通道，在微信的专用聊天窗口交谈。仅接受本次扫码确认的微信账号。
      </p>
      <State resource={data} />
      <State resource={policies} />
      {data.data && (
        <>
          {data.data
            .filter((r) => r.kind === "weixin")
            .map((row) => (
              <article className="weixin-connection" key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <p className="muted">
                    {!row.enabled
                      ? "已暂停"
                      : row.runtime?.connected
                      ? "通道已运行"
                      : "已保存 · 通道暂未连接"}
                  </p>
                  {row.enabled && row.runtime?.detail && (
                    <Notice>{row.runtime.detail}</Notice>
                  )}
                  <label>
                    这是只有你自己看的账号，还是工作账号？
                    <select
                      aria-label={`${row.name}的渠道用途`}
                      disabled={busy || policies.loading || !!policies.error}
                      value={
                        policies.data?.find((p) => p.channel_id === row.id)
                          ?.purpose || "work"
                      }
                      onChange={(e) =>
                        void purpose(
                          row.id,
                          e.target.value as ChannelPolicy["purpose"],
                        )
                      }
                    >
                      <option value="work">工作或未标记 · 无内容提醒</option>
                      <option value="private">
                        只有我自己看 · 允许回访摘要
                      </option>
                    </select>
                  </label>
                </div>
                <button
                  disabled={busy}
                  onClick={() => void toggle(row.id, !row.enabled)}
                >
                  {row.enabled ? "暂停" : "启用"}
                </button>
              </article>
            ))}
          {!data.data.length && (
            <p className="muted">尚未连接微信。扫码确认后才会绑定。</p>
          )}
          <div className="actions">
            <button disabled={busy} onClick={() => void connect()}>
              {data.data.length ? "重新扫码连接" : "连接微信"}
            </button>
            <button disabled={busy} onClick={data.refresh}>
              刷新连接状态
            </button>
          </div>
        </>
      )}
      {qr && (
        <div className="weixin-qr">
          <QRCodeSVG value={qr.qrcode_url} size={192} marginSize={4} />
          <p>{status}</p>
          <button onClick={cancel}>停止等待</button>
        </div>
      )}
      {!qr && status && <p role="status">{status}</p>}
      {error && <Notice>{error}</Notice>}
    </section>
  );
}
