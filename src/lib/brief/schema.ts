import { z } from "zod";
import { CHECKS, CHECK_IDS } from "./checks";

/* Safe to import in the browser. Hashing lives in ./hash (Node only). */

export { CHECKS, type CheckId } from "./checks";

/** suspicious_content always runs on every submission; it is not something a brief opts into. */
export const ALWAYS_ON_CHECKS = ["http_ok", "suspicious_content"] as const;

export const MAX_JOB_DAYS = 25;

const weight = z.number().int().min(1).max(10);

export const CheckCriterion = z
  .object({
    kind: z.literal("check"),
    id: z.string().min(1),
    checkId: z.enum(CHECK_IDS),
    params: z.record(z.string(), z.unknown()).default({}),
    weight,
    required: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    const parsed = CHECKS[c.checkId].params.safeParse(c.params);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", path: ["params"], message: `Settings for "${CHECKS[c.checkId].label}" are not valid` });
    }
  });

export const JudgedCriterion = z.object({
  kind: z.literal("judged"),
  id: z.string().min(1),
  /** A yes/no question a reviewer could answer from the page, e.g. "Does the hero copy name the roastery's single-origin beans?" */
  rubric: z.string().trim().min(15, "Write a full question (at least 15 characters)").max(300),
  weight,
  required: z.boolean().default(false),
  /** Judge from the rendered screenshot as well as the text. */
  visual: z.boolean().default(false),
  /**
   * What the question is about: the delivered page (default) or the delivered repository's code.
   * Optional rather than defaulted, so briefs agreed before it existed keep their hash.
   */
  source: z.enum(["page", "code"]).optional(),
});

export const Criterion = z.discriminatedUnion("kind", [CheckCriterion, JudgedCriterion]);

export const Milestone = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(3, "Give the milestone a title").max(80),
  description: z.string().max(500).default(""),
  amountCents: z.number().int().positive("Each milestone needs an amount"),
  dueInDays: z.number().int().min(1).max(MAX_JOB_DAYS, `Jobs must finish within ${MAX_JOB_DAYS} days`),
  criteria: z.array(Criterion).min(1, "Add at least one criterion").max(10),
});

export const Terms = z.object({
  reviewWindowHours: z.number().int().min(1).max(168).default(24),
  maxResubmissions: z.number().int().min(0).max(5).default(2),
});

export const Brief = z
  .object({
    title: z.string().trim().min(3).max(100),
    summary: z.string().max(1000),
    currency: z.literal("USD"),
    totalCents: z.number().int().positive(),
    milestones: z.array(Milestone).min(1).max(5),
    terms: Terms,
  })
  .superRefine((b, ctx) => {
    const sum = b.milestones.reduce((s, m) => s + m.amountCents, 0);
    if (sum !== b.totalCents) {
      ctx.addIssue({ code: "custom", path: ["totalCents"], message: `Milestones add up to ${sum / 100}, but the total is ${b.totalCents / 100}` });
    }
    const ids = new Set<string>();
    for (const m of b.milestones) {
      for (const c of m.criteria) {
        if (ids.has(c.id)) ctx.addIssue({ code: "custom", message: `Duplicate criterion id ${c.id}` });
        ids.add(c.id);
      }
    }
  });

export type Brief = z.infer<typeof Brief>;
export type Milestone = z.infer<typeof Milestone>;
export type Criterion = z.infer<typeof Criterion>;
export type CheckCriterion = z.infer<typeof CheckCriterion>;
export type JudgedCriterion = z.infer<typeof JudgedCriterion>;
