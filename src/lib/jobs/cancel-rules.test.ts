import { describe, expect, it } from "vitest";
import { canClientCancel, canFreelancerCancel, canRequestCancel, cancelBlocker, deadlineState, extendedDueDates } from "./cancel-rules";

const NOW = new Date("2026-11-10T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GRACE = 24 * 3600;

type Status = "PENDING" | "SUBMITTED" | "EVALUATING" | "REVIEW_WINDOW" | "DISPUTED" | "RELEASED" | "PARTIAL_HELD" | "HELD" | "CLOSED";
const ms = (...items: [Status, number | null][]) =>
  items.map(([status, dueOffsetMs], i) => ({ id: `m${i + 1}`, position: i + 1, status, dueAt: dueOffsetMs === null ? null : new Date(NOW.getTime() + dueOffsetMs) }));

describe("deadlineState", () => {
  it("is on time before the current milestone's deadline", () => {
    expect(deadlineState(ms(["PENDING", DAY]), NOW, GRACE).kind).toBe("on_time");
  });

  it("starts a grace period when the deadline passes, then becomes overdue", () => {
    const grace = deadlineState(ms(["PENDING", -HOUR]), NOW, GRACE);
    expect(grace.kind).toBe("grace");
    expect(grace.kind === "grace" && grace.graceEndsAt.getTime()).toBe(NOW.getTime() - HOUR + GRACE * 1000);
    expect(deadlineState(ms(["PENDING", -25 * HOUR]), NOW, GRACE).kind).toBe("overdue");
  });

  it("looks at the current milestone, skipping settled ones", () => {
    const d = deadlineState(ms(["RELEASED", -10 * DAY], ["PENDING", -25 * HOUR]), NOW, GRACE);
    expect(d).toMatchObject({ kind: "overdue", milestone: { position: 2 } });
  });

  it("a held milestone owes a fix, so it can be late too", () => {
    expect(deadlineState(ms(["HELD", -25 * HOUR]), NOW, GRACE).kind).toBe("overdue");
    expect(deadlineState(ms(["PARTIAL_HELD", -25 * HOUR]), NOW, GRACE).kind).toBe("overdue");
  });

  it("a delivery being checked or reviewed is never late: the freelancer delivered", () => {
    for (const s of ["SUBMITTED", "EVALUATING", "REVIEW_WINDOW", "DISPUTED"] as const) {
      expect(deadlineState(ms([s, -25 * HOUR]), NOW, GRACE).kind).toBe("none");
    }
  });
});

describe("who can cancel", () => {
  it("the freelancer can walk away any time outside a check", () => {
    expect(canFreelancerCancel("IN_PROGRESS", ms(["PENDING", DAY])).ok).toBe(true);
    expect(canFreelancerCancel("FUNDED", ms(["PENDING", DAY])).ok).toBe(true);
    expect(canFreelancerCancel("IN_PROGRESS", ms(["RELEASED", -DAY], ["EVALUATING", DAY])).ok).toBe(false);
    expect(canFreelancerCancel("COMPLETED", ms(["RELEASED", -DAY])).ok).toBe(false);
  });

  it("the client can't cancel alone before the deadline, or during the grace period", () => {
    const before = canClientCancel("IN_PROGRESS", ms(["PENDING", DAY]), NOW, GRACE);
    expect(before).toMatchObject({ ok: false, reason: expect.stringContaining("ask the freelancer") });
    const grace = canClientCancel("IN_PROGRESS", ms(["PENDING", -HOUR]), NOW, GRACE);
    expect(grace).toMatchObject({ ok: false, reason: expect.stringContaining("grace period") });
  });

  it("the client can cancel alone once the grace period is over", () => {
    expect(canClientCancel("IN_PROGRESS", ms(["PENDING", -25 * HOUR]), NOW, GRACE).ok).toBe(true);
  });

  it("a delivery during the grace period blocks the client's cancel", () => {
    expect(canClientCancel("IN_PROGRESS", ms(["EVALUATING", -25 * HOUR]), NOW, GRACE).ok).toBe(false);
    expect(canClientCancel("IN_PROGRESS", ms(["REVIEW_WINDOW", -25 * HOUR]), NOW, GRACE).ok).toBe(false);
  });

  it("the client can ask once, outside a check", () => {
    expect(canRequestCancel("IN_PROGRESS", ms(["PENDING", DAY]), false).ok).toBe(true);
    expect(canRequestCancel("IN_PROGRESS", ms(["PENDING", DAY]), true).ok).toBe(false);
    expect(canRequestCancel("IN_PROGRESS", ms(["DISPUTED", DAY]), false).ok).toBe(false);
    expect(canRequestCancel("AGREED", [], false).ok).toBe(false);
  });

  it("names the milestone that blocks", () => {
    expect(cancelBlocker(ms(["RELEASED", 0], ["REVIEW_WINDOW", DAY]))).toContain("M2 is in review");
    expect(cancelBlocker(ms(["PENDING", DAY]))).toBeNull();
  });
});

describe("extendedDueDates", () => {
  const auth = new Date(NOW.getTime() + 20 * DAY);

  it("gives the current milestone the extra days from now and shifts later ones equally", () => {
    const res = extendedDueDates(ms(["RELEASED", -5 * DAY], ["PENDING", -25 * HOUR], ["PENDING", 3 * DAY]), 3, NOW, GRACE, auth);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.dueDates).toEqual([
      { id: "m2", dueAt: new Date(NOW.getTime() + 3 * DAY) },
      { id: "m3", dueAt: new Date(NOW.getTime() + 3 * DAY + 3 * DAY + 25 * HOUR) },
    ]);
  });

  it("only extends a missed deadline, by an allowed amount", () => {
    expect(extendedDueDates(ms(["PENDING", DAY]), 3, NOW, GRACE, auth).ok).toBe(false);
    expect(extendedDueDates(ms(["PENDING", -HOUR]), 2, NOW, GRACE, auth).ok).toBe(false);
    expect(extendedDueDates(ms(["PENDING", -HOUR]), 1, NOW, GRACE, auth).ok).toBe(true);
  });

  it("refuses to run past PayPal's hold", () => {
    const soon = new Date(NOW.getTime() + 6 * DAY);
    expect(extendedDueDates(ms(["PENDING", -HOUR]), 7, NOW, GRACE, soon)).toMatchObject({ ok: false, reason: expect.stringContaining("PayPal's hold") });
    expect(extendedDueDates(ms(["PENDING", -HOUR]), 1, NOW, GRACE, soon).ok).toBe(true);
  });
});
