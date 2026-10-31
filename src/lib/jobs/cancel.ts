import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { paypal, paypalErrorInfo } from "@/lib/paypal/client";
import { AgreementError, findJobByClientToken, type Job } from "./agreement";
import {
  cancelBlocker,
  canClientCancel,
  canFreelancerCancel,
  canRequestCancel,
  currentMilestone,
  deadlineState,
  EXTENSION_DAYS,
  extendedDueDates,
  GRACE_HOURS,
  type Allowed,
} from "./cancel-rules";
import { awaitingDecisionEvent } from "./delivery";
import { assertTransition } from "./status";
import { awaitingClientDecision, decideByFor } from "./tries";

/**
 * Cancelling a funded job. Rules live in cancel-rules.ts. The job is marked CANCELLED first, under
 * the same row lock a delivery takes, so a delivery and a cancel can't both win; the unused
 * PayPal hold is voided right after, and retried by the tick if PayPal is unavailable.
 */

type Milestone = typeof schema.milestones.$inferSelect;

/** Grace after a missed deadline: 24 hours, or the short demo window so judges can watch it. */
export function graceSeconds(job: Pick<Job, "isDemo">): number {
  return job.isDemo ? env().DEMO_REVIEW_WINDOW_SECONDS : GRACE_HOURS * 3600;
}

async function lockJob(tx: Tx, jobId: string) {
  const [job] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).for("update");
  if (!job) throw new AgreementError("Job not found.");
  const milestones = await tx.select().from(schema.milestones).where(eq(schema.milestones.jobId, jobId)).orderBy(asc(schema.milestones.position)).for("update");
  return { job, milestones };
}

function must(allowed: Allowed) {
  if (!allowed.ok) throw new AgreementError(allowed.reason);
}

type CancelledBy = "freelancer" | "client" | "both" | "system";

async function markCancelled(tx: Tx, job: Job, milestones: Milestone[], by: CancelledBy, reason: string) {
  // A capture still in flight would race the void; it settles within seconds.
  const [{ inFlight }] = await tx
    .select({ inFlight: sql<number>`count(*)::int` })
    .from(schema.payments)
    .where(and(eq(schema.payments.jobId, job.id), eq(schema.payments.type, "capture"), eq(schema.payments.status, "pending")));
  if (inFlight > 0) throw new AgreementError("A payment is still going through. Try again in a minute.");

  assertTransition(job.status, "CANCELLED");
  const now = new Date();
  await tx.update(schema.jobs).set({ status: "CANCELLED", cancelRequestedAt: null, cancelRequestNote: null }).where(eq(schema.jobs.id, job.id));
  for (const m of milestones) {
    if (m.status === "RELEASED" || m.status === "CLOSED") continue;
    await tx.update(schema.milestones).set({ status: "CLOSED", reviewEndsAt: null, settledAt: now }).where(eq(schema.milestones.id, m.id));
  }
  await tx.insert(schema.events).values({
    jobId: job.id,
    type: "job.cancelled",
    source: by === "client" ? "client" : by === "system" ? "system" : "freelancer",
    payload: { by, reason, releasedCents: job.capturedCents, returningCents: Math.max(0, job.authorizedCents - job.capturedCents) },
  });
}

/**
 * Release what's left of a cancelled job's hold back to the client. Idempotent: PayPal replays a
 * void with the same request id, and an already-voided hold counts as done.
 */
