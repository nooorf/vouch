import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { paypal, paypalErrorInfo, usd } from "@/lib/paypal/client";
import { HONOR_PERIOD_DAYS } from "@/lib/paypal/funding";
import {
  assertCaptureAllowed,
  captureRequestId,
  resolveWindow,
  statusAfterRelease,
  targetForChoice,
  type ClientChoice,
  type Evaluation as PolicyEvaluation,
} from "@/lib/policy/policy";
import { AgreementError, findJobByClientToken, type Job } from "./agreement";
import { endProject } from "./cancel";
import { awaitingDecisionEvent } from "./delivery";
import { clampWindowEnd } from "./hold-rules";
import { assertTransition } from "./status";
import { enqueue } from "./tasks";
import { choicesFor } from "./choice-views";
import { awaitingClientDecision, canGiveTry, CLIENT_EXTRA_TRIES, decideByFor } from "./tries";

/**
 * Moving money. Every capture is reserved before PayPal is called (a pending payment row with a
 * deterministic PayPal-Request-Id, and the amount counted against the authorization), then
 * confirmed or rolled back. Two simultaneous releases can't both happen, a retry returns
 * PayPal's original capture, and nothing is ever captured above what the client authorized.
 */

type Milestone = typeof schema.milestones.$inferSelect;
type Evaluation = typeof schema.evaluations.$inferSelect;

const DAY = 86_400_000;
const NEEDS_HUMAN_EXTENSION_HOURS = 24 * 7;

const SETTLED = new Set<Milestone["status"]>(["RELEASED", "CLOSED"]);

function windowSeconds(job: Job) {
  return job.isDemo ? env().DEMO_REVIEW_WINDOW_SECONDS : job.reviewWindowSeconds;
}

