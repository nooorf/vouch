import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { describeCriterion } from "@/lib/brief/describe";
import type { Criterion, JudgedCriterion } from "@/lib/brief/schema";
import { env } from "@/lib/env";
import { registerTask } from "@/lib/jobs/tasks";
import { LlmUnavailableError } from "@/lib/llm";
import { evaluate, type CriterionResult, type Evaluation } from "@/lib/policy/policy";
import { judge, type JudgeOutput } from "./judge";
import { runReferee, type RefereeReport } from "./run";

/** What we store per criterion: the policy's input plus what the evaluation card shows. */
export interface RecordedResult extends CriterionResult {
  status: "pass" | "fail" | "error";
  kind: "check" | "judged";
  checkId?: string;
  explanation?: string;
  evidenceSource?: "page_text" | "screenshot" | "none";
}

export interface Measurements {
  report: Omit<RefereeReport, "screenshot" | "pageText">;
  judge: { model: string; cached: boolean } | { error: string } | null;
}

/** Turn measured checks and judge answers into policy input, in brief order. */
export function toResults(criteria: typeof schema.milestones.$inferSelect["criteria"], report: RefereeReport, judged: JudgeOutput | null, judgeError: string | null): RecordedResult[] {
  return criteria.map((c): RecordedResult => {
    const base = { id: c.id, label: describeCriterion(c), weight: c.weight, required: c.required, kind: c.kind };
    if (c.kind === "check") {
      const m = report.checks.find((r) => r.criterionId === c.id);
      const status = m?.status ?? "error";
      return {
        ...base,
        checkId: c.checkId,
        status,
        passed: status === "pass",
        unmeasured: status === "error",
        evidence: m?.evidence ?? "Not measured.",
        fixHint: status === "fail" ? m?.evidence : undefined,
      };
    }
    const j = judged?.results.find((r) => r.criterionId === c.id);
    if (!j) {
      return {
        ...base,
        status: "error",
        passed: false,
        confidence: 0,
        evidence: "",
        explanation: judgeError ? `The AI judge was unavailable: ${judgeError}` : "The AI judge gave no answer.",
        evidenceSource: "none",
      };
    }
    return {
      ...base,
      status: j.passed ? "pass" : "fail",
      passed: j.passed,
      confidence: j.confidence,
      evidenceVerified: j.evidenceVerified,
      evidence: j.evidence,
      explanation: j.explanation,
      evidenceSource: j.evidenceSource,
      fixHint: j.passed ? undefined : j.explanation || `Not met: ${c.rubric}`,
    };
  });
}

export interface AssessInput {
  url: string;
  repoUrl?: string | null;
  criteria: Criterion[];
  fundedAt?: Date | null;
  milestoneAmountCents: number;
  alreadyReleasedCents: number;
  objection?: { criterionIds: string[]; note: string } | null;
}

export interface Assessment {
  report: RefereeReport;
  judged: JudgeOutput | null;
  judgeError: string | null;
  results: RecordedResult[];
  verdict: Evaluation;
}

/**
 * Measure, judge and score a delivery. No database writes: production (evaluateDelivery) and the
 * real-world benchmark run exactly this.
 */
export async function assessDelivery(input: AssessInput): Promise<Assessment> {
  const judgedCriteria = input.criteria.filter((c): c is JudgedCriterion => c.kind === "judged");
  const report = await runReferee({
    url: input.url,
    repoUrl: input.repoUrl,
    criteria: input.criteria,
    fundedAt: input.fundedAt,
    wantScreenshot: judgedCriteria.some((c) => c.visual),
  });

  let judged: JudgeOutput | null = null;
  let judgeError: string | null = null;
  if (judgedCriteria.length && report.page) {
    try {
      judged = await judge({
        criteria: judgedCriteria,
        url: report.page.finalUrl,
        title: report.page.title,
        pageText: report.pageText,
        facts: [
          ...report.checks.map((c) => `${c.label}: ${c.status} (${c.evidence})`),
          ...(report.rendered
            ? [
                `Loaded in a real browser (phone, then desktop): ${report.rendered.pageErrors.length} JavaScript error(s), ${report.rendered.failedRequests.length} failed or unanswered request(s)${report.rendered.failedRequests.length ? `: ${report.rendered.failedRequests.slice(0, 3).map((f) => `${f.url.slice(0, 80)} (${f.reason})`).join("; ")}` : ""}`,
              ]
            : [`Not loaded in a real browser (${report.renderError ?? "unavailable"}): the page text is the HTML as sent, before any JavaScript ran.`]),
          ...(report.pageTextClipped ? ["The page is long: page_text is its first 40,000 characters. Don't answer no only because something may be further down."] : []),
        ],
        screenshot: report.screenshot,
        objection: input.objection ?? null,
      });
    } catch (err) {
      if (!(err instanceof LlmUnavailableError)) throw err;
      judgeError = err.message;
    }
  } else if (judgedCriteria.length) {
    judgeError = "the page couldn't be loaded";
  }

  const results = toResults(input.criteria, report, judged, judgeError);
  const verdict = evaluate({
    milestoneAmountCents: input.milestoneAmountCents,
    alreadyReleasedCents: input.alreadyReleasedCents,
    results,
    suspicious: report.suspicious.flagged,
  });
  return { report, judged, judgeError, results, verdict };
}

function reviewWindowSeconds(job: typeof schema.jobs.$inferSelect) {
  return job.isDemo ? env().DEMO_REVIEW_WINDOW_SECONDS : job.reviewWindowSeconds;
}

