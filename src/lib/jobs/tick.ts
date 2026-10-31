import { and, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hasFeature } from "@/lib/env";
import { paypal, paypalErrorInfo } from "@/lib/paypal/client";
import { syncNotices } from "@/lib/notify";
import { completeFunding } from "@/lib/paypal/funding";
import { checkDecisionDeadline, noteMissedDeadline, voidCancelledHold } from "./cancel";
import { handleHoldExpiry, jobsNearHoldExpiry } from "./hold-expiry";
import { completeIfDone, queueExpiredWindows, recoverPendingCaptures } from "./settle";
import { assertTransition } from "./status";

/**
 * Brings one job up to date with time and with PayPal. Idempotent and safe to call often:
 * every job page load calls it, and /api/cron/tick calls it for jobs nobody is looking at.
 * Later stages (review windows, reauthorization) are added here.
 */
export async function tickJob(jobId: string): Promise<string[]> {
  const done = await bringUpToDate(jobId);
  // Notices last, so they include whatever this tick just did.
  const notices = await syncNotices(jobId).catch((err) => {
    console.warn("[tick] notices failed", jobId, err);
    return 0;
  });
  if (notices) done.push(`${notices} notice(s)`);
  return done;
}

async function bringUpToDate(jobId: string): Promise<string[]> {
  const done: string[] = [];
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) return done;

  if (job.status === "AGREED") {
    // The client may have approved in PayPal and closed the tab before we recorded it.
    if (job.paypalOrderId && hasFeature("paypal")) {
      try {
        const { result } = await paypal().orders.getOrder({ id: job.paypalOrderId });
        if (result.status === "APPROVED" || result.status === "COMPLETED") {
          done.push(`funding ${await completeFunding(job.id, job.paypalOrderId, "system")}`);
          return done;
        }
      } catch (err) {
        console.warn("[tick] funding check failed", job.id, paypalErrorInfo(err).message);
      }
    }

    if (job.fundingExpiresAt && job.fundingExpiresAt < new Date()) {
      const expired = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).for("update");
        if (locked.status !== "AGREED") return false;
        assertTransition(locked.status, "EXPIRED");
        await tx.update(schema.jobs).set({ status: "EXPIRED" }).where(eq(schema.jobs.id, job.id));
        await tx.insert(schema.events).values({ jobId: job.id, type: "job.expired", source: "system", payload: { reason: "not funded in time" } });
        return true;
      });
      if (expired) done.push("expired");
    }
  }
  if (job.status === "FUNDED" || job.status === "IN_PROGRESS") {
    // Near the end of PayPal's hold: final notice, then settle everything still open.
    done.push(...(await handleHoldExpiry(job)));
    // Out of tries: the client's decision deadline (and ending the project when it passes).
    const decision = await checkDecisionDeadline(job).catch((err) => {
      console.warn("[tick] decision deadline", job.id, err);
      return null;
    });
    if (decision) done.push(decision);
    // Closed review windows become "settle" tasks (run right after the response, or by the cron).
    const queued = await queueExpiredWindows(job.id);
    if (queued) done.push(`queued ${queued} settlement(s)`);
    if (await noteMissedDeadline(job).catch(() => false)) done.push("deadline missed");
    if (hasFeature("paypal")) {
      const recovered = await recoverPendingCaptures(job.id).catch(() => 0);
      if (recovered) done.push(`recovered ${recovered} capture(s)`);
      await completeIfDone(job.id).catch((err) => console.warn("[tick] complete check failed", job.id, err));
    }
  }
  if (job.status === "CANCELLED" && hasFeature("paypal")) {
    // The void right after cancelling may have failed (PayPal unavailable): retry it.
    if (await voidCancelledHold(job.id).catch(() => false)) done.push("voided the unused hold");
  }
  return done;
}

/** Jobs that may need a tick: agreed but unfunded (pending checkout or past the funding deadline). */
export async function dueJobIds(limit = 50): Promise<string[]> {
  const unfunded = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.status, "AGREED"), or(isNotNull(schema.jobs.paypalOrderId), lt(schema.jobs.fundingExpiresAt, new Date()))))
    .limit(limit);
  // Jobs with a review or decision window that has closed.
  const windows = await db
    .selectDistinct({ id: schema.milestones.jobId })
    .from(schema.milestones)
    .where(and(inArray(schema.milestones.status, ["REVIEW_WINDOW", "DISPUTED"]), lt(schema.milestones.reviewEndsAt, new Date())))
    .limit(limit);
  // Cancelled jobs whose unused hold hasn't been voided yet.
  const unvoided = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.status, "CANCELLED"),
        gt(schema.jobs.authorizedCents, schema.jobs.capturedCents),
        sql`not exists (select 1 from ${schema.payments} where ${schema.payments.jobId} = ${schema.jobs.id} and ${schema.payments.type} = 'void')`,
      ),
    )
    .limit(limit);
  // Jobs whose client didn't decide in time after the freelancer ran out of tries.
  const undecided = await db
    .selectDistinct({ id: schema.milestones.jobId })
    .from(schema.milestones)
    .where(and(inArray(schema.milestones.status, ["PENDING", "HELD", "PARTIAL_HELD"]), lt(schema.milestones.decideBy, new Date())))
    .limit(limit);
  const nearExpiry = await jobsNearHoldExpiry(limit);
  return [...new Set([...unfunded, ...windows, ...unvoided, ...undecided, ...nearExpiry].map((r) => r.id))];
}
