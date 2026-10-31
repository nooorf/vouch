import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { AgreementError } from "@/lib/jobs/agreement";
import { currentMilestone } from "@/lib/jobs/cancel-rules";
import { holdPhase } from "@/lib/jobs/hold-rules";
import { enqueue } from "@/lib/jobs/tasks";
import { checkUrl, FetchBlockedError } from "@/lib/referee/fetch";
import { parseRepoUrl } from "@/lib/referee/github";
import { awaitingClientDecision, canWithdraw, decideByFor, statusWithoutLatest, triesAllowed, triesLeft } from "./tries";

type Milestone = typeof schema.milestones.$inferSelect;

export { currentMilestone };

/** Can the freelancer submit (or resubmit) this milestone right now? */
export function canSubmit(m: Milestone, maxResubmissions: number, authExpiresAt: Date | null = null, now = new Date()): { ok: true } | { ok: false; reason: string } {
  if (holdPhase(authExpiresAt, now) === "settle") return { ok: false, reason: "PayPal's hold on this payment ends within a day, so the job is being settled and new deliveries are closed." };
  if (!["PENDING", "PARTIAL_HELD", "HELD"].includes(m.status)) {
    return { ok: false, reason: m.status === "EVALUATING" ? "This delivery is being checked." : "This milestone is waiting on the client's review." };
  }
  if (m.attempts >= triesAllowed(maxResubmissions, m)) {
    return { ok: false, reason: "You've used every try for this milestone. The client can give you another one, accept the work as is, skip it, or end the project." };
  }
  return { ok: true };
}

/** Record a delivery for the current milestone and queue its evaluation. Returns the evaluation id. */
export async function submitDelivery(ownerId: string, jobId: string, milestoneId: string, url: string, repoUrl: string | null): Promise<string> {
  let cleanUrl: string;
  try {
    // Same rules the referee fetches with (local demo sites only when the dev switch is on).
    cleanUrl = checkUrl(url, { allowAnyPort: env().REFEREE_ALLOW_LOCALHOST }).toString();
  } catch (err) {
    throw new AgreementError(err instanceof FetchBlockedError ? err.message : "That isn't a valid URL.");
  }
  const repo = repoUrl?.trim() ? repoUrl.trim() : null;
  if (repo && !parseRepoUrl(repo)) throw new AgreementError("The repository must be a github.com link, like https://github.com/you/site.");

  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.ownerId, ownerId)))
      .for("update");
    if (!job) throw new AgreementError("Job not found.");
    if (job.status !== "FUNDED" && job.status !== "IN_PROGRESS") throw new AgreementError("Deliveries open once the client has funded the job.");

    const milestones = await tx.select().from(schema.milestones).where(eq(schema.milestones.jobId, jobId)).orderBy(asc(schema.milestones.position));
    const m = currentMilestone(milestones);
    if (!m || m.id !== milestoneId) throw new AgreementError("Milestones are delivered in order. Reload the page.");
    const allowed = canSubmit(m, job.maxResubmissions, job.authExpiresAt);
    if (!allowed.ok) throw new AgreementError(allowed.reason);

    const attemptNo = m.attempts + 1;
    // Numbered after every earlier delivery: a check that couldn't run hands its try back, but its row stays.
    const [{ last }] = await tx
      .select({ last: sql<number>`coalesce(max(${schema.deliveries.attemptNo}), 0)::int` })
      .from(schema.deliveries)
      .where(eq(schema.deliveries.milestoneId, m.id));
    const [delivery] = await tx.insert(schema.deliveries).values({ milestoneId: m.id, attemptNo: last + 1, url: cleanUrl, repoUrl: repo }).returning();
    const [evaluation] = await tx
      .insert(schema.evaluations)
      .values({ deliveryId: delivery.id, milestoneId: m.id, briefVersionId: job.agreedVersionId!, status: "queued" })
      .returning();
    await tx.update(schema.milestones).set({ status: "EVALUATING", attempts: attemptNo, currentEvaluationId: evaluation.id }).where(eq(schema.milestones.id, m.id));
    if (job.status === "FUNDED") await tx.update(schema.jobs).set({ status: "IN_PROGRESS" }).where(eq(schema.jobs.id, jobId));
    await enqueue(tx, "evaluate", evaluation.id, jobId);
    await tx.insert(schema.events).values({
      jobId,
      milestoneId: m.id,
      type: "delivery.submitted",
      source: "freelancer",
      payload: { position: m.position, attempt: attemptNo, triesLeft: triesLeft(job.maxResubmissions, { ...m, attempts: attemptNo }), url: cleanUrl, repoUrl: repo },
    });
    return evaluation.id;
  });
}