/** Measure, judge and score one delivery, then open the client's review window. */
export async function evaluateDelivery(evaluationId: string): Promise<void> {
  const [row] = await db
    .select({ evaluation: schema.evaluations, delivery: schema.deliveries, milestone: schema.milestones, job: schema.jobs })
    .from(schema.evaluations)
    .innerJoin(schema.deliveries, eq(schema.deliveries.id, schema.evaluations.deliveryId))
    .innerJoin(schema.milestones, eq(schema.milestones.id, schema.evaluations.milestoneId))
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.milestones.jobId))
    .where(eq(schema.evaluations.id, evaluationId));
  if (!row) throw new Error(`Evaluation ${evaluationId} not found`);
  const { evaluation, delivery, milestone, job } = row;
  if (evaluation.status === "done") return;

  await db.update(schema.evaluations).set({ status: "running" }).where(eq(schema.evaluations.id, evaluationId));

  const { report, judged, judgeError, results, verdict } = await assessDelivery({
    url: delivery.url,
    repoUrl: delivery.repoUrl,
    criteria: milestone.criteria,
    fundedAt: job.authorizedAt,
    milestoneAmountCents: milestone.amountCents,
    alreadyReleasedCents: milestone.releasedCents,
    objection: evaluation.kind === "reevaluation" ? { criterionIds: milestone.disputedCriteria ?? [], note: milestone.disputeNote ?? "" } : null,
  });

  const { screenshot: _s, pageText: _t, ...reportForStorage } = report;
  void _s;
  void _t;
  const measurements: Measurements = {
    report: reportForStorage,
    judge: judged ? { model: judged.model, cached: judged.cached } : judgeError ? { error: judgeError } : null,
  };
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(schema.evaluations)
      .set({
        status: "done",
        results,
        measurements: measurements as unknown as Record<string, unknown>,
        suspicious: report.suspicious.flagged,
        verdict: verdict.verdict,
        earnedCents: verdict.earnedCents,
        releaseNowCents: verdict.releaseNowCents,
        silenceReleaseCents: verdict.silenceReleaseCents,
        reasons: verdict.reasons,
        fixList: verdict.fixList,
        model: judged?.model ?? null,
        promptHash: judged?.promptHash ?? null,
        rawOutput: judged?.raw ?? null,
        finishedAt: now,
      })
      .where(eq(schema.evaluations.id, evaluationId));
    const recheck = evaluation.kind === "reevaluation";
    await tx
      .update(schema.milestones)
      .set({
        // After a dispute's re-check the client decides; if they stay silent, the re-check's verdict executes.
        status: recheck ? "DISPUTED" : "REVIEW_WINDOW",
        currentEvaluationId: evaluationId,
        reviewEndsAt: new Date(now.getTime() + reviewWindowSeconds(job) * 1000),
        windowExtended: false,
        reevaluated: recheck,
      })
      .where(eq(schema.milestones.id, milestone.id));
    await tx.insert(schema.events).values({
      jobId: job.id,
      milestoneId: milestone.id,
      type: recheck ? "evaluation.rechecked" : "evaluation.completed",
      source: "ai",
      payload: {
        position: milestone.position,
        verdict: verdict.verdict,
        releaseNowCents: verdict.releaseNowCents,
        heldCents: verdict.heldCents,
        silenceReleaseCents: verdict.silenceReleaseCents,
        suspicious: report.suspicious.flagged,
        model: judged?.model ?? null,
        ms: report.ms,
      },
    });
  });
}

/** After the last retry: tell people, and let the freelancer submit again. */
async function evaluationFailed(evaluationId: string, error: string) {
  const [ev] = await db.select().from(schema.evaluations).where(eq(schema.evaluations.id, evaluationId));
  if (!ev || ev.status === "done") return;
  const [m] = await db.select().from(schema.milestones).where(eq(schema.milestones.id, ev.milestoneId));
  if (ev.kind === "reevaluation" && m) {
    // The re-check failed: the client decides on the original evidence.
    const [original] = await db
      .select()
      .from(schema.evaluations)
      .where(and(eq(schema.evaluations.milestoneId, m.id), eq(schema.evaluations.kind, "initial"), eq(schema.evaluations.status, "done")))
      .orderBy(desc(schema.evaluations.createdAt))
      .limit(1);
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, m.jobId));
    await db.transaction(async (tx) => {
      await tx.update(schema.evaluations).set({ status: "error", error: error.slice(0, 1000), finishedAt: new Date() }).where(eq(schema.evaluations.id, evaluationId));
      await tx
        .update(schema.milestones)
        .set({ currentEvaluationId: original?.id ?? m.currentEvaluationId, reevaluated: true, reviewEndsAt: new Date(Date.now() + reviewWindowSeconds(job) * 1000) })
        .where(eq(schema.milestones.id, m.id));
      await tx.insert(schema.events).values({ jobId: m.jobId, milestoneId: m.id, type: "evaluation.failed", source: "system", payload: { position: m.position, error: error.slice(0, 300), recheck: true } });
    });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.evaluations).set({ status: "error", error: error.slice(0, 1000), finishedAt: new Date() }).where(eq(schema.evaluations.id, evaluationId));
    if (m) {
      // A failed check run doesn't use up one of the freelancer's attempts.
      await tx
        .update(schema.milestones)
        .set({ status: m.releasedCents > 0 ? "PARTIAL_HELD" : "PENDING", attempts: Math.max(0, m.attempts - 1) })
        .where(eq(schema.milestones.id, m.id));
      await tx.insert(schema.events).values({ jobId: m.jobId, milestoneId: m.id, type: "evaluation.failed", source: "system", payload: { position: m.position, error: error.slice(0, 300) } });
    }
  });
}

registerTask("evaluate", evaluateDelivery, evaluationFailed);
