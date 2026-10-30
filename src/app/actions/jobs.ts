"use server";

import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { draftBrief } from "@/lib/brief/generate";
import { briefHash, sha256 } from "@/lib/brief/hash";
import { Brief, MAX_JOB_DAYS } from "@/lib/brief/schema";
import { LlmUnavailableError } from "@/lib/llm/gemini";
import { requireUser } from "@/lib/session";

const NewJobInput = z.object({
  description: z
    .string()
    .trim()
    .min(40, "Describe the job in a few sentences (at least 40 characters).")
    .max(4000, "Keep the description under 4,000 characters."),
  priceUsd: z.coerce
    .number({ error: "Enter a price." })
    .min(10, "The minimum is $10.")
    .max(10000, "The sandbox demo is capped at $10,000."),
  deadlineDays: z.coerce
    .number({ error: "Enter a deadline." })
    .int("Use whole days.")
    .min(1, "At least 1 day.")
    .max(MAX_JOB_DAYS, `PayPal holds a payment for up to 29 days, so jobs finish within ${MAX_JOB_DAYS}.`),
  clientName: z.string().trim().max(80).optional().transform((v) => v || undefined),
  clientEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.email("Enter a valid email or leave it empty.").optional()),
});

export interface NewJobState {
  error?: string;
  fieldErrors?: Partial<Record<keyof z.input<typeof NewJobInput>, string>>;
  values?: Record<string, string>;
}

export async function createJob(_prev: NewJobState, formData: FormData): Promise<NewJobState> {
  const user = await requireUser();
  const values = Object.fromEntries(
    ["description", "priceUsd", "deadlineDays", "clientName", "clientEmail"].map((k) => [k, String(formData.get(k) ?? "")]),
  );

  const parsed = NewJobInput.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: NewJobState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<NewJobState["fieldErrors"]>;
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, values };
  }
  const input = parsed.data;
  const totalCents = Math.round(input.priceUsd * 100);

  let drafted: Awaited<ReturnType<typeof draftBrief>>;
  try {
    drafted = await draftBrief({ description: input.description, totalCents, deadlineDays: input.deadlineDays, clientName: input.clientName });
  } catch (err) {
    if (err instanceof LlmUnavailableError) return { error: err.message, values };
    console.error("[createJob]", err);
    return { error: "Something went wrong while drafting the brief. Please try again.", values };
  }

  const jobId = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(schema.jobs)
      .values({
        ownerId: user.id,
        title: drafted.brief.title,
        totalCents,
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        // Placeholder: a fresh client link is issued when the brief is sent.
        clientTokenHash: sha256(randomBytes(32).toString("hex")),
        reviewWindowSeconds: drafted.brief.terms.reviewWindowHours * 3600,
        maxResubmissions: drafted.brief.terms.maxResubmissions,
        payeeEmail: user.paypalEmail,
        isDemo: user.isDemo,
      })
      .returning({ id: schema.jobs.id });

    await tx.insert(schema.briefVersions).values({
      jobId: job.id,
      versionNo: 1,
      content: drafted.brief,
      contentHash: briefHash(drafted.brief),
      proposedBy: "ai",
    });

    await tx.insert(schema.events).values([
      { jobId: job.id, type: "job.created", source: "freelancer", payload: { description: input.description, totalCents, deadlineDays: input.deadlineDays } },
      { jobId: job.id, type: "brief.drafted", source: "ai", payload: { model: drafted.model, promptHash: drafted.promptHash, cached: drafted.cached, version: 1 } },
    ]);
    return job.id;
  });

  redirect(`/jobs/${jobId}/brief`);
}

export type SaveBriefResult = { ok: true; savedAt: string; hash: string } | { ok: false; issues: string[] };

/** Save edits to the draft brief. Only the owner, and only before it is sent to the client. */
export async function saveBrief(jobId: string, input: unknown): Promise<SaveBriefResult> {
  const user = await requireUser();
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.ownerId, user.id)));
  if (!job) return { ok: false, issues: ["Job not found."] };
  if (job.status !== "DRAFT") return { ok: false, issues: ["This brief was already sent. Changes now go through a new version."] };

  // The total always follows the milestones, so the editor can't get them out of sync.
  const candidate = input as { milestones?: { amountCents?: number }[] };
  const total = (candidate.milestones ?? []).reduce((s, m) => s + (Number.isInteger(m.amountCents) ? m.amountCents! : 0), 0);
  const parsed = Brief.safeParse({ ...(input as object), totalCents: total, currency: "USD" });
  if (!parsed.success) {
    return { ok: false, issues: [...new Set(parsed.error.issues.map((i) => i.message))].slice(0, 6) };
  }
  const brief = parsed.data;
  const hash = briefHash(brief);

  const [version] = await db
    .select()
    .from(schema.briefVersions)
    .where(eq(schema.briefVersions.jobId, jobId))
    .orderBy(desc(schema.briefVersions.versionNo))
    .limit(1);
  if (!version) return { ok: false, issues: ["Brief not found."] };
  if (version.contentHash === hash) return { ok: true, savedAt: new Date().toISOString(), hash };

  await db.transaction(async (tx) => {
    await tx.update(schema.briefVersions).set({ content: brief, contentHash: hash, proposedBy: "freelancer" }).where(eq(schema.briefVersions.id, version.id));
    await tx
      .update(schema.jobs)
      .set({
        title: brief.title,
        totalCents: brief.totalCents,
        reviewWindowSeconds: brief.terms.reviewWindowHours * 3600,
        maxResubmissions: brief.terms.maxResubmissions,
      })
      .where(eq(schema.jobs.id, jobId));
    await tx.insert(schema.events).values({ jobId, type: "brief.edited", source: "freelancer", payload: { version: version.versionNo, hash } });
  });

  return { ok: true, savedAt: new Date().toISOString(), hash };
}
