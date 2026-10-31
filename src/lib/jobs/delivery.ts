import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { AgreementError } from "@/lib/jobs/agreement";
import { currentMilestone } from "@/lib/jobs/cancel-rules";
import { enqueue } from "@/lib/jobs/tasks";
import { checkUrl, FetchBlockedError } from "@/lib/referee/fetch";
import { parseRepoUrl } from "@/lib/referee/github";

type Milestone = typeof schema.milestones.$inferSelect;

export { currentMilestone };

/** Can the freelancer submit (or resubmit) this milestone right now? */
export function canSubmit(m: Milestone, maxResubmissions: number): { ok: true } | { ok: false; reason: string } {
  if (!["PENDING", "PARTIAL_HELD", "HELD"].includes(m.status)) {
    return { ok: false, reason: m.status === "EVALUATING" ? "This delivery is being checked." : "This milestone is waiting on the client's review." };
  }
  if (m.attempts >= 1 + maxResubmissions) return { ok: false, reason: "No resubmissions left. The client decides what happens to the rest." };
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
    const allowed = canSubmit(m, job.maxResubmissions);
    if (!allowed.ok) throw new AgreementError(allowed.reason);

    const attemptNo = m.attempts + 1;
    const [delivery] = await tx.insert(schema.deliveries).values({ milestoneId: m.id, attemptNo, url: cleanUrl, repoUrl: repo }).returning();
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
      payload: { position: m.position, attempt: attemptNo, url: cleanUrl, repoUrl: repo },
    });
    return evaluation.id;
  });
}
