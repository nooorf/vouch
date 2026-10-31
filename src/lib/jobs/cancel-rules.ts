import type { schema } from "@/db";

/**
 * When a funded job can be cancelled. Before a deadline, Vouch can't tell a freelancer working
 * quietly from one who vanished, so only an agreed fact counts: the milestone due dates in the
 * brief both sides accepted.
 *
 * - The freelancer can cancel at any time (they only give up money they haven't earned).
 * - The client can ask to cancel; it happens only if the freelancer accepts.
 * - Once the current milestone's deadline has passed with nothing delivered, and a grace period
 *   has run out, the client can cancel alone, or extend the deadline.
 *
 * Pure functions, no database: tested in cancel-rules.test.ts.
 */

type Milestone = Pick<typeof schema.milestones.$inferSelect, "id" | "position" | "status" | "dueAt">;

/** How long the freelancer has after a missed deadline before the client can cancel alone. */
export const GRACE_HOURS = 24;
/** Extensions the client can give, in days. */
export const EXTENSION_DAYS = [1, 3, 7] as const;
/** Every deadline (plus grace) must end this long before PayPal's hold expires. */
export const AUTH_SAFETY_DAYS = 2;

const SETTLED = new Set<Milestone["status"]>(["RELEASED", "CLOSED"]);
/** States where a delivery is being checked or reviewed: a cancel would cut a verdict short. */
const MID_CHECK = new Set<Milestone["status"]>(["SUBMITTED", "EVALUATING", "REVIEW_WINDOW", "DISPUTED"]);
/** States where the freelancer owes a delivery (first try, or a fix). */
const AWAITING_DELIVERY = new Set<Milestone["status"]>(["PENDING", "HELD", "PARTIAL_HELD"]);

/** The milestone being worked on: the first one that isn't settled. */
export function currentMilestone<M extends Milestone>(milestones: M[]): M | undefined {
  return [...milestones].sort((a, b) => a.position - b.position).find((m) => !SETTLED.has(m.status));
}

/** Why nothing can be cancelled right now, or null. */
export function cancelBlocker(milestones: Milestone[]): string | null {
  const busy = milestones.find((m) => MID_CHECK.has(m.status));
  if (!busy) return null;
  return busy.status === "SUBMITTED" || busy.status === "EVALUATING"
    ? `M${busy.position} is being checked. Cancelling opens again once its result is settled.`
    : `M${busy.position} is in review. Cancelling opens again once it's settled.`;
}

export type DeadlineState =
  | { kind: "none" }
  | { kind: "on_time"; dueAt: Date }
  | { kind: "grace"; dueAt: Date; graceEndsAt: Date }
  | { kind: "overdue"; dueAt: Date; graceEndsAt: Date };

/** Where the current milestone stands against its deadline. Only a milestone still owed a delivery can be late. */
export function deadlineState(milestones: Milestone[], now: Date, graceSeconds: number): DeadlineState & { milestone?: Milestone } {
  const m = currentMilestone(milestones);
  if (!m?.dueAt || !AWAITING_DELIVERY.has(m.status)) return { kind: "none", milestone: m };
  if (m.dueAt > now) return { kind: "on_time", dueAt: m.dueAt, milestone: m };
  const graceEndsAt = new Date(m.dueAt.getTime() + graceSeconds * 1000);
  return graceEndsAt > now ? { kind: "grace", dueAt: m.dueAt, graceEndsAt, milestone: m } : { kind: "overdue", dueAt: m.dueAt, graceEndsAt, milestone: m };
}

export type Allowed = { ok: true } | { ok: false; reason: string };

const LIVE = new Set(["FUNDED", "IN_PROGRESS"]);

/** The freelancer walking away. */
export function canFreelancerCancel(jobStatus: string, milestones: Milestone[]): Allowed {
  if (!LIVE.has(jobStatus)) return { ok: false, reason: "Only a funded job in progress can be cancelled." };
  const blocked = cancelBlocker(milestones);
  return blocked ? { ok: false, reason: blocked } : { ok: true };
}

/** The client cancelling alone: only after a missed deadline and its grace period. */
export function canClientCancel(jobStatus: string, milestones: Milestone[], now: Date, graceSeconds: number): Allowed {
  if (!LIVE.has(jobStatus)) return { ok: false, reason: "Only a funded job in progress can be cancelled." };
  const blocked = cancelBlocker(milestones);
  if (blocked) return { ok: false, reason: blocked };
  const d = deadlineState(milestones, now, graceSeconds);
  if (d.kind === "overdue") return { ok: true };
  if (d.kind === "grace") return { ok: false, reason: "The deadline has passed, but the freelancer still has a grace period to deliver." };
  return { ok: false, reason: "The deadline hasn't passed. You can ask the freelancer to cancel instead." };
}

/** The client asking the freelancer to cancel (any time a cancel could happen). */
export function canRequestCancel(jobStatus: string, milestones: Milestone[], alreadyRequested: boolean): Allowed {
  if (!LIVE.has(jobStatus)) return { ok: false, reason: "Only a funded job in progress can be cancelled." };
  if (alreadyRequested) return { ok: false, reason: "You've already asked. The freelancer can accept or decline." };
  const blocked = cancelBlocker(milestones);
  return blocked ? { ok: false, reason: blocked } : { ok: true };
}

/**
 * New due dates after the client extends a missed deadline by `days`: the current milestone and
 * every later unsettled one move by the same amount, so their order and spacing stay as agreed.
 * Refused if the last one (plus grace) would end too close to the hold's expiry.
 */
export function extendedDueDates(
  milestones: Milestone[],
  days: number,
  now: Date,
  graceSeconds: number,
  authExpiresAt: Date | null,
): { ok: true; dueDates: { id: string; dueAt: Date }[] } | { ok: false; reason: string } {
  if (!EXTENSION_DAYS.includes(days as (typeof EXTENSION_DAYS)[number])) return { ok: false, reason: "Pick 1, 3 or 7 days." };
  const d = deadlineState(milestones, now, graceSeconds);
  if (d.kind !== "grace" && d.kind !== "overdue") return { ok: false, reason: "Only a missed deadline can be extended." };
  const current = d.milestone!;
  // From now, not from the old date: an extension gives the freelancer `days` more from today.
  const shift = now.getTime() + days * 86_400_000 - current.dueAt!.getTime();
  const later = milestones.filter((m) => m.position >= current.position && !SETTLED.has(m.status) && m.dueAt);
  const dueDates = later.map((m) => ({ id: m.id, dueAt: new Date(m.dueAt!.getTime() + shift) }));
  const last = Math.max(...dueDates.map((x) => x.dueAt.getTime()));
  if (authExpiresAt && last + graceSeconds * 1000 > authExpiresAt.getTime() - AUTH_SAFETY_DAYS * 86_400_000) {
    return { ok: false, reason: `That would run past PayPal's hold on this payment (it ends ${authExpiresAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}). Try a shorter extension, or cancel.` };
  }
  return { ok: true, dueDates };
}
