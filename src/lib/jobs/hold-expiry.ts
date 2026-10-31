import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Job } from "./agreement";
import { FINAL_NOTICE_DAYS, holdPhase, holdTimeline, SETTLE_MARGIN_HOURS } from "./hold-rules";

/**
 * Acting on the hold's timeline (rules in hold-rules.ts). Called by the tick before settlement
 * tasks are queued, so a window cut short here is settled in the same pass.
 */

const OPEN_REVIEW = ["REVIEW_WINDOW", "DISPUTED"] as const;
const AWAITING_DELIVERY = ["PENDING", "HELD", "PARTIAL_HELD"] as const;

async function noteOnce(job: Job, type: string, payload: Record<string, unknown>): Promise<boolean> {
  const [seen] = await db.select({ id: schema.events.id }).from(schema.events).where(and(eq(schema.events.jobId, job.id), eq(schema.events.type, type)));
  if (seen) return false;
  await db.insert(schema.events).values({ jobId: job.id, type, source: "system", payload });
  return true;
}

export async function handleHoldExpiry(job: Job, now = new Date()): Promise<string[]> {
  if (job.status !== "FUNDED" && job.status !== "IN_PROGRESS") return [];
  const phase = holdPhase(job.authExpiresAt, now);
  if (phase !== "notice" && phase !== "settle") return [];
  const t = holdTimeline(job.authExpiresAt)!;
  const done: string[] = [];

  if (await noteOnce(job, "hold.ending_soon", { expiresAt: t.expiresAt.toISOString(), settleBy: t.settleBy.toISOString() })) done.push("final notice");
  if (phase !== "settle") return done;

  const closed: number[] = [];
  const cut: number[] = [];
  await db.transaction(async (tx) => {
    const milestones = await tx.select().from(schema.milestones).where(eq(schema.milestones.jobId, job.id)).for("update");
    for (const m of milestones) {
      if ((AWAITING_DELIVERY as readonly string[]).includes(m.status)) {
        // Nothing (more) was delivered in time: what isn't released goes back to the client.
        await tx.update(schema.milestones).set({ status: "CLOSED", settledAt: now, reviewEndsAt: null }).where(eq(schema.milestones.id, m.id));
        closed.push(m.position);
      } else if ((OPEN_REVIEW as readonly string[]).includes(m.status) && m.reviewEndsAt && m.reviewEndsAt > now) {
        // The window closes now, by the silence rule, with no further extension.
        await tx.update(schema.milestones).set({ reviewEndsAt: now, windowExtended: true }).where(eq(schema.milestones.id, m.id));
        cut.push(m.position);
      }
      // A delivery still being checked opens a window that ends immediately (see clampWindowEnd).
    }
    if (closed.length || cut.length) {
      await tx.insert(schema.events).values({ jobId: job.id, type: "hold.settling", source: "system", payload: { closed, cut, expiresAt: t.expiresAt.toISOString() } });
    }
  });
  if (closed.length) done.push(`closed ${closed.map((p) => `M${p}`).join(", ")}`);
  if (cut.length) done.push(`closed the review of ${cut.map((p) => `M${p}`).join(", ")}`);
  return done;
}

/** Live jobs within the final-notice period of their hold, for the cron. */
export async function jobsNearHoldExpiry(limit = 50): Promise<{ id: string }[]> {
  const soon = new Date(Date.now() + FINAL_NOTICE_DAYS * 86_400_000);
  return db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        inArray(schema.jobs.status, ["FUNDED", "IN_PROGRESS"]),
        lt(schema.jobs.authExpiresAt, soon),
        // Skip jobs already given notice unless they've reached the settle-by time.
        or(
          sql`not exists (select 1 from ${schema.events} where ${schema.events.jobId} = ${schema.jobs.id} and ${schema.events.type} = 'hold.ending_soon')`,
          lt(schema.jobs.authExpiresAt, new Date(Date.now() + SETTLE_MARGIN_HOURS * 3_600_000)),
        ),
      ),
    )
    .limit(limit);
}