function asPolicyEvaluation(ev: Evaluation): PolicyEvaluation {
  return {
    verdict: ev.verdict!,
    earnedCents: ev.earnedCents ?? 0,
    releaseNowCents: ev.releaseNowCents ?? 0,
    heldCents: 0,
    silenceReleaseCents: ev.silenceReleaseCents ?? 0,
    passedWeight: 0,
    totalWeight: 0,
    reasons: ev.reasons ?? [],
    fixList: ev.fixList ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Captures                                                             */
/* ------------------------------------------------------------------ */

/** Reauthorize once after the 3-day honor period, so later captures stay guaranteed. */
async function reauthorizeIfNeeded(job: Job) {
  if (!job.honorExpiresAt || job.honorExpiresAt > new Date() || !job.paypalAuthorizationId) return;
  const [done] = await db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(and(eq(schema.payments.jobId, job.id), eq(schema.payments.type, "reauthorize")));
  if (done) return; // PayPal allows one reauthorization per authorization
  const remaining = job.authorizedCents - job.capturedCents;
  if (remaining <= 0) return;
  try {
    const { result } = await paypal().payments.reauthorizePayment({
      authorizationId: job.paypalAuthorizationId,
      paypalRequestId: `vouch-reauth-${job.paypalAuthorizationId}`,
      body: { amount: usd(remaining) },
    });
    await db.transaction(async (tx) => {
      await tx.insert(schema.payments).values({
        jobId: job.id,
        type: "reauthorize",
        status: "completed",
        amountCents: remaining,
        requestId: `vouch-reauth-${job.paypalAuthorizationId}`,
        paypalId: result.id,
        paypalStatus: result.status,
      });
      await tx
        .update(schema.jobs)
        .set({ paypalAuthorizationId: result.id!, honorExpiresAt: new Date(Date.now() + HONOR_PERIOD_DAYS * DAY) })
        .where(eq(schema.jobs.id, job.id));
      await tx.insert(schema.events).values({ jobId: job.id, type: "payment.reauthorized", source: "paypal", payload: { authorizationId: result.id, amountCents: remaining } });
    });
  } catch (err) {
    // Capturing after the honor period can still succeed; it just isn't guaranteed.
    console.warn("[settle] reauthorize failed", job.id, paypalErrorInfo(err));
  }
}

/**
 * Bring a milestone's released total up to `targetTotal` with one capture. The amount is worked out
 * under a lock on the milestone, counting captures still in flight, so two simultaneous releases
 * (say, the client approving as the window closes) can't both pay. Returns the amount captured.
 */
async function capture(jobId: string, milestoneId: string, targetTotal: number, reason: string): Promise<number> {
  const [before] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  await reauthorizeIfNeeded(before);

  // 1. Reserve.
  const reserved = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).for("update");
    // Cancelled (or otherwise ended) while this release was on its way: never capture after a cancel.
    if (job.status !== "FUNDED" && job.status !== "IN_PROGRESS") throw new AgreementError("This job has ended, so nothing more can be released.");
    const [m] = await tx.select().from(schema.milestones).where(eq(schema.milestones.id, milestoneId)).for("update");
    const [{ inFlight }] = await tx
      .select({ inFlight: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int` })
      .from(schema.payments)
      .where(and(eq(schema.payments.milestoneId, milestoneId), eq(schema.payments.type, "capture"), eq(schema.payments.status, "pending")));
    const amountCents = Math.min(m.amountCents, targetTotal) - m.releasedCents - inFlight;
    if (amountCents <= 0) return null;
    assertCaptureAllowed({ authorizedCents: job.authorizedCents, capturedCents: job.capturedCents, captureCents: amountCents });
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.payments)
      .where(and(eq(schema.payments.milestoneId, milestoneId), eq(schema.payments.type, "capture")));
    const requestId = captureRequestId(milestoneId, n);
    const [payment] = await tx
      .insert(schema.payments)
      .values({ jobId, milestoneId, type: "capture", status: "pending", amountCents, requestId })
      .returning();
    await tx.update(schema.jobs).set({ capturedCents: job.capturedCents + amountCents }).where(eq(schema.jobs.id, jobId));
    return { payment, amountCents, authorizationId: job.paypalAuthorizationId! };
  });
  if (!reserved) return 0;
  const { amountCents } = reserved;

  // 2. Call PayPal (outside any transaction; the request id makes retries safe).
  try {
    const { result } = await paypal().payments.captureAuthorizedPayment({
      authorizationId: reserved.authorizationId,
      paypalRequestId: reserved.payment.requestId,
      prefer: "return=representation",
      body: { amount: usd(amountCents), finalCapture: false, invoiceId: reserved.payment.requestId, noteToPayer: reason.slice(0, 255) },
    });
    await confirmCapture(reserved.payment.id, result.id!, result.status ?? "COMPLETED");
    return amountCents;
  } catch (err) {
    const e = paypalErrorInfo(err);
    console.error("[settle] capture failed", jobId, milestoneId, e);
    await db.transaction(async (tx) => {
      await tx.update(schema.payments).set({ status: "failed", error: e as unknown as Record<string, unknown> }).where(eq(schema.payments.id, reserved.payment.id));
      await tx.update(schema.jobs).set({ capturedCents: sql`${schema.jobs.capturedCents} - ${amountCents}` }).where(eq(schema.jobs.id, jobId));
      await tx.insert(schema.events).values({ jobId, milestoneId, type: "payment.capture_failed", source: "paypal", payload: { amountCents, issue: e.issue, debugId: e.debugId } });
    });
    throw new AgreementError(`PayPal couldn't release ${formatCents(amountCents)} right now${e.issue ? ` (${e.issue})` : ""}. Nothing was charged; please try again.`);
  }
}

/** 3. Confirm: the money left the hold. */
async function confirmCapture(paymentId: string, captureId: string, paypalStatus: string) {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).for("update");
    if (p.status !== "pending") return; // already confirmed (e.g. by recovery)
    await tx
      .update(schema.payments)
      .set({ status: paypalStatus === "COMPLETED" ? "completed" : "pending_paypal", paypalId: captureId, paypalStatus })
      .where(eq(schema.payments.id, paymentId));
    await tx
      .update(schema.milestones)
      .set({ releasedCents: sql`${schema.milestones.releasedCents} + ${p.amountCents}` })
      .where(eq(schema.milestones.id, p.milestoneId!));
    await tx.insert(schema.events).values({
      jobId: p.jobId,
      milestoneId: p.milestoneId,
      type: "payment.captured",
      source: "paypal",
      payload: { amountCents: p.amountCents, captureId, status: paypalStatus },
    });
  });
}

