import { describe, expect, it } from "vitest";
import { dueReminders, noticesForEvent, type NoticeContext } from "./notices";

const NOW = new Date("2026-11-10T12:00:00Z");
const HOUR = 3_600_000;
const job = { id: "job-1", status: "IN_PROGRESS" as const, fundingExpiresAt: null, agreedAt: null, isDemo: false, reviewWindowSeconds: 24 * 3600 };
const ctx: NoticeContext = { job, freelancer: "Sam Rivera", client: "Ember & Oak" };
const ev = (type: string, payload: Record<string, unknown>, source: "client" | "freelancer" | "system" | "ai" | "paypal" = "system") => ({ id: 42, type, source, payload });

describe("noticesForEvent", () => {
  it("tells the other side, not the one who acted", () => {
    expect(noticesForEvent(ev("delivery.submitted", { position: 1 }, "freelancer"), ctx).map((n) => n.party)).toEqual(["client"]);
    expect(noticesForEvent(ev("dispute.opened", { position: 2, note: "Looks broken on my phone" }, "client"), ctx).map((n) => n.party)).toEqual(["freelancer"]);
    expect(noticesForEvent(ev("brief.agreed", { version: 3 }, "client"), ctx).map((n) => n.party)).toEqual(["freelancer"]);
    expect(noticesForEvent(ev("brief.agreed", { version: 3 }, "freelancer"), ctx).map((n) => n.party)).toEqual(["client"]);
  });

  it("states amounts and what happens on silence", () => {
    const [client, freelancer] = noticesForEvent(ev("evaluation.completed", { position: 1, verdict: "PARTIAL", releaseNowCents: 9000 }, "ai"), ctx);
    expect(client.title).toBe("M1 checked: it partly passed");
    expect(client.body).toContain("If you do nothing, $90 is released");
    expect(freelancer.body).toContain("$90 is released when the client's review window closes");
  });

  it("only tells the freelancer about money that moved", () => {
    expect(noticesForEvent(ev("milestone.settled", { position: 1, how: "client: hold", releasedCents: 0, totalReleasedCents: 9000 }, "client"), ctx)).toEqual([]);
    const silence = noticesForEvent(ev("milestone.settled", { position: 1, how: "silence", releasedCents: 9000, totalReleasedCents: 9000 }), ctx);
    expect(silence.map((n) => [n.party, n.title])).toEqual([
      ["freelancer", "M1: $90 released"],
      ["client", "M1 settled"],
    ]);
  });

  it("routes cancellations by who cancelled", () => {
    const by = (who: string) => noticesForEvent(ev("job.cancelled", { by: who, releasedCents: 0, returningCents: 40000, reason: "M1 wasn't delivered by its deadline" }), ctx).map((n) => n.party);
    expect(by("client")).toEqual(["freelancer"]);
    expect(by("freelancer")).toEqual(["client"]);
    expect(by("both")).toEqual(["client"]);
  });

  it("gives every notice a key tied to its event and party", () => {
    const notices = noticesForEvent(ev("job.completed", { releasedCents: 30000, returnedCents: 10000 }), ctx);
    expect(notices.map((n) => n.dedupeKey)).toEqual(["ev:42:freelancer", "ev:42:client"]);
    expect(notices[1].body).toBe("$300 paid for delivered work; $100 released back to you.");
  });

  it("ignores events nobody needs telling about", () => {
    expect(noticesForEvent(ev("paypal.webhook", { eventType: "PAYMENT.CAPTURE.COMPLETED" }, "paypal"), ctx)).toEqual([]);
    expect(noticesForEvent(ev("brief.edited", { version: 2 }, "freelancer"), ctx)).toEqual([]);
  });
});

describe("dueReminders", () => {
  const m = (over: Partial<{ status: string; dueAt: Date | null; reviewEndsAt: Date | null }>) => ({
    id: "m1",
    position: 1,
    status: "PENDING" as const,
    dueAt: null,
    reviewEndsAt: null,
    ...over,
  }) as Parameters<typeof dueReminders>[1][number];
  const GRACE = 24 * 3600;

  it("reminds the client to fund at 24 and 48 hours", () => {
    const agreed = { ...job, status: "AGREED" as const, agreedAt: new Date(NOW.getTime() - 49 * HOUR), fundingExpiresAt: new Date(NOW.getTime() + 23 * HOUR) };
    expect(dueReminders(agreed, [], NOW, ctx, 86400, GRACE).map((n) => n.dedupeKey)).toEqual(["remind:fund:job-1:24", "remind:fund:job-1:48"]);
    const early = { ...agreed, agreedAt: new Date(NOW.getTime() - 2 * HOUR) };
    expect(dueReminders(early, [], NOW, ctx, 86400, GRACE)).toEqual([]);
  });

  it("reminds the client halfway through a review, then just before it closes", () => {
    const half = dueReminders(job, [m({ status: "REVIEW_WINDOW", reviewEndsAt: new Date(NOW.getTime() + 10 * HOUR) })], NOW, ctx, 86400, GRACE);
    expect(half.map((n) => n.title)).toEqual(["M1: half of the review window left"]);
    const soon = dueReminders(job, [m({ status: "REVIEW_WINDOW", reviewEndsAt: new Date(NOW.getTime() + 30 * 60_000) })], NOW, ctx, 86400, GRACE);
    expect(soon.map((n) => n.title)).toEqual(["M1: review closes soon"]);
    const early = dueReminders(job, [m({ status: "REVIEW_WINDOW", reviewEndsAt: new Date(NOW.getTime() + 20 * HOUR) })], NOW, ctx, 86400, GRACE);
    expect(early).toEqual([]);
  });

  it("reminds the freelancer a day before a deadline, and both sides once overdue", () => {
    expect(dueReminders(job, [m({ dueAt: new Date(NOW.getTime() + 5 * HOUR) })], NOW, ctx, 86400, GRACE).map((n) => n.party)).toEqual(["freelancer"]);
    expect(dueReminders(job, [m({ dueAt: new Date(NOW.getTime() + 30 * HOUR) })], NOW, ctx, 86400, GRACE)).toEqual([]);
    expect(dueReminders(job, [m({ dueAt: new Date(NOW.getTime() - 2 * HOUR) })], NOW, ctx, 86400, GRACE)).toEqual([]);
    expect(dueReminders(job, [m({ dueAt: new Date(NOW.getTime() - 25 * HOUR) })], NOW, ctx, 86400, GRACE).map((n) => n.party)).toEqual(["client", "freelancer"]);
  });

  it("a delivery under review is not late", () => {
    expect(dueReminders(job, [m({ status: "EVALUATING", dueAt: new Date(NOW.getTime() - 25 * HOUR) })], NOW, ctx, 86400, GRACE)).toEqual([]);
  });
});