/** Has this milestone a delivery, other than `deliveryId`, whose check finished and was kept? */
export async function hasEarlierSettledDelivery(tx: Pick<typeof db, "select">, milestoneId: string, deliveryId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.deliveries.id })
    .from(schema.deliveries)
    .innerJoin(schema.evaluations, eq(schema.evaluations.deliveryId, schema.deliveries.id))
    .where(
      and(
        eq(schema.deliveries.milestoneId, milestoneId),
        ne(schema.deliveries.id, deliveryId),
        isNull(schema.deliveries.withdrawnAt),
        eq(schema.evaluations.kind, "initial"),
        eq(schema.evaluations.status, "done"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The freelancer takes back the delivery being checked or reviewed, to submit again without
 * waiting for its review window. It still counts as a try. The client sees it, marked withdrawn.
 */
export async function withdrawDelivery(ownerId: string, jobId: string, milestoneId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.ownerId, ownerId)))
      .for("update");
    if (!job) throw new AgreementError("Job not found.");
    if (job.status !== "IN_PROGRESS") throw new AgreementError("This job isn't in progress.");
    // New deliveries are closed then, so a withdrawal would leave nothing to settle.
    if (holdPhase(job.authExpiresAt, new Date()) === "settle") throw new AgreementError("PayPal's hold on this payment ends within a day, so deliveries can't be withdrawn now.");
    const [m] = await tx
      .select()
      .from(schema.milestones)
      .where(and(eq(schema.milestones.id, milestoneId), eq(schema.milestones.jobId, jobId)))
      .for("update");
    if (!m) throw new AgreementError("Milestone not found.");
    const allowed = canWithdraw(m);
    if (!allowed.ok) throw new AgreementError(allowed.reason);
    const [ev] = m.currentEvaluationId ? await tx.select().from(schema.evaluations).where(eq(schema.evaluations.id, m.currentEvaluationId)) : [];
    if (!ev) throw new AgreementError("There's no delivery under review to withdraw.");
    // The client may be approving at this very moment: let their payment finish first.
    const [paying] = await tx
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(and(eq(schema.payments.milestoneId, m.id), eq(schema.payments.type, "capture"), eq(schema.payments.status, "pending")));
    if (paying) throw new AgreementError("A payment for this milestone is going through. Reload the page in a minute.");

    const now = new Date();
    const status = statusWithoutLatest(m, await hasEarlierSettledDelivery(tx, m.id, ev.deliveryId));
    const after = { ...m, status };
    const decideBy = awaitingClientDecision(after, job.maxResubmissions) ? decideByFor(job, now, env().DEMO_REVIEW_WINDOW_SECONDS) : null;
    await tx.update(schema.deliveries).set({ withdrawnAt: now }).where(eq(schema.deliveries.id, ev.deliveryId));
    // The withdrawn delivery stays the one shown, so both sides see what happened to it.
    await tx.update(schema.milestones).set({ status, reviewEndsAt: null, windowExtended: false, decideBy }).where(eq(schema.milestones.id, m.id));
    await tx.insert(schema.events).values({
      jobId,
      milestoneId: m.id,
      type: "delivery.withdrawn",
      source: "freelancer",
      payload: { position: m.position, attempt: m.attempts, triesLeft: triesLeft(job.maxResubmissions, after), checked: ev.status === "done" },
    });
    if (decideBy) await tx.insert(schema.events).values(awaitingDecisionEvent(jobId, m, decideBy));
  });
}

/** The ledger event for "the freelancer is out of tries: the client decides by then". */
export function awaitingDecisionEvent(jobId: string, m: Pick<Milestone, "id" | "position">, decideBy: Date) {
  return { jobId, milestoneId: m.id, type: "milestone.awaiting_decision", source: "system" as const, payload: { position: m.position, decideBy: decideBy.toISOString() } };
}