export async function voidCancelledHold(jobId: string): Promise<boolean> {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job || job.status !== "CANCELLED" || !job.paypalAuthorizationId) return false;
  const remaining = job.authorizedCents - job.capturedCents;
  if (remaining <= 0) return false;
  const [voided] = await db.select({ id: schema.payments.id }).from(schema.payments).where(and(eq(schema.payments.jobId, jobId), eq(schema.payments.type, "void")));
  if (voided) return false;

  const requestId = `vouch-void-${job.paypalAuthorizationId}`;
  try {
    await paypal().payments.voidPayment({ authorizationId: job.paypalAuthorizationId, paypalRequestId: requestId });
  } catch (err) {
    const e = paypalErrorInfo(err);
    if (e.issue !== "PREVIOUSLY_VOIDED" && e.issue !== "AUTHORIZATION_VOIDED") {
      console.error("[cancel] void failed; the tick will retry", jobId, e);
      return false;
    }
  }
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.payments)
      .values({ jobId, type: "void", status: "completed", amountCents: remaining, requestId, paypalId: job.paypalAuthorizationId, paypalStatus: "VOIDED" })
      .onConflictDoNothing()
      .returning({ id: schema.payments.id });
    if (row) await tx.insert(schema.events).values({ jobId, type: "payment.voided", source: "paypal", payload: { amountCents: remaining, reason: "cancelled" } });
  });
  return true;
}

async function afterCancel(jobId: string) {
  // Best effort now; the tick retries if PayPal is unavailable.
  await voidCancelledHold(jobId).catch((err) => console.error("[cancel] void", jobId, err));
}

/* ------------------------------------------------------------------ */
/* Freelancer                                                           */
/* ------------------------------------------------------------------ */

async function ownedJob(tx: Tx, ownerId: string, jobId: string) {
  const locked = await lockJob(tx, jobId);
  if (locked.job.ownerId !== ownerId) throw new AgreementError("Job not found.");
  return locked;
}

/** The freelancer walks away: always allowed outside a check, since they only give up unearned money. */
export async function freelancerCancel(ownerId: string, jobId: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { job, milestones } = await ownedJob(tx, ownerId, jobId);
    must(canFreelancerCancel(job.status, milestones));
    await markCancelled(tx, job, milestones, job.cancelRequestedAt ? "both" : "freelancer", reason.trim().slice(0, 1000) || "Cancelled by the freelancer");
  });
  await afterCancel(jobId);
}

/** Answer the client's request to cancel. */
export async function freelancerAnswerCancelRequest(ownerId: string, jobId: string, accept: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const { job, milestones } = await ownedJob(tx, ownerId, jobId);
    if (!job.cancelRequestedAt) throw new AgreementError("There's no cancellation request to answer. Reload the page.");
    if (accept) {
      must(canFreelancerCancel(job.status, milestones));
      await markCancelled(tx, job, milestones, "both", job.cancelRequestNote ?? "Cancelled by agreement");
    } else {
      await tx.update(schema.jobs).set({ cancelRequestedAt: null, cancelRequestNote: null }).where(eq(schema.jobs.id, job.id));
      await tx.insert(schema.events).values({ jobId: job.id, type: "job.cancel_declined", source: "freelancer", payload: {} });
    }
  });
  if (accept) await afterCancel(jobId);
}

/* ------------------------------------------------------------------ */
/* Client                                                               */
/* ------------------------------------------------------------------ */

async function clientJob(tx: Tx, token: string) {
  const found = await findJobByClientToken(token);
  if (!found) throw new AgreementError("This link is not valid.");
  return lockJob(tx, found.id);
}

/** Ask the freelancer to cancel. Nothing happens unless they accept: silence before a deadline means they're working. */
export async function clientRequestCancel(token: string, note: string): Promise<void> {
  const text = note.trim();
  if (text.length < 10) throw new AgreementError("Say why you want to cancel (at least a sentence).");
  await db.transaction(async (tx) => {
    const { job, milestones } = await clientJob(tx, token);
    must(canRequestCancel(job.status, milestones, Boolean(job.cancelRequestedAt)));
    await tx.update(schema.jobs).set({ cancelRequestedAt: new Date(), cancelRequestNote: text.slice(0, 1000) }).where(eq(schema.jobs.id, job.id));
    await tx.insert(schema.events).values({ jobId: job.id, type: "job.cancel_requested", source: "client", payload: { note: text.slice(0, 1000) } });
  });
}

