import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { hasFeature } from "@/lib/env";
import { paypal, paypalErrorInfo } from "@/lib/paypal/client";
import { completeFunding } from "@/lib/paypal/funding";
import { assertTransition } from "./status";

/**
 * Brings one job up to date with time and with PayPal. Idempotent and safe to call often:
 * every job page load calls it, and /api/cron/tick calls it for jobs nobody is looking at.
 * Later stages (review windows, reauthorization) are added here.
 */
export async function tickJob(jobId: string): Promise<string[]> {
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
  return done;
}

/** Jobs that may need a tick: agreed but unfunded (pending checkout or past the funding deadline). */
export async function dueJobIds(limit = 50): Promise<string[]> {
  const rows = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.status, "AGREED"), or(isNotNull(schema.jobs.paypalOrderId), lt(schema.jobs.fundingExpiresAt, new Date()))))
    .limit(limit);
  return rows.map((r) => r.id);
}
