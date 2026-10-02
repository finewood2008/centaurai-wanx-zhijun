import type { ChatMessage } from "../../dashboard/src/pages/Chat/hooks/sseHelpers";
import { request } from "../../dashboard/src/api/request";

export const RESPONSE_OPTIONS_TOOL = "zhijun_response_options";
export const RESPONSE_OPTIONS_NOTICE =
  "只是一些思路。点选后放入输入框，你可以改写，也可以自己说。";
export type ResponseOption = { label: string; draft: string };
export type ResponseOptions = { question: string; options: ResponseOption[] };

function genericDraft(value: string) {
  const text = value.replace(/[\s，。！？、,.!?：:；;]/g, "");
  return /^(?:(?:准确|对|对的|是的|没错|基本准确|你理解得对)(?:就是这样|你理解得对)?|(?:大方向对|基本准确)(?:但)?(?:有一处|有一点)(?:我想)?(?:要补|补一下|补充一下)|先别急着记(?:下来)?(?:我还想(?:再)?想想)?)$/.test(
    text,
  );
}

export const responseOptionsApi = {
  generate: (
    threadId: string,
    reply: string,
    manual: boolean,
    signal: AbortSignal,
  ) =>
    request<{
      status: "ready" | "not_needed" | "stale" | "unavailable";
      invitation: ResponseOptions | null;
    }>("/zhijun/response-options", {
      method: "POST",
      body: JSON.stringify({ thread_id: threadId, reply, manual }),
      signal,
    }),
};

export function followUpQuestion(text: string) {
  const clean = text
    .replace(/[*_`~]/g, "")
    .replace(/^>.*$/gm, "")
    .replace(/“[^”]*[?？][^”]*”|「[^」]*[?？][^」]*」|"[^"]*[?？][^"]*"/g, "")
    .trim();
  if ((clean.match(/[?？]/g)?.length || 0) !== 1) return null;
  const sentence = clean.split(/[。！!\n]/).find((part) => /[?？]/.test(part))!;
  const question = sentence.slice(0, sentence.search(/[?？]/) + 1).trim();
  return question.length <= 240 ? question : null;
}

/** Read only visible text. Reasoning and native tool blocks are not replies. */
export function assistantReplyText(message: ChatMessage) {
  const blocks = message.contentBlocks?.filter(
    (block) => block.type === "text",
  );
  return blocks?.length
    ? blocks.map((block) => block.content).join("\n")
    : message.content || "";
}

export function parseResponseOptions(
  message: ChatMessage,
): ResponseOptions | null {
  const tool = message.toolData;
  if (
    !tool ||
    tool.name !== RESPONSE_OPTIONS_TOOL ||
    message.status !== "done" ||
    tool.errorCode ||
    (tool.returnCode != null && tool.returnCode !== 0)
  )
    return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(tool.output || "");
  } catch {
    return null;
  }
  if (
    !value ||
    Array.isArray(value) ||
    value.ok !== true ||
    value.error ||
    value.version !== 1 ||
    value.kind !== "expression_invitation"
  )
    return null;
  const question =
    typeof value.question === "string" ? value.question.trim() : "";
  if (
    !question ||
    question.length > 240 ||
    (question.match(/[?？]/g)?.length || 0) > 1 ||
    !Array.isArray(value.options) ||
    value.options.length < 2 ||
    value.options.length > 4
  )
    return null;
  const options: ResponseOption[] = [];
  for (const row of value.options) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.label !== "string" ||
      typeof row.draft !== "string"
    )
      return null;
    const label = row.label.trim();
    const draft = row.draft.trim();
    if (
      !label ||
      label.length > 40 ||
      !draft ||
      genericDraft(draft) ||
      draft.length > 500 ||
      options.some((option) => option.label === label || option.draft === draft)
    )
      return null;
    options.push({ label, draft });
  }
  return { question, options };
}

/** Options belong only to the next matching completed reply in their turn. */
export function responseOptionsByReply(messages: ChatMessage[]) {
  const replies = new Map<string, ResponseOptions>();
  let pending: ResponseOptions | null = null;
  for (const message of messages) {
    if (message.role === "user") pending = null;
    if (message.toolData?.name === RESPONSE_OPTIONS_TOOL)
      pending = parseResponseOptions(message);
    if (message.role !== "assistant" || message.toolData || message.hitlData)
      continue;
    const text = assistantReplyText(message).trim();
    if (!text) continue;
    const normalize = (value: string) => value.replace(/[\s*_~`?？]/g, "");
    const normalized = normalize(text);
    if (
      pending &&
      message.status === "done" &&
      (text.match(/[?？]/g)?.length || 0) <= 1 &&
      normalized.includes(normalize(pending.question))
    )
      replies.set(message.id, pending);
    pending = null;
  }
  return replies;
}