export async function clientWithdrawCancelRequest(token: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { job } = await clientJob(tx, token);
    if (!job.cancelRequestedAt) return;
    await tx.update(schema.jobs).set({ cancelRequestedAt: null, cancelRequestNote: null }).where(eq(schema.jobs.id, job.id));
    await tx.insert(schema.events).values({ jobId: job.id, type: "job.cancel_withdrawn", source: "client", payload: {} });
  });
}

/** Cancel alone, after a missed deadline and its grace period. */
export async function clientCancel(token: string): Promise<void> {
  let jobId = "";
  await db.transaction(async (tx) => {
    const { job, milestones } = await clientJob(tx, token);
    jobId = job.id;
    must(canClientCancel(job.status, milestones, new Date(), graceSeconds(job)));
    const m = currentMilestone(milestones)!;
    await markCancelled(tx, job, milestones, "client", `M${m.position} wasn't delivered by its deadline`);
  });
  await afterCancel(jobId);
}

/**
 * End the project once the freelancer has used every try on the current milestone: by the client's
 * choice, or ("system") because the client didn't decide by the deadline. What isn't released goes
 * back to the client; later milestones never start.
 */
export async function endProject(jobId: string, by: "client" | "system"): Promise<boolean> {
  let ended = false;
  await db.transaction(async (tx) => {
    const { job, milestones } = await lockJob(tx, jobId);
    const m = currentMilestone(milestones);
    const waiting = job.status === "IN_PROGRESS" && m && awaitingClientDecision(m, job.maxResubmissions);
    if (!waiting) {
      if (by === "client") throw new AgreementError("That option isn't available for this milestone any more. Reload the page.");
      return;
    }
    if (by === "system" && (!m.decideBy || m.decideBy > new Date())) return;
    const reason = by === "client" ? `The client ended the project after M${m.position} wasn't accepted` : `The client didn't decide on M${m.position} in time`;
    await markCancelled(tx, job, milestones, by, reason);
    ended = true;
  });
  if (ended) await afterCancel(jobId);
  return ended;
}

/**
 * Keep the current milestone's decision clock right: start it if the freelancer is out of tries
 * (a backstop; settling and withdrawing start it straight away), clear it once that's no longer
 * so, and end the project when it runs out.
 */
export async function checkDecisionDeadline(job: Job): Promise<string | null> {
  if (job.status !== "IN_PROGRESS") return null;
  const milestones = await db.select().from(schema.milestones).where(eq(schema.milestones.jobId, job.id));
  const m = currentMilestone(milestones);
  if (!m) return null;
  const waiting = awaitingClientDecision(m, job.maxResubmissions);
  if (waiting && !m.decideBy) {
    const decideBy = decideByFor(job, new Date(), env().DEMO_REVIEW_WINDOW_SECONDS);
    await db.transaction(async (tx) => {
      await tx.update(schema.milestones).set({ decideBy }).where(eq(schema.milestones.id, m.id));
      await tx.insert(schema.events).values(awaitingDecisionEvent(job.id, m, decideBy));
    });
    return `M${m.position}: decision clock started`;
  }
  if (!waiting && m.decideBy) {
    await db.update(schema.milestones).set({ decideBy: null }).where(eq(schema.milestones.id, m.id));
    return null;
  }
  if (waiting && m.decideBy && m.decideBy <= new Date()) {
    return (await endProject(job.id, "system")) ? `ended: no decision on M${m.position}` : null;
  }
  return null;
}

/** Give the freelancer more time after a missed deadline. Later milestones move by the same amount. */
export async function clientExtendDeadline(token: string, days: number): Promise<void> {
  await db.transaction(async (tx) => {
    const { job, milestones } = await clientJob(tx, token);
    if (job.status !== "FUNDED" && job.status !== "IN_PROGRESS") throw new AgreementError("This job isn't in progress.");
    const result = extendedDueDates(milestones, days, new Date(), graceSeconds(job), job.authExpiresAt);
    if (!result.ok) throw new AgreementError(result.reason);
    for (const d of result.dueDates) await tx.update(schema.milestones).set({ dueAt: d.dueAt }).where(eq(schema.milestones.id, d.id));
    const m = currentMilestone(milestones)!;
    await tx.insert(schema.events).values({
      jobId: job.id,
      milestoneId: m.id,
      type: "milestone.deadline_extended",
      source: "client",
      payload: { position: m.position, days, dueAt: result.dueDates[0].dueAt.toISOString() },
    });
  });
}

