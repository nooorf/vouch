import type { schema } from "@/db";
import { clampWindowEnd } from "./hold-rules";

/**
 * How many times a milestone can be delivered, and what happens when the tries run out.
 *
 * - The freelancer has 1 + maxResubmissions tries of their own (an agreed term, 2 by default).
 *   Withdrawing a delivery skips the wait for its review, but it still counts as a try, so the
 *   limit can't be dodged by submitting, reading the AI's result and withdrawing.
 * - After that, only the client can give more tries, up to CLIENT_EXTRA_TRIES.
 * - With no tries left on an unsettled milestone, the client decides: another try, accept and
 *   pay, skip the milestone, or end the project. Silence for DECISION_DAYS ends the project and
 *   returns the unpaid money. The next milestone never opens on its own.
 *
 * Pure functions, no database: tested in tries.test.ts.
 */

type Milestone = Pick<typeof schema.milestones.$inferSelect, "status" | "attempts" | "extraTries" | "releasedCents">;

export const CLIENT_EXTRA_TRIES = 3;
export const DECISION_DAYS = 3;

/** States where the next delivery is owed (a first try, or a fix). */
const AWAITING_DELIVERY = new Set<Milestone["status"]>(["PENDING", "HELD", "PARTIAL_HELD"]);

export const triesAllowed = (maxResubmissions: number, m: Pick<Milestone, "extraTries">) => 1 + maxResubmissions + m.extraTries;
export const triesLeft = (maxResubmissions: number, m: Milestone) => Math.max(0, triesAllowed(maxResubmissions, m) - m.attempts);

/** Every try is used and the milestone is neither settled nor being checked: the client decides. */
export function awaitingClientDecision(m: Milestone, maxResubmissions: number): boolean {
  return AWAITING_DELIVERY.has(m.status) && m.attempts > 0 && triesLeft(maxResubmissions, m) === 0;
}

export const canGiveTry = (m: Milestone, maxResubmissions: number) => awaitingClientDecision(m, maxResubmissions) && m.extraTries < CLIENT_EXTRA_TRIES;

/** A delivery can be taken back while it's being checked or reviewed, but not once the client has disputed it. */
export function canWithdraw(m: Pick<Milestone, "status">): { ok: true } | { ok: false; reason: string } {
  if (m.status === "SUBMITTED" || m.status === "EVALUATING" || m.status === "REVIEW_WINDOW") return { ok: true };
  if (m.status === "DISPUTED") return { ok: false, reason: "The client disputed this delivery, so it can't be withdrawn now." };
  return { ok: false, reason: "There's no delivery under review to withdraw." };
}

/**
 * Where a milestone goes when its latest delivery drops out (withdrawn, or its check couldn't run):
 * back to waiting for a delivery, keeping what earlier deliveries settled.
 */
export function statusWithoutLatest(m: Pick<Milestone, "releasedCents">, earlierSettledDelivery: boolean): "PENDING" | "HELD" | "PARTIAL_HELD" {
  if (m.releasedCents > 0) return "PARTIAL_HELD";
  return earlierSettledDelivery ? "HELD" : "PENDING";
}

/** How long the client has to decide once the tries are used: 3 days, or the short demo window. */
export function decisionSeconds(job: { isDemo: boolean }, demoSeconds: number): number {
  return job.isDemo ? demoSeconds : DECISION_DAYS * 86_400;
}

/** The decide-by time for a milestone that just ran out of tries, never past the day before PayPal's hold ends. */
export function decideByFor(job: { isDemo: boolean; authExpiresAt: Date | null }, now: Date, demoSeconds: number): Date {
  return clampWindowEnd(new Date(now.getTime() + decisionSeconds(job, demoSeconds) * 1000), job.authExpiresAt, now);
}
