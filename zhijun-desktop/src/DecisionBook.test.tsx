import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DecisionBookView } from "./DecisionBook";
import { decisionApi, type DecisionBook } from "./decisions";
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));
vi.mock("../../dashboard/src/hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("records an explicit choice in server timezone and reviews the result without rewriting the expectation", async () => {
  let book: DecisionBook = { revision: "empty", entries: [] };
  vi.spyOn(decisionApi, "read").mockImplementation(async () => book);
  vi.spyOn(decisionApi, "create").mockImplementation(async (body) => {
    book = {
      revision: "one",
      entries: [
        {
          ...body,
          id: "decision",
          sensitive: body.private,
          state: "open",
          outcome: "",
          reflection: "",
          reminder_status: "none",
        },
      ],
    };
    return book;
  });
  vi.spyOn(decisionApi, "review").mockImplementation(async (_id, body) => {
    book = {
      revision: "two",
      entries: [
        {
          ...book.entries[0],
          state: "reviewed",
          outcome: body.outcome || "",
          reflection: body.reflection || "",
        },
      ],
    };
    return book;
  });
  const { container } = render(<DecisionBookView agentId="own" />);
  expect(decisionApi.read).not.toHaveBeenCalled();
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByText("还没有约好回看的决定。");
  fireEvent.change(screen.getByLabelText("这次怎么选"), {
    target: { value: "接下项目" },
  });
  fireEvent.change(screen.getByLabelText("当时的预期"), {
    target: { value: "两个月内回款" },
  });
  fireEvent.change(screen.getByLabelText("约好回看（Asia/Shanghai）"), {
    target: { value: "2026-11-02T09:00" },
  });
  fireEvent.click(screen.getByText("记下并约好回看"));
  await screen.findByText("接下项目");
  expect(decisionApi.create).toHaveBeenCalledWith(
    expect.objectContaining({
      private: true,
      push_summary: "",
      revisit_at: "2026-11-02T01:00:00.000Z",
    }),
  );
  fireEvent.change(await screen.findByLabelText("实际结果"), {
    target: { value: "实际三个月" },
  });
  fireEvent.change(screen.getByLabelText("这次对自己的认识有什么变化"), {
    target: { value: "以后预留余量" },
  });
  fireEvent.click(screen.getByText("保存这次回看"));
  await waitFor(() =>
    expect(decisionApi.review).toHaveBeenCalledWith("decision", {
      revision: "one",
      action: "review",
      outcome: "实际三个月",
      reflection: "以后预留余量",
    }),
  );
  await screen.findByText("实际结果：实际三个月");
  expect(screen.getByText("当时预期：两个月内回款")).toBeTruthy();
});