/** Finish captures interrupted by a crash: retry with the same request id (PayPal returns the original). */
export async function recoverPendingCaptures(jobId: string): Promise<number> {
  const stale = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.jobId, jobId), eq(schema.payments.type, "capture"), eq(schema.payments.status, "pending"), lt(schema.payments.createdAt, new Date(Date.now() - 2 * 60_000))));
  if (!stale.length) return 0;
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  for (const p of stale) {
    try {
      const { result } = await paypal().payments.captureAuthorizedPayment({
        authorizationId: job.paypalAuthorizationId!,
        paypalRequestId: p.requestId,
        prefer: "return=representation",
        body: { amount: usd(p.amountCents), finalCapture: false, invoiceId: p.requestId },
      });
      await confirmCapture(p.id, result.id!, result.status ?? "COMPLETED");
      const [m] = await db.select().from(schema.milestones).where(eq(schema.milestones.id, p.milestoneId!));
      if (m && m.status !== "CLOSED" && m.status !== "DISPUTED" && m.status !== "EVALUATING") {
        await db.update(schema.milestones).set({ status: statusAfterRelease(m.amountCents, m.releasedCents) }).where(eq(schema.milestones.id, m.id));
      }
    } catch (err) {
      console.error("[settle] recovery failed", p.id, paypalErrorInfo(err));
    }
  }
  return stale.length;
}

/* ------------------------------------------------------------------ */
/* Outcomes                                                             */
/* ------------------------------------------------------------------ */

async function release(job: Job, m: Milestone, targetTotal: number, how: string, nextStatus?: Milestone["status"]) {
  const delta = await capture(job.id, m.id, targetTotal, `Vouch: ${job.title} · M${m.position} ${m.title}`);
  const [fresh] = await db.select().from(schema.milestones).where(eq(schema.milestones.id, m.id));
  const status = nextStatus ?? statusAfterRelease(fresh.amountCents, fresh.releasedCents);
  // Held with every try used: the client's decision clock starts now.
  const now = new Date();
  const decideBy = awaitingClientDecision({ ...fresh, status }, job.maxResubmissions) ? decideByFor(job, now, env().DEMO_REVIEW_WINDOW_SECONDS) : null;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.milestones)
      .set({ status, reviewEndsAt: null, decideBy, settledAt: status === "RELEASED" || status === "CLOSED" ? now : null })
      .where(eq(schema.milestones.id, m.id));
    if (decideBy) await tx.insert(schema.events).values(awaitingDecisionEvent(job.id, m, decideBy));
    await tx.insert(schema.events).values({
      jobId: job.id,
      milestoneId: m.id,
      type: "milestone.settled",
      source: how.startsWith("client") ? "client" : "system",
      payload: { position: m.position, how, releasedCents: delta, totalReleasedCents: fresh.releasedCents, status },
    });
  });
  await completeIfDone(job.id);
}

/** Every milestone released or closed: void what's left of the hold and complete the job. */
export async function completeIfDone(jobId: string) {
  const milestones = await db.select().from(schema.milestones).where(eq(schema.milestones.jobId, jobId));
  if (!milestones.length || !milestones.every((m) => SETTLED.has(m.status))) return;
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  // A cancelled job's milestones are all closed too; its hold is voided by voidCancelledHold.
  if (job.status !== "FUNDED" && job.status !== "IN_PROGRESS") return;

  const remaining = job.authorizedCents - job.capturedCents;
  let voidedCents = 0;
  if (remaining > 0 && job.paypalAuthorizationId) {
    const requestId = `vouch-void-${job.paypalAuthorizationId}`;
    try {
      await paypal().payments.voidPayment({ authorizationId: job.paypalAuthorizationId, paypalRequestId: requestId });
      voidedCents = remaining;
      await db
        .insert(schema.payments)
        .values({ jobId, type: "void", status: "completed", amountCents: remaining, requestId, paypalId: job.paypalAuthorizationId, paypalStatus: "VOIDED" })
        .onConflictDoNothing();
    } catch (err) {
      const e = paypalErrorInfo(err);
      if (e.issue !== "PREVIOUSLY_VOIDED" && e.issue !== "AUTHORIZATION_VOIDED") {
        console.error("[settle] void failed", jobId, e);
        return; // try again on the next tick
      }
      voidedCents = remaining;
    }
  }
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).for("update");
    if (locked.status === "COMPLETED") return;
    assertTransition(locked.status, "COMPLETED");
    await tx.update(schema.jobs).set({ status: "COMPLETED" }).where(eq(schema.jobs.id, jobId));
    await tx.insert(schema.events).values({
      jobId,
      type: "job.completed",
      source: "system",
      payload: { releasedCents: locked.capturedCents, returnedCents: voidedCents },
    });
  });
}

