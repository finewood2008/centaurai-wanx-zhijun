import { useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezonePlugin from "dayjs/plugin/timezone";
import { useServerTimezone } from "../../dashboard/src/hooks/useServerTimezone";
import { formatServerIsoDateTime } from "../../dashboard/src/utils/formatMessageTime";
import { Notice } from "./App";
import { decisionApi, type DecisionRecord } from "./decisions";
import { State, useResource } from "./memoryUi";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

export function DecisionBookView({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);
  const data = useResource(agentId + ":" + open, () =>
    open
      ? decisionApi.read()
      : Promise.resolve({ revision: "empty", entries: [] as DecisionRecord[] }),
  );
  const timezone = useServerTimezone();
  const [kind, setKind] = useState<DecisionRecord["kind"]>("decision");
  const [description, setDescription] = useState("");
  const [expectation, setExpectation] = useState("");
  const [date, setDate] = useState("");
  const [privateEntry, setPrivateEntry] = useState(true);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
      data.refresh();
    } catch (e) {
      setError((e as Error).message);
      data.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="ontology-native"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>判断簿 · 决定与回访</summary>
      <p className="muted">
        记下现在怎么选、预期什么，约一个回看的日子。结果出来后，再看当时的判断哪里需要调整。
      </p>
      <State resource={data} />
      {data.data && (
        <>
          <form
            className="ontology-editor"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || !data.data) return;
              void mutate(async () => {
                await decisionApi.create({
                  revision: data.data!.revision,
                  kind,
                  description,
                  expectation,
                  revisit_at: dayjs.tz(date, timezone).toISOString(),
                  private: privateEntry,
                  push_summary: privateEntry ? "" : summary,
                });
                setDescription("");
                setExpectation("");
                setDate("");
                setSummary("");
                setPrivateEntry(true);
                setStatus("已记下。原来的预期会保留，回访时再核对结果。");
              });
            }}
          >
            <label>
              记录什么
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as DecisionRecord["kind"])
                }
              >
                <option value="decision">一个决定</option>
                <option value="agreement">一个约定</option>
                <option value="question">一个思考问题</option>
              </select>
            </label>
            <label>
              这次怎么选
              <textarea
                required
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              当时的预期
              <textarea
                required
                maxLength={1000}
                value={expectation}
                onChange={(e) => setExpectation(e.target.value)}
              />
            </label>
            <label>
              约好回看（{timezone}）
              <input
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="ontology-core">
              <input
                type="checkbox"
                checked={privateEntry}
                onChange={(e) => setPrivateEntry(e.target.checked)}
              />
              涉及心事，仅在知君里展开
            </label>
            {!privateEntry && (
              <label>
                允许提醒的摘要
                <input
                  maxLength={160}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="留空则只发无内容提醒"
                />
              </label>
            )}
            <p className="muted fine">
              开启主动关心后，到期会优先提醒回访。摘要只发到你明确标为私人的渠道；心事不会进入推送正文。
            </p>
            <button disabled={busy || data.loading} type="submit">
              记下并约好回看
            </button>
          </form>
          {data.data.entries.map((entry) => (
            <article className="memory-card" key={entry.id}>
              <strong>{entry.description}</strong>
              <p>当时预期：{entry.expectation}</p>
              <small>
                {formatServerIsoDateTime(entry.revisit_at, timezone)} 回看 ·{" "}
                {entry.sensitive
                  ? "仅在知君里展开"
                  : entry.push_summary
                  ? "已允许提醒摘要"
                  : "无内容提醒"}
              </small>
              {entry.state === "reviewed" ? (
                <>
                  <p>实际结果：{entry.outcome}</p>
                  <p>认识变化：{entry.reflection || "暂未填写"}</p>
                </>
              ) : entry.state === "cancelled" ? (
                <p className="muted">已停止回访</p>
              ) : (
                <Review
                  entry={entry}
                  busy={busy}
                  onSave={(action, outcome, reflection) => {
                    void mutate(() =>
                      decisionApi.review(entry.id, {
                        revision: data.data!.revision,
                        action,
                        outcome,
                        reflection,
                      }),
                    );
                  }}
                />
              )}
            </article>
          ))}
          {!data.data.entries.length && (
            <p className="muted">还没有约好回看的决定。</p>
          )}
        </>
      )}
      {status && <p role="status">{status}</p>}
      {error && <Notice>保存未完成：{error}</Notice>}
    </details>
  );
}

function Review({
  entry,
  busy,
  onSave,
}: {
  entry: DecisionRecord;
  busy: boolean;
  onSave: (
    action: "review" | "cancel",
    outcome?: string,
    reflection?: string,
  ) => void;
}) {
  const [outcome, setOutcome] = useState("");
  const [reflection, setReflection] = useState("");
  return (
    <details>
      <summary>回看这个决定</summary>
      <form
        className="ontology-editor"
        onSubmit={(e) => {
          e.preventDefault();
          onSave("review", outcome, reflection);
        }}
      >
        <label>
          实际结果
          <textarea
            required
            maxLength={2000}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
        </label>
        <label>
          这次对自己的认识有什么变化
          <textarea
            maxLength={2000}
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
          />
        </label>
        <button disabled={busy} type="submit">
          保存这次回看
        </button>
        <button disabled={busy} type="button" onClick={() => onSave("cancel")}>
          停止回访
        </button>
      </form>
    </details>
  );
}
