import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { graceSeconds } from "@/lib/jobs/cancel";
import { dueReminders, noticesForEvent, type Notice, type Party } from "./notices";

/**
 * Turns new ledger events and due reminders into notices for each side. Runs at the end of every
 * job tick (page loads and the cron). A per-job cursor means each event is read once, and unique
 * dedupe keys mean two ticks at the same moment can't send anything twice.
 */
export async function syncNotices(jobId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ job: schema.jobs, freelancer: schema.users.name })
    .from(schema.jobs)
    .innerJoin(schema.users, eq(schema.users.id, schema.jobs.ownerId))
    .where(eq(schema.jobs.id, jobId));
  if (!row) return 0;
  const { job } = row;
  const ctx = { job, freelancer: row.freelancer, client: job.clientName ?? "the client" };

  const events = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.jobId, jobId), gt(schema.events.id, job.noticedThroughEventId)))
    .orderBy(asc(schema.events.id))
    .limit(200);
  const milestones = await db.select().from(schema.milestones).where(eq(schema.milestones.jobId, jobId));
  const windowSeconds = job.isDemo ? env().DEMO_REVIEW_WINDOW_SECONDS : job.reviewWindowSeconds;

  const notices: Notice[] = [...events.flatMap((e) => noticesForEvent(e, ctx)), ...dueReminders(job, milestones, now, ctx, windowSeconds, graceSeconds(job))];
  let added = 0;
  if (notices.length) {
    const rows = await db
      .insert(schema.notifications)
      .values(notices.map((n) => ({ jobId, party: n.party, kind: n.kind, title: n.title.slice(0, 200), body: n.body.slice(0, 1000), dedupeKey: n.dedupeKey })))
      .onConflictDoNothing()
      .returning({ id: schema.notifications.id });
    added = rows.length;
  }
  if (events.length) {
    const last = events[events.length - 1].id;
    await db
      .update(schema.jobs)
      .set({ noticedThroughEventId: sql`greatest(${schema.jobs.noticedThroughEventId}, ${last})` })
      .where(eq(schema.jobs.id, jobId));
  }
  return added;
}

export type NoticeRow = typeof schema.notifications.$inferSelect;

export function listNotices(jobId: string, party: Party, limit = 8): Promise<NoticeRow[]> {
  return db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.jobId, jobId), eq(schema.notifications.party, party)))
    .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
    .limit(limit);
}

/** Called after a page has shown the notices. */
export async function markNoticesRead(jobId: string, party: Party): Promise<void> {
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.jobId, jobId), eq(schema.notifications.party, party), isNull(schema.notifications.readAt)));
}

/** Unread freelancer notices per job, for the dashboard and the header. */
export async function unreadForOwner(ownerId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ jobId: schema.notifications.jobId, n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.notifications.jobId))
    .where(and(eq(schema.jobs.ownerId, ownerId), eq(schema.notifications.party, "freelancer"), isNull(schema.notifications.readAt)))
    .groupBy(schema.notifications.jobId);
  return new Map(rows.map((r) => [r.jobId, r.n]));
}
