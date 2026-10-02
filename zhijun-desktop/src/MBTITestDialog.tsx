import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mbtiApi } from "../../dashboard/src/api/modules/mbti";
import type {
  MBTITestQuestion,
  MBTITestResult,
} from "../../dashboard/src/api/types/mbti";
import { apiErrorMessage } from "../../dashboard/src/utils/apiError";

const axes = [
  { key: "ei", label: "能量来源", poles: { E: "外向", I: "内向" } },
  { key: "sn", label: "获取信息", poles: { S: "实感", N: "直觉" } },
  { key: "tf", label: "作出判断", poles: { T: "思考", F: "情感" } },
  { key: "jp", label: "生活方式", poles: { J: "判断", P: "感知" } },
] as const;

export function MBTITestDialog({
  open,
  agentId,
  onClose,
  onApply,
  applying,
  disabled,
  current,
  applyError,
  onRefreshStyle,
}: {
  open: boolean;
  agentId: string;
  onClose: () => void;
  onApply: (code: string) => Promise<boolean>;
  applying: boolean;
  disabled: boolean;
  current: string | null;
  applyError: string;
  onRefreshStyle: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const [questions, setQuestions] = useState<MBTITestQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [stage, setStage] = useState<"intro" | "questions" | "result">("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MBTITestResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
    };
  }, [open]);
  useEffect(() => {
    if (!open || questions.length) return;
    let active = true;
    setLoading(true);
    setError("");
    void mbtiApi
      .getMBTITestQuestions(agentId)
      .then((value) => {
        if (!active) return;
        if (!value.length) throw new Error("暂时没有读取到题目，请重新读取。");
        setQuestions(value);
        setLoading(false);
      })
      .catch((e) => {
        if (active)
          setError(apiErrorMessage(e, "暂时无法读取题目，请稍后重试。"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, agentId, revision, questions.length]);
  useEffect(() => {
    if (open && stage === "questions")
      questionHeading.current?.focus({ preventScroll: true });
    if (open && stage === "result")
      resultHeading.current?.focus({ preventScroll: true });
  }, [open, stage, index]);

  const answered = questions.filter((q) => answers[String(q.id)]).length;
  const question = questions[index];
  const allAnswered = questions.length > 0 && answered === questions.length;
  async function submit() {
    if (inFlight.current) return;
    if (!allAnswered) {
      setIndex(questions.findIndex((q) => !answers[String(q.id)]));
      setError(
        `还有 ${questions.length - answered} 题未作答，已回到第一道未答题。`,
      );
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    try {
      const value = await mbtiApi.submitMBTITest(answers, false, "zh", agentId);
      if (alive.current) {
        setResult(value);
        setStage("result");
      }
    } catch (e) {
      if (alive.current)
        setError(
          apiErrorMessage(e, "暂时无法生成结果，你的作答仍保留，请再试一次。"),
        );
    } finally {
      inFlight.current = false;
      if (alive.current) setSubmitting(false);
    }
  }
  function close() {
    if (!applying) onClose();
  }
  if (!open) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="mbti-test-dialog"
      aria-labelledby="mbti-test-title"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <header className="mbti-test-head">
        <div>
          <span className="eyebrow">与自己相识</span>
          <h2 id="mbti-test-title">MBTI 测试</h2>
        </div>
        <button
          className="mbti-test-close"
          aria-label="关闭 MBTI 测试"
          disabled={applying}
          onClick={close}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="mbti-test-body">
        {error && (
          <div role="alert" className="dialogue-style-error">
            {error}
            {!questions.length && (
              <button
                disabled={loading}
                onClick={() => setRevision((n) => n + 1)}
              >
                重新读取题目
              </button>
            )}
          </div>
        )}
        {stage === "intro" && (
          <>
            <h3>从日常选择，认识自己的偏好</h3>
            <p>
              沿用万象的 {questions.length || 28}{" "}
              道题。按你平时的习惯回答，没有标准答案。
            </p>
            <p className="muted">
              结果是一份交流偏好的参考。看完以后，你可以选择将对应风格用于知君的对话。
            </p>
            {loading && (
              <p role="status" className="muted">
                正在读取题目…
              </p>
            )}
            <button
              className="primary"
              disabled={loading || !questions.length}
              onClick={() => setStage("questions")}
            >
              开始测试
            </button>
          </>
        )}
        {stage === "questions" && question && (
          <>
            <div className="mbti-test-progress">
              <span>
                第 {index + 1} / {questions.length} 题
              </span>
              <span className="muted">已答 {answered} 题</span>
            </div>
            <progress
              value={answered}
              max={questions.length}
              aria-label="测试进度"
            />
            <h3
              ref={questionHeading}
              tabIndex={-1}
              className="mbti-test-question"
            >
              {question.question_zh}
            </h3>
            <div
              className="mbti-test-choices"
              role="group"
              aria-label="本题选项"
            >
              {(["A", "B"] as const).map((choice) => (
                <button
                  key={choice}
                  aria-pressed={answers[String(question.id)] === choice}
                  disabled={submitting}
                  onClick={() => {
                    setAnswers((previous) => ({
                      ...previous,
                      [String(question.id)]: choice,
                    }));
                    setError("");
                  }}
                >
                  <span className="mbti-test-letter">{choice}</span>
                  <span>
                    {choice === "A"
                      ? question.option_a_zh
                      : question.option_b_zh}
                  </span>
                </button>
              ))}
            </div>
            <nav className="mbti-test-nav" aria-label="测试翻页">
              <button
                disabled={submitting || index === 0}
                onClick={() => {
                  setIndex((n) => n - 1);
                  setError("");
                }}
              >
                上一题
              </button>
              {index < questions.length - 1 ? (
                <button
                  className="primary"
                  disabled={submitting || !answers[String(question.id)]}
                  onClick={() => {
                    setIndex((n) => n + 1);
                    setError("");
                  }}
                >
                  下一题
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={submitting}
                  onClick={() => void submit()}
                >
                  {submitting ? "正在生成结果…" : "查看结果"}
                </button>
              )}
            </nav>
            <div className="mbti-answer-sheet" role="group" aria-label="答题卡">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  aria-label={`第 ${i + 1} 题${
                    answers[String(q.id)] ? "，已作答" : "，未作答"
                  }`}
                  aria-current={index === i ? "step" : undefined}
                  className={answers[String(q.id)] ? "answered" : ""}
                  disabled={submitting}
                  onClick={() => {
                    setIndex(i);
                    setError("");
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </>
        )}
        {stage === "result" && result && (
          <>
            <p className="muted fine">按这次作答，你更接近</p>
            <div className="mbti-test-result">
              <span>{result.code}</span>
              <h3 ref={resultHeading} tabIndex={-1}>
                {result.profile.name_zh}
              </h3>
              <p>{result.profile.summary_zh}</p>
            </div>
            <dl className="mbti-test-dimensions">
              {axes.map((axis) => {
                const pole = result.dimensions[
                  axis.key
                ][0] as keyof typeof axis.poles;
                return (
                  <div key={axis.key}>
                    <dt>{axis.label}</dt>
                    <dd>
                      {axis.poles[pole] || pole}
                      <span className="muted"> · {pole}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="muted fine">
              可以把这种风格用于知君，让交谈更合心意。
            </p>
            {applyError && (
              <div role="alert" className="dialogue-style-error">
                {applyError}{" "}
                <button
                  disabled={applying}
                  onClick={onRefreshStyle}
                >
                  重新读取风格
                </button>
              </div>
            )}
            {current === result.code && (
              <p role="status" className="dialogue-style-notice">
                知君正在使用 {result.code} · {result.profile.name_zh} 风格。
              </p>
            )}
            <div className="mbti-test-result-actions">
              <button
                className="primary"
                disabled={
                  disabled ||
                  applying ||
                  Boolean(applyError) ||
                  current === result.code
                }
                onClick={() => void onApply(result.code)}
              >
                {applying
                  ? "正在应用…"
                  : current === result.code
                  ? "正在使用"
                  : "应用到知君的对话风格"}
              </button>
              <button
                disabled={applying}
                onClick={() => {
                  setAnswers({});
                  setResult(null);
                  setIndex(0);
                  setError("");
                  setStage("intro");
                }}
              >
                重新测试
              </button>
            </div>
            {disabled && (
              <p className="muted fine">
                当前暂不能应用风格，请等这一轮对话结束或连接恢复。
              </p>
            )}
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