/* ------------------------------------------------------------------ */
/* The silence rule                                                     */
/* ------------------------------------------------------------------ */

/** Run by the "settle" task once a review (or post-dispute decision) window has closed. */
export async function settleExpiredWindow(milestoneId: string): Promise<void> {
  const [row] = await db
    .select({ m: schema.milestones, job: schema.jobs, ev: schema.evaluations })
    .from(schema.milestones)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.milestones.jobId))
    .leftJoin(schema.evaluations, eq(schema.evaluations.id, schema.milestones.currentEvaluationId))
    .where(eq(schema.milestones.id, milestoneId));
  if (!row?.ev || row.ev.status !== "done" || !row.m.reviewEndsAt || row.m.reviewEndsAt > new Date()) return;
  const { m, job, ev } = row;
  if (m.status !== "REVIEW_WINDOW" && !(m.status === "DISPUTED" && m.reevaluated)) return;

  const outcome = resolveWindow({
    evaluation: asPolicyEvaluation(ev),
    milestoneAmountCents: m.amountCents,
    alreadyReleasedCents: m.releasedCents,
    clientAction: { type: "none" },
    // After a dispute's re-check there's no second extension: silence executes it.
    alreadyExtended: m.windowExtended || m.status === "DISPUTED",
    alreadyReevaluated: m.reevaluated,
    extensionHours: NEEDS_HUMAN_EXTENSION_HOURS,
  });

  if (outcome.action === "extend") {
    const seconds = job.isDemo ? windowSeconds(job) : outcome.hours * 3600;
    await db.transaction(async (tx) => {
      // Never past the day before PayPal's hold ends.
      const endsAt = clampWindowEnd(new Date(Date.now() + seconds * 1000), job.authExpiresAt, new Date());
      await tx.update(schema.milestones).set({ windowExtended: true, reviewEndsAt: endsAt }).where(eq(schema.milestones.id, m.id));
      await tx.insert(schema.events).values({ jobId: job.id, milestoneId: m.id, type: "review.extended", source: "system", payload: { position: m.position, seconds } });
    });
    return;
  }
  const target = outcome.action === "capture" ? m.releasedCents + outcome.amountCents : m.releasedCents;
  await release(job, m, target, m.status === "DISPUTED" ? "silence after re-check" : "silence");
}

/** Queue settle tasks for this job's windows that have closed. Cheap; called on every page load. */
export async function queueExpiredWindows(jobId: string): Promise<number> {
  const due = await db
    .select({ id: schema.milestones.id, endsAt: schema.milestones.reviewEndsAt })
    .from(schema.milestones)
    .where(and(eq(schema.milestones.jobId, jobId), inArray(schema.milestones.status, ["REVIEW_WINDOW", "DISPUTED"]), lt(schema.milestones.reviewEndsAt, new Date())));
  for (const m of due) await enqueue(db, "settle", m.id, jobId, `settle:${m.id}:${m.endsAt!.getTime()}`);
  return due.length;
}

/* ------------------------------------------------------------------ */
/* The client's actions                                                  */
/* ------------------------------------------------------------------ */

