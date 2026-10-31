import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";

/**
 * A small database-backed work queue. Work is started right after the request that created it
 * (via next/server `after`), and picked up again by page-load ticks and the cron if the server
 * restarted mid-way. Claiming is atomic, so two runners never do the same task.
 */

export type TaskKind = "evaluate" | "settle";
type Task = typeof schema.tasks.$inferSelect;

const MAX_ATTEMPTS = 3;
const LOCK_MINUTES = 5;

type Handler = (refId: string) => Promise<void>;
type FinalFailure = (refId: string, error: string) => Promise<void>;
/** Longest wait between retries. */
const MAX_BACKOFF_SECONDS = 600;
const handlers = new Map<TaskKind, { run: Handler; onFinalFailure?: FinalFailure; maxAttempts: number }>();

/**
 * `maxAttempts: Infinity` for work that must eventually happen (moving money someone is owed):
 * it keeps retrying, at most every 10 minutes, through a PayPal outage of any length.
 */
export function registerTask(kind: TaskKind, run: Handler, onFinalFailure?: FinalFailure, opts: { maxAttempts?: number } = {}) {
  handlers.set(kind, { run, onFinalFailure, maxAttempts: opts.maxAttempts ?? MAX_ATTEMPTS });
}

/** Queue work once: the same dedupe key (default kind:refId) is never queued twice. */
export async function enqueue(tx: Tx | typeof db, kind: TaskKind, refId: string, jobId: string, dedupeKey = `${kind}:${refId}`) {
  await tx.insert(schema.tasks).values({ kind, refId, payload: { jobId }, dedupeKey }).onConflictDoNothing();
}

async function claim(id: string): Promise<Task | null> {
  const [task] = await db
    .update(schema.tasks)
    .set({ status: "running", attempts: sql`${schema.tasks.attempts} + 1`, lockedUntil: sql`now() + make_interval(mins => ${LOCK_MINUTES})` })
    .where(
      and(
        eq(schema.tasks.id, id),
        lte(schema.tasks.runAfter, sql`now()`),
        or(eq(schema.tasks.status, "queued"), and(eq(schema.tasks.status, "running"), lte(schema.tasks.lockedUntil, sql`now()`))),
      ),
    )
    .returning();
  return task ?? null;
}

async function runOne(task: Task) {
  const handler = handlers.get(task.kind as TaskKind);
  try {
    if (!handler) throw new Error(`No handler for task kind ${task.kind}`);
    await handler.run(task.refId!);
    await db.update(schema.tasks).set({ status: "done", lockedUntil: null, lastError: null }).where(eq(schema.tasks.id, task.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tasks] ${task.kind} ${task.refId} attempt ${task.attempts} failed: ${message}`);
    const final = task.attempts >= (handler?.maxAttempts ?? MAX_ATTEMPTS);
    await db
      .update(schema.tasks)
      .set({
        status: final ? "failed" : "queued",
        lockedUntil: null,
        lastError: message.slice(0, 1000),
        runAfter: sql`now() + make_interval(secs => ${Math.min(30 * task.attempts, MAX_BACKOFF_SECONDS)})`,
      })
      .where(eq(schema.tasks.id, task.id));
    if (final) await handler?.onFinalFailure?.(task.refId!, message).catch((e) => console.error("[tasks] final-failure handler", e));
  }
}

/** Run due tasks, optionally only one job's. Returns how many ran. */
export async function drainTasks(opts: { jobId?: string; limit?: number } = {}): Promise<number> {
  const due = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        lte(schema.tasks.runAfter, sql`now()`),
        or(eq(schema.tasks.status, "queued"), and(eq(schema.tasks.status, "running"), lte(schema.tasks.lockedUntil, sql`now()`))),
        opts.jobId ? sql`${schema.tasks.payload}->>'jobId' = ${opts.jobId}` : undefined,
      ),
    )
    .orderBy(asc(schema.tasks.createdAt))
    .limit(opts.limit ?? 5);

  let ran = 0;
  for (const { id } of due) {
    const task = await claim(id);
    if (!task) continue; // someone else got it
    await runOne(task);
    ran++;
  }
  return ran;
}
