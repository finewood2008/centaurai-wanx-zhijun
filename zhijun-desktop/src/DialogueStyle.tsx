import { useEffect, useRef, useState, type ReactNode } from "react";
import { mbtiApi } from "../../dashboard/src/api/modules/mbti";
import type { MBTIType } from "../../dashboard/src/api/types/mbti";
import { apiErrorMessage } from "../../dashboard/src/utils/apiError";
import { MBTITestDialog } from "./MBTITestDialog";

const groups = [
  { name: "思考与探索", codes: ["INTJ", "INTP", "ENTJ", "ENTP"] },
  { name: "理解与共鸣", codes: ["INFJ", "INFP", "ENFJ", "ENFP"] },
  { name: "务实与照顾", codes: ["ISTJ", "ISFJ", "ESTJ", "ESFJ"] },
  { name: "体验与行动", codes: ["ISTP", "ISFP", "ESTP", "ESFP"] },
];

export function DialogueStyle({
  agentId,
  disabled,
  children,
}: {
  agentId: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [types, setTypes] = useState<MBTIType[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const saving = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLButtonElement>(null);
  const testEntryRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) backRef.current?.focus();
  }, [open]);
  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      if (!saving.current) setRevision((n) => n + 1);
    };
    window.addEventListener("zhijun-service-restored", refresh);
    return () => {
      alive.current = false;
      window.removeEventListener("zhijun-service-restored", refresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      mbtiApi.listMBTITypes(agentId),
      mbtiApi.getCurrentMBTI(agentId),
    ])
      .then(([catalog, saved]) => {
        if (!active) return;
        const code = saved.configured ? saved.code : "";
        if (code && !catalog.some((type) => type.code === code))
          throw new Error("暂时无法识别已保存的对话风格，请重新读取。");
        setTypes(catalog);
        setCurrent(code);
        setSelected(code);
      })
      .catch((e) => {
        if (active)
          setError(apiErrorMessage(e, "暂时无法读取对话风格，请稍后重试。"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agentId, revision]);

  const detail = types.find((type) => type.code === selected);
  const applied = types.find((type) => type.code === current);
  const currentName =
    current === ""
      ? "自然"
      : applied
      ? `${current} · ${applied.name_zh}`
      : "未读取";
  function preview(code: string) {
    setSelected(code);
    setNotice("");
    requestAnimationFrame(
      () => previewRef.current?.scrollIntoView?.({ block: "start" }),
    );
  }
  async function apply(desired = selected): Promise<boolean> {
    if (
      desired === null ||
      loading ||
      busy ||
      disabled ||
      Boolean(error) ||
      desired === current
    )
      return false;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await mbtiApi.applyMBTIType(
        desired || "_default",
        "zh",
        agentId,
      );
      if (!result.success) throw new Error("风格未能保存，请稍后重试。");
      const saved = await mbtiApi.getCurrentMBTI(agentId);
      if (saved.code !== desired || saved.configured !== Boolean(desired))
        throw new Error("暂时无法确认保存结果，请重新读取后再试。");
      if (alive.current) {
        setCurrent(desired);
        setSelected(desired);
        setNotice(
          desired
            ? `已换成 ${desired} · ${types.find((type) => type.code === desired)
                ?.name_zh}，从下一次回答开始。`
            : "已恢复自然风格，从下一次回答开始。",
        );
      }
      return true;
    } catch (e) {
      if (alive.current)
        setError(apiErrorMessage(e, "暂时无法更换对话风格，请稍后重试。"));
      return false;
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <div hidden={open} ref={listRef} className="dialogue-browser-list">
        <button
          className="dialogue-style-entry"
          aria-label="选择对话风格"
          ref={entryRef}
          onClick={() => setOpen(true)}
        >
          <span>对话风格</span>
          <span>
            {loading ? "读取中…" : error ? "重新读取" : currentName}
            <span aria-hidden="true"> ↗</span>
          </span>
        </button>
        {children}
      </div>
      {open && (
        <section className="dialogue-style" aria-label="对话风格">
          <button
            className="quiet"
            ref={backRef}
            disabled={busy}
            onClick={() => {
              setOpen(false);
              requestAnimationFrame(() => {
                listRef.current?.scrollIntoView?.({ block: "start" });
                entryRef.current?.focus({ preventScroll: true });
              });
            }}
          >
            ← 返回对话
          </button>
          <h3>让交谈，更合心意</h3>
          <p className="panel-intro">
            选择知君与你交谈的方式。随时可以换回自然风格。
          </p>
          <p className="muted fine">
            沿用万象的 MBTI
            风格预设，调整知君的表达方式。这份档案里的网页与微信对话共用。
          </p>
          <button
            className="mbti-test-entry"
            ref={testEntryRef}
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => setTestOpen(true)}
          >
            <span>做一次 MBTI 测试</span>
            <span className="muted fine">万象原有问卷 · 28 题 ↗</span>
          </button>
          {loading && (
            <p role="status" className="muted">
              正在读取对话风格…
            </p>
          )}
          {error && (
            <div role="alert" className="dialogue-style-error">
              {error}{" "}
              <button
                disabled={busy || loading}
                onClick={() => {
                  setNotice("");
                  setRevision((n) => n + 1);
                }}
              >
                重新读取
              </button>
            </div>
          )}
          {!loading && current !== null && (
            <>
              <div className="dialogue-style-detail" ref={previewRef}>
                <div className="dialogue-style-detail-heading">
                  <span className="eyebrow">
                    {selected === current ? "正在使用" : "风格预览"}
                  </span>
                  <span className="muted fine">{detail?.code || "自然"}</span>
                </div>
                <h4>{detail?.name_zh || "熟悉的知君"}</h4>
                <dl>
                  <dt>表达</dt>
                  <dd>
                    {detail?.behavior.answer_style_zh ||
                      "温和、直接，跟着你的话慢慢想清楚。"}
                  </dd>
                  <dt>交谈</dt>
                  <dd>
                    {detail?.behavior.casual_chat_zh ||
                      "从你在意的事出发，不急着下结论。"}
                  </dd>
                  <dt>回应</dt>
                  <dd>
                    {detail?.behavior.emotion_zh ||
                      "认真听见你的感受，也给你坦诚的看法。"}
                  </dd>
                </dl>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    disabled ||
                    Boolean(error) ||
                    selected === null ||
                    selected === current
                  }
                  onClick={() => void apply()}
                >
                  {busy
                    ? "正在更换…"
                    : selected === current
                    ? "正在使用"
                    : selected === ""
                    ? "恢复自然风格"
                    : "使用这种风格"}
                </button>
                {disabled && (
                  <p className="muted fine">
                    当前暂不能更换风格，请等这一轮对话结束或连接恢复。
                  </p>
                )}
                {notice && (
                  <p role="status" className="dialogue-style-notice">
                    {notice}
                  </p>
                )}
              </div>
              <div
                className="dialogue-style-options"
                role="group"
                aria-label="选择知君的表达方式"
              >
                <button
                  className="dialogue-style-card dialogue-style-natural"
                  aria-pressed={selected === ""}
                  disabled={busy}
                  onClick={() => preview("")}
                >
                  <span>
                    <strong>自然</strong>
                    <span className="muted fine">
                      {current === "" ? "正在使用" : "知君原有的交谈方式"}
                    </span>
                  </span>
                  <span className="muted">听你说，陪你想。</span>
                </button>
                {groups.map((group) => (
                  <div className="dialogue-style-group" key={group.name}>
                    <h4>{group.name}</h4>
                    <div className="dialogue-style-grid">
                      {group.codes.map((code) => {
                        const type = types.find((item) => item.code === code);
                        if (!type) return null;
                        return (
                          <button
                            key={code}
                            className="dialogue-style-card"
                            aria-label={`预览 ${code} · ${type.name_zh}`}
                            aria-pressed={selected === code}
                            disabled={busy}
                            onClick={() => preview(code)}
                          >
                            <span>
                              <strong>{code}</strong>
                              <span className="fine">{type.name_zh}</span>
                              {current === code && (
                                <span className="dialogue-style-current fine">
                                  正在使用
                                </span>
                              )}
                            </span>
                            <span className="muted fine">
                              {type.descriptors_zh}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      <MBTITestDialog
        open={testOpen}
        agentId={agentId}
        onClose={() => {
          setTestOpen(false);
          requestAnimationFrame(
            () => testEntryRef.current?.focus({ preventScroll: true }),
          );
        }}
        onApply={apply}
        applying={busy}
        disabled={Boolean(disabled || loading || current === null)}
        current={current}
        applyError={error}
        onRefreshStyle={() => setRevision((n) => n + 1)}
      />
    </>
  );
}
