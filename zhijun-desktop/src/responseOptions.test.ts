import { expect, it } from "vitest";
import type { ChatMessage } from "../../dashboard/src/pages/Chat/hooks/sseHelpers";
import {
  assistantReplyText,
  followUpQuestion,
  parseResponseOptions,
  responseOptionsByReply,
  RESPONSE_OPTIONS_TOOL,
} from "./responseOptions";
const payload = {
  ok: true,
  version: 1,
  kind: "expression_invitation",
  question: "你愿意从哪里聊起？",
  options: [
    { label: "聊眼下", draft: "我想先聊眼下在意的事。" },
    { label: "暂不展开", draft: "我暂时不想展开，先慢慢待一会儿。" },
  ],
};
const tool = (output = payload, extra = {}) =>
  ({
    id: "tool",
    role: "assistant",
    status: "done",
    toolData: { name: RESPONSE_OPTIONS_TOOL, output: JSON.stringify(output) },
    ...extra,
  }) as ChatMessage;
const reply = (id: string, content: string, status = "done") =>
  ({ id, role: "assistant", status, content }) as ChatMessage;
it("accepts only successful native interaction output, never assistant links, arguments, failures or incomplete output", () => {
  expect(parseResponseOptions(tool())?.options).toHaveLength(2);
  for (const message of [
    tool({ ...payload, ok: false }),
    tool(payload, { status: "streaming" }),
    tool(payload, { status: "error" }),
    reply("a", JSON.stringify(payload)),
    {
      ...tool(),
      toolData: {
        name: RESPONSE_OPTIONS_TOOL,
        arguments: JSON.stringify(payload),
      },
    } as ChatMessage,
    {
      ...tool(),
      toolData: { name: "memory_get", output: JSON.stringify(payload) },
    } as ChatMessage,
  ])
    expect(parseResponseOptions(message)).toBeNull();
});
it("rejects malformed, extra-question, duplicate, too few/many and oversized invitations", () => {
  for (const output of [
    { ...payload, version: 2 },
    { ...payload, question: "你怎么想？还发生了什么？" },
    { ...payload, options: [] },
    { ...payload, options: payload.options.slice(0, 1) },
    {
      ...payload,
      options: [...payload.options, ...payload.options, payload.options[0]],
    },
    { ...payload, options: [payload.options[0], payload.options[0]] },
    {
      ...payload,
      options: [payload.options[0], { label: " ", draft: "草稿" }],
    },
    {
      ...payload,
      options: [payload.options[0], { label: "标签", draft: "字".repeat(501) }],
    },
  ])
    expect(parseResponseOptions(tool(output))).toBeNull();
});

it("regenerates old content-free confirmations instead of reusing their native tool output", () => {
  const generic = {
    ...payload,
    options: [
      { label: "准确", draft: "准确，就是这样。" },
      { label: "补充", draft: "大方向对，但有一处我想补一下。" },
      { label: "暂不记", draft: "先别急着记下来，我还想再想想。" },
    ],
  };
  expect(parseResponseOptions(tool(generic))).toBeNull();
  expect(
    responseOptionsByReply([tool(generic), reply("a", payload.question)]).size,
  ).toBe(0);
  const substantive = {
    ...payload,
    options: [
      {
        label: "方向与责任",
        draft:
          "人定方向，也为结果负责。AI 可以帮助执行，但不能替人承担最终责任。",
      },
      {
        label: "限于人机分工",
        draft: "我说的是人机分工中的原则，别的场景是否适用，我还想再想想。",
      },
      {
        label: "先不写成原则",
        draft: "先保留在人和 AI 合作的语境里，是否是我的长期原则还不确定。",
      },
    ],
  };
  expect(parseResponseOptions(tool(substantive))?.options).toEqual(
    substantive.options,
  );
});
it("binds options to the next matching completed natural reply and clears them across turns", () => {
  const messages = [
    { role: "user", id: "u" } as ChatMessage,
    tool(),
    reply("a", `我在听。\n${payload.question}`),
    { role: "user", id: "next-user" } as ChatMessage,
    reply("next", payload.question),
  ];
  const bound = responseOptionsByReply(messages);
  expect(bound.get("a")).toEqual({
    question: payload.question,
    options: payload.options,
  });
  expect(bound.has("next")).toBe(false);
  expect(
    responseOptionsByReply([tool(), reply("a", payload.question, "streaming")])
      .size,
  ).toBe(0);
});
it("never carries invitations past an unrelated reply or a later failed tool", () => {
  for (const messages of [
    [
      tool(),
      reply("unrelated", "听你继续说。"),
      reply("later", payload.question),
    ],
    [tool(), tool({ ...payload, ok: false }), reply("later", payload.question)],
    [tool(), reply("two", `${payload.question}后来发生了什么？`)],
    [tool(), reply("error", payload.question, "error")],
  ])
    expect(responseOptionsByReply(messages).size).toBe(0);
});
it("uses native text blocks while excluding thinking and leaves historical content untouched", () => {
  const message = {
    ...reply("a", "旧回退文本"),
    contentBlocks: [
      { type: "thinking", content: "内部推理" },
      { type: "text", content: "我在听。" },
      { type: "text", content: payload.question },
    ],
  } as ChatMessage;
  expect(assistantReplyText(message)).toBe(`我在听。\n${payload.question}`);
  expect(responseOptionsByReply([tool(), message]).has("a")).toBe(true);
  expect(message.content).toBe("旧回退文本");
});
it("matches the same question despite inline emphasis and Chinese or ASCII punctuation", () => {
  const message = reply("formatted", "我在听。\n**你愿意从哪里聊起**?");
  expect(responseOptionsByReply([tool(), message]).has("formatted")).toBe(true);
  expect(
    responseOptionsByReply([tool(), reply("other", "你愿意聊聊工作吗？")]).size,
  ).toBe(0);
});

it("recognizes a single follow-up followed by an example, but not quoted or multiple questions", () => {
  expect(
    followUpQuestion(
      "有没有哪段时间不一样？比如某个阶段，或者某个人在的时候。",
    ),
  ).toBe("有没有哪段时间不一样？");
  for (const text of [
    "原话是“你怎么想？”",
    "> 你怎么想？",
    "你怎么想？后来呢？",
    "我在听。",
  ])
    expect(followUpQuestion(text)).toBeNull();
});
