import { describe, expect, it } from "vitest";
import type { schema } from "@/db";
import { noticesForEvent } from "@/lib/notify/notices";
import { choicesFor } from "./choice-views";
import { awaitingClientDecision, canGiveTry, canWithdraw, CLIENT_EXTRA_TRIES, decideByFor, statusWithoutLatest, triesAllowed, triesLeft } from "./tries";

type Milestone = typeof schema.milestones.$inferSelect;
type Evaluation = typeof schema.evaluations.$inferSelect;

const MAX_RESUBMISSIONS = 1; // the default: 2 tries of the freelancer's own
const m = (over: Partial<Milestone>) => ({ status: "HELD", attempts: 1, extraTries: 0, releasedCents: 0, ...over }) as Milestone;
const doneEv = (verdict: Evaluation["verdict"]) => ({ status: "done", verdict }) as Evaluation;

describe("tries", () => {
  it("gives the freelancer 1 + maxResubmissions tries, plus what the client adds", () => {
    expect(triesAllowed(MAX_RESUBMISSIONS, m({}))).toBe(2);
    expect(triesAllowed(MAX_RESUBMISSIONS, m({ extraTries: 3 }))).toBe(5);
    expect(triesLeft(MAX_RESUBMISSIONS, m({ attempts: 2 }))).toBe(0);
    expect(triesLeft(MAX_RESUBMISSIONS, m({ attempts: 2, extraTries: 1 }))).toBe(1);
  });

  it("waits on the client only when every try is used and nothing is under review", () => {
    expect(awaitingClientDecision(m({ attempts: 1 }), MAX_RESUBMISSIONS)).toBe(false); // one try left
    expect(awaitingClientDecision(m({ attempts: 2 }), MAX_RESUBMISSIONS)).toBe(true);
    expect(awaitingClientDecision(m({ attempts: 2, status: "PARTIAL_HELD" }), MAX_RESUBMISSIONS)).toBe(true);
    expect(awaitingClientDecision(m({ attempts: 2, status: "PENDING" }), MAX_RESUBMISSIONS)).toBe(true); // both withdrawn
    expect(awaitingClientDecision(m({ attempts: 2, status: "REVIEW_WINDOW" }), MAX_RESUBMISSIONS)).toBe(false);
    expect(awaitingClientDecision(m({ attempts: 2, status: "DISPUTED" }), MAX_RESUBMISSIONS)).toBe(false);
    expect(awaitingClientDecision(m({ attempts: 2, status: "RELEASED" }), MAX_RESUBMISSIONS)).toBe(false);
    expect(awaitingClientDecision(m({ attempts: 0, status: "PENDING" }), 0)).toBe(false); // nothing delivered yet
  });

  it("caps the client's extra tries, for at most 5 tries in all", () => {
    expect(canGiveTry(m({ attempts: 2 }), MAX_RESUBMISSIONS)).toBe(true);
    expect(canGiveTry(m({ attempts: 2 + CLIENT_EXTRA_TRIES, extraTries: CLIENT_EXTRA_TRIES }), MAX_RESUBMISSIONS)).toBe(false);
    expect(triesAllowed(MAX_RESUBMISSIONS, m({ extraTries: CLIENT_EXTRA_TRIES }))).toBe(5);
  });

  it("lets a delivery be withdrawn while it's checked or reviewed, not once disputed", () => {
    expect(canWithdraw({ status: "EVALUATING" }).ok).toBe(true);
    expect(canWithdraw({ status: "REVIEW_WINDOW" }).ok).toBe(true);
    expect(canWithdraw({ status: "DISPUTED" }).ok).toBe(false);
    expect(canWithdraw({ status: "HELD" }).ok).toBe(false);
    expect(canWithdraw({ status: "RELEASED" }).ok).toBe(false);
  });

  it("goes back to what earlier deliveries settled when the latest one drops out", () => {
    expect(statusWithoutLatest({ releasedCents: 0 }, false)).toBe("PENDING");
    expect(statusWithoutLatest({ releasedCents: 0 }, true)).toBe("HELD");
    expect(statusWithoutLatest({ releasedCents: 5000 }, true)).toBe("PARTIAL_HELD");
  });

  it("gives the client 3 days to decide, never past the day before PayPal's hold ends", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(decideByFor({ isDemo: false, authExpiresAt: null }, now, 120).toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(decideByFor({ isDemo: true, authExpiresAt: null }, now, 120).toISOString()).toBe("2026-11-01T00:02:00.000Z");
    const holdEnds = new Date("2026-11-03T00:00:00Z");
    expect(decideByFor({ isDemo: false, authExpiresAt: holdEnds }, now, 120).getTime()).toBeLessThan(holdEnds.getTime());
  });
});

describe("the client's choices", () => {
  it("lets the freelancer fix a failed milestone while tries are left; the client can still pay or skip", () => {
    expect(choicesFor(m({ attempts: 1 }), doneEv("FAIL"), MAX_RESUBMISSIONS)).toEqual(["release_all", "close"]);
  });

  it("puts the client in charge once the tries are used", () => {
    expect(choicesFor(m({ attempts: 2 }), doneEv("FAIL"), MAX_RESUBMISSIONS)).toEqual(["another_try", "release_all", "close", "end_project"]);
    const exhausted = m({ attempts: 5, extraTries: CLIENT_EXTRA_TRIES });
    expect(choicesFor(exhausted, doneEv("FAIL"), MAX_RESUBMISSIONS)).toEqual(["release_all", "close", "end_project"]);
  });

  it("never offers ending the project during a review or a dispute", () => {
    expect(choicesFor(m({ attempts: 2, status: "REVIEW_WINDOW" }), doneEv("FAIL"), MAX_RESUBMISSIONS)).toEqual(["release_all"]);
    expect(choicesFor(m({ attempts: 2, status: "DISPUTED", reevaluated: true }), doneEv("PASS"), MAX_RESUBMISSIONS)).toEqual(["release_all", "release_earned", "hold"]);
  });

  it("has nothing to decide on a first delivery that was withdrawn with tries left", () => {
    expect(choicesFor(m({ attempts: 1, status: "PENDING" }), doneEv("FAIL"), MAX_RESUBMISSIONS)).toEqual([]);
  });
});

describe("notices", () => {
  const ctx = { job: { id: "j", status: "IN_PROGRESS", fundingExpiresAt: null, agreedAt: null, isDemo: false, reviewWindowSeconds: 86400 }, freelancer: "Ana", client: "the client" } as const;
  const ev = (type: string, payload: Record<string, unknown>, source = "system") => ({ id: 1, type, source, payload }) as never;

  it("tells both sides when the client must decide, and by when", () => {
    const out = noticesForEvent(ev("milestone.awaiting_decision", { position: 2, decideBy: "2026-11-04T00:00:00.000Z" }), ctx);
    expect(out.map((n) => n.party)).toEqual(["client", "freelancer"]);
    expect(out[0].body).toMatch(/project ends/);
  });

  it("tells both sides when silence ended the project", () => {
    const out = noticesForEvent(ev("job.cancelled", { by: "system", reason: "The client didn't decide on M2 in time", releasedCents: 0, returningCents: 40000 }), ctx);
    expect(out.map((n) => n.party).sort()).toEqual(["client", "freelancer"]);
    expect(out[0].title).toBe("The project ended");
  });

  it("warns the freelancer when a failed check was their last try", () => {
    const [, toFreelancer] = noticesForEvent(ev("evaluation.completed", { position: 1, verdict: "FAIL", releaseNowCents: 0, triesLeft: 0 }, "ai"), ctx);
    expect(toFreelancer.body).toMatch(/last try/);
  });
});
