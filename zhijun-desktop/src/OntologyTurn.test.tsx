import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OntologyTurn } from "./OntologyTurn";
import * as ontology from "./ontology";
vi.mock("./App", () => ({
  Notice: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("shows a saved conversational admission and restores its exact previous version", async () => {
  const claim = {
    id: "c",
    version: "v2",
    kind: "principle",
    statement: "原始资料留在自己手里",
    conditions: "AI 协作",
    state: "confirmed",
    core_status: "admitted",
    history: [{ version: "v1" }],
  } as ontology.OntologyClaim;
  const doc = { revision: "r", claims: [claim] } as ontology.PersonalOntology;
  vi.spyOn(ontology, "ontologyContext").mockResolvedValue({
    turn_id: "t",
    revision: "r",
    available: true,
    claims: [],
    updates: [
      { changed_id: "c", previous_version: "v1", core_effect: "admitted" },
    ],
  } as ontology.OntologyContext);
  vi.spyOn(ontology.ontologyApi, "get").mockResolvedValue(doc);
  const restored = {
    ...doc,
    claims: [{ ...claim, version: "v3", core_status: "pending" as const }],
  };
  const review = vi
    .spyOn(ontology, "verifiedCoreReview")
    .mockImplementation(async () => {
      vi.mocked(ontology.ontologyApi.get).mockResolvedValue(restored);
      return { status: "ready", ontology: restored };
    });
  const changed = vi.fn();
  window.addEventListener("zhijun-memory-changed", changed);
  render(
    <OntologyTurn threadId="thread" reply="已加入" replyId="reply" latest />,
  );
  await screen.findByText(/已加入本体/);
  expect(changed).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  await screen.findByText("已撤销这次更新");
  expect(review).toHaveBeenCalledWith(claim, {
    action: "restore",
    restore_version: "v1",
  });
  window.removeEventListener("zhijun-memory-changed", changed);
});
it("does not undo over a later owner edit", async () => {
  vi.spyOn(ontology, "ontologyContext").mockResolvedValue({
    available: true,
    claims: [],
    updates: [
      { changed_id: "c", previous_version: "v1", core_effect: "admitted" },
    ],
  } as unknown as ontology.OntologyContext);
  vi.spyOn(ontology.ontologyApi, "get").mockResolvedValue({
    claims: [{ id: "c", version: "v3", history: [{ version: "v2" }] }],
  } as ontology.PersonalOntology);
  const review = vi.spyOn(ontology, "verifiedCoreReview");
  render(
    <OntologyTurn threadId="thread" reply="已加入" replyId="reply" latest />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
  await screen.findByText("这项理解后来又有修改，请在用户画像里查看变化记录");
  expect(review).not.toHaveBeenCalled();
});