async function clientMilestone(token: string, milestoneId: string) {
  const job = await findJobByClientToken(token);
  if (!job) throw new AgreementError("This link is not valid.");
  if (job.status !== "IN_PROGRESS" && job.status !== "FUNDED") throw new AgreementError("This job isn't in progress.");
  const [m] = await db.select().from(schema.milestones).where(and(eq(schema.milestones.id, milestoneId), eq(schema.milestones.jobId, job.id)));
  if (!m) throw new AgreementError("Milestone not found.");
  const [ev] = m.currentEvaluationId ? await db.select().from(schema.evaluations).where(eq(schema.evaluations.id, m.currentEvaluationId)) : [];
  return { job, m, ev: ev as Evaluation | undefined };
}

export { choicesFor };

export async function clientDecide(token: string, milestoneId: string, choice: ClientChoice): Promise<void> {
  const { job, m, ev } = await clientMilestone(token, milestoneId);
  if (!choicesFor(m, ev, job.maxResubmissions).includes(choice)) throw new AgreementError("That option isn't available for this milestone any more. Reload the page.");
  if (choice === "another_try") return giveAnotherTry(job.id, m.id);
  if (choice === "end_project") {
    await endProject(job.id, "client");
    return;
  }
  const target = targetForChoice(choice, { amountCents: m.amountCents, releasedCents: m.releasedCents, earnedCents: ev?.earnedCents ?? null, silenceReleaseCents: ev?.silenceReleaseCents ?? null });
  await release(job, m, target, `client: ${choice}`, choice === "close" ? "CLOSED" : undefined);
}

/** The client lets the freelancer try once more (at most CLIENT_EXTRA_TRIES times per milestone). */
async function giveAnotherTry(jobId: string, milestoneId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).for("update");
    const [m] = await tx.select().from(schema.milestones).where(eq(schema.milestones.id, milestoneId)).for("update");
    if (!canGiveTry(m, job.maxResubmissions)) throw new AgreementError("That option isn't available for this milestone any more. Reload the page.");
    await tx.update(schema.milestones).set({ extraTries: m.extraTries + 1, decideBy: null }).where(eq(schema.milestones.id, m.id));
    await tx.insert(schema.events).values({
      jobId,
      milestoneId: m.id,
      type: "milestone.try_given",
      source: "client",
      payload: { position: m.position, extraTries: m.extraTries + 1, of: CLIENT_EXTRA_TRIES },
    });
  });
}

export async function clientDispute(token: string, milestoneId: string, criterionIds: string[], note: string): Promise<void> {
  const { job, m, ev } = await clientMilestone(token, milestoneId);
  if (m.status !== "REVIEW_WINDOW" || ev?.status !== "done") throw new AgreementError("Only a milestone in its review window can be disputed.");
  if (m.reevaluated) throw new AgreementError("You've already used the re-check for this delivery. Decide below instead.");
  const valid = new Set((ev.results ?? []).map((r) => r.id));
  const picked = criterionIds.filter((id) => valid.has(id));
  if (!picked.length) throw new AgreementError("Pick at least one criterion you disagree with.");
  const text = note.trim();
  if (text.length < 10) throw new AgreementError("Say what's wrong (at least a sentence).");

  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.milestones).where(eq(schema.milestones.id, m.id)).for("update");
    if (locked.status !== "REVIEW_WINDOW") throw new AgreementError("This milestone changed. Reload the page.");
    const [recheck] = await tx
      .insert(schema.evaluations)
      .values({ deliveryId: ev.deliveryId, milestoneId: m.id, briefVersionId: ev.briefVersionId, kind: "reevaluation", status: "queued" })
      .returning();
    await tx
      .update(schema.milestones)
      .set({ status: "DISPUTED", disputedCriteria: picked, disputeNote: text.slice(0, 2000), reviewEndsAt: null, currentEvaluationId: recheck.id })
      .where(eq(schema.milestones.id, m.id));
    await enqueue(tx, "evaluate", recheck.id, job.id);
    await tx.insert(schema.events).values({ jobId: job.id, milestoneId: m.id, type: "dispute.opened", source: "client", payload: { position: m.position, criteria: picked, note: text } });
  });
}

/** Ordered milestones for a job (shared by pages). */
export async function jobMilestones(jobId: string) {
  return db.select().from(schema.milestones).where(eq(schema.milestones.jobId, jobId)).orderBy(asc(schema.milestones.position));
}
