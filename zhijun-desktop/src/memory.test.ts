import { expect, it } from "vitest";
import { dateBounds, recentSevenDays, stageReviewDraft } from "./memory";
it("uses the server's date across UTC midnight and a seven-day inclusive range", () => {
  expect(
    recentSevenDays("Asia/Shanghai", new Date("2026-09-30T20:00:00Z")),
  ).toEqual({ from: "2026-09-25", to: "2026-10-01" });
});
it("prepares an editable review request requiring pagination and evidence", () => {
  const draft = stageReviewDraft("2026-09-25", "2026-10-01", "Asia/Shanghai");
  expect(draft).toContain("date_from=2026-09-24T16:00:00.000Z");
  expect(draft).toContain("date_to=2026-10-01T16:00:00.000Z");
  expect(draft).toContain("分页");
  expect(draft).toContain("原话");
  expect(draft).toContain("尚未读完");
});
it("includes the complete final day across daylight saving changes", () => {
  expect(dateBounds("2026-03-08", "2026-03-08", "America/New_York")).toEqual({
    date_from: "2026-03-08T05:00:00.000Z",
    date_to: "2026-03-09T04:00:00.000Z",
  });
});
it("includes morning and evening on the selected Shanghai day, excluding neighboring days", () => {
  const bounds = dateBounds("2026-10-01", "2026-10-01", "Asia/Shanghai");
  const covered = (instant: string) =>
    new Date(instant).getTime() >= new Date(bounds.date_from!).getTime() &&
    new Date(instant).getTime() < new Date(bounds.date_to!).getTime();
  expect(covered("2026-09-30T23:59:59+08:00")).toBe(false);
  expect(covered("2026-10-01T08:30:00+08:00")).toBe(true);
  expect(covered("2026-10-01T23:59:59.999999+08:00")).toBe(true);
  expect(covered("2026-10-02T00:00:00+08:00")).toBe(false);
});