/** Demo jobs only: move the current milestone's deadline to now, so judges can watch the grace period run out. */
export async function demoSkipToDeadline(token: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { job, milestones } = await clientJob(tx, token);
    if (!job.isDemo) throw new AgreementError("Only demo jobs can skip time.");
    const d = deadlineState(milestones, new Date(), graceSeconds(job));
    if (d.kind !== "on_time") throw new AgreementError("There's no upcoming deadline to skip to.");
    const now = new Date();
    const shift = now.getTime() - d.dueAt.getTime();
    // Later milestones keep their spacing.
    for (const m of milestones) {
      if (m.position < d.milestone!.position || !m.dueAt || m.status === "RELEASED" || m.status === "CLOSED") continue;
      await tx.update(schema.milestones).set({ dueAt: new Date(m.dueAt.getTime() + shift) }).where(eq(schema.milestones.id, m.id));
    }
    await tx.insert(schema.events).values({ jobId: job.id, milestoneId: d.milestone!.id, type: "demo.skipped_to_deadline", source: "client", payload: { position: d.milestone!.position } });
  });
}

/* ------------------------------------------------------------------ */
/* Tick                                                                 */
/* ------------------------------------------------------------------ */

/** Record once in the ledger that the current milestone's deadline passed with nothing delivered. */
export async function noteMissedDeadline(job: Job): Promise<boolean> {
  const milestones = await db.select().from(schema.milestones).where(eq(schema.milestones.jobId, job.id));
  const d = deadlineState(milestones, new Date(), graceSeconds(job));
  if (d.kind !== "grace" && d.kind !== "overdue") return false;
  const dueAt = d.dueAt.toISOString();
  const [seen] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.milestoneId, d.milestone!.id), eq(schema.events.type, "milestone.deadline_missed"), sql`${schema.events.payload}->>'dueAt' = ${dueAt}`));
  if (seen) return false;
  await db.insert(schema.events).values({
    jobId: job.id,
    milestoneId: d.milestone!.id,
    type: "milestone.deadline_missed",
    source: "system",
    payload: { position: d.milestone!.position, dueAt, graceEndsAt: d.graceEndsAt.toISOString() },
  });
  return true;
}

/** Money the client gets back if the job is cancelled now. */
export function cancelRefundCents(job: Pick<Job, "authorizedCents" | "capturedCents">): number {
  return Math.max(0, job.authorizedCents - job.capturedCents);
}

export const refundText = (job: Pick<Job, "authorizedCents" | "capturedCents">) => formatCents(cancelRefundCents(job));

/** What both pages need to show the deadline and the cancel options, computed on the server. */
export function cancelView(job: Job, milestones: Milestone[], now = new Date()) {
  const grace = graceSeconds(job);
  const d = deadlineState(milestones, now, grace);
  const live = job.status === "FUNDED" || job.status === "IN_PROGRESS";
  const extensionDays = EXTENSION_DAYS.filter((days) => extendedDueDates(milestones, days, now, grace, job.authExpiresAt).ok);
  return {
    live,
    deadline: d.kind,
    position: d.milestone?.position ?? null,
    dueAt: "dueAt" in d ? d.dueAt.toISOString() : null,
    graceEndsAt: "graceEndsAt" in d ? d.graceEndsAt.toISOString() : null,
    blocker: cancelBlocker(milestones),
    requestNote: job.cancelRequestedAt ? (job.cancelRequestNote ?? "") : null,
    refund: refundText(job),
    extensionDays,
    demo: job.isDemo,
  };
}
