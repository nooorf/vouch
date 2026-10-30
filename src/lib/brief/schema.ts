import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * The check library. The brief generator may only pick checks from here, which is what
 * keeps verdicts reproducible. `params` describes what the brief must supply.
 */
export const CHECKS = {
  http_ok: { label: "Site loads over HTTPS (status 200, under 5 s)", params: z.object({}) },
  has_h1: { label: "Exactly one main heading (h1)", params: z.object({}) },
  min_sections: { label: "Has at least N content sections", params: z.object({ min: z.number().int().min(1).max(20) }) },
  viewport_meta: { label: "Mobile viewport meta tag present", params: z.object({}) },
  responsive_css: { label: "Responsive CSS (media queries or fluid units)", params: z.object({}) },
  img_alt_ratio: { label: "Images have alt text", params: z.object({ minRatio: z.number().min(0).max(1).default(0.9) }) },
  has_form: { label: "Contact form with the named fields", params: z.object({ fields: z.array(z.string()).min(1).max(10) }) },
  has_text: { label: "Page mentions the required phrases", params: z.object({ phrases: z.array(z.string()).min(1).max(10) }) },
  links_ok: { label: "Internal links work (up to 10)", params: z.object({}) },
  page_weight: { label: "HTML under a size limit", params: z.object({ maxKb: z.number().int().min(10).max(5000) }) },
  // Google PageSpeed Insights (Lighthouse), measured by Google, not by us.
  lighthouse_a11y: { label: "Lighthouse accessibility score (mobile)", params: z.object({ min: z.number().int().min(0).max(100).default(90) }) },
  lighthouse_perf: { label: "Lighthouse performance score (mobile)", params: z.object({ min: z.number().int().min(0).max(100).default(70) }) },
  lighthouse_seo: { label: "Lighthouse SEO score", params: z.object({ min: z.number().int().min(0).max(100).default(90) }) },
  // GitHub
  repo_readme: { label: "Repo has a README with substance", params: z.object({}) },
  repo_fresh_commits: { label: "Repo has commits made after the job was funded", params: z.object({}) },
  ci_passing: { label: "Latest CI run on the default branch passed", params: z.object({}) },
} as const satisfies Record<string, { label: string; params: z.ZodType }>;

export type CheckId = keyof typeof CHECKS;
const checkIds = Object.keys(CHECKS) as [CheckId, ...CheckId[]];

/** suspicious_content always runs on every submission; it is not something a brief opts into. */
export const ALWAYS_ON_CHECKS = ["http_ok", "suspicious_content"] as const;

const weight = z.number().int().min(1).max(10);

export const CheckCriterion = z
  .object({
    kind: z.literal("check"),
    id: z.string().min(1),
    checkId: z.enum(checkIds),
    params: z.record(z.string(), z.unknown()).default({}),
    weight,
    required: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    const parsed = CHECKS[c.checkId].params.safeParse(c.params);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: `Bad params for ${c.checkId}: ${parsed.error.message}` });
    }
  });

export const JudgedCriterion = z.object({
  kind: z.literal("judged"),
  id: z.string().min(1),
  /** A yes/no question a reviewer could answer from the page, e.g. "Does the hero copy name the roastery's single-origin beans?" */
  rubric: z.string().min(15).max(300),
  weight,
  required: z.boolean().default(false),
  /** Judge from the rendered screenshot as well as the text. */
  visual: z.boolean().default(false),
});

export const Criterion = z.discriminatedUnion("kind", [CheckCriterion, JudgedCriterion]);

export const Milestone = z.object({
  id: z.string().min(1),
  title: z.string().min(3).max(80),
  description: z.string().max(500).default(""),
  amountCents: z.number().int().positive(),
  dueInDays: z.number().int().min(1).max(25),
  criteria: z.array(Criterion).min(1).max(10),
});

export const Terms = z.object({
  reviewWindowHours: z.number().int().min(1).max(168).default(24),
  maxResubmissions: z.number().int().min(0).max(5).default(2),
});

export const Brief = z
  .object({
    title: z.string().min(3).max(100),
    summary: z.string().max(1000),
    currency: z.literal("USD"),
    totalCents: z.number().int().positive(),
    milestones: z.array(Milestone).min(1).max(5),
    terms: Terms,
  })
  .superRefine((b, ctx) => {
    const sum = b.milestones.reduce((s, m) => s + m.amountCents, 0);
    if (sum !== b.totalCents) {
      ctx.addIssue({ code: "custom", message: `Milestones add up to ${sum}, total says ${b.totalCents}` });
    }
    const maxDue = Math.max(...b.milestones.map((m) => m.dueInDays));
    if (maxDue > 25) {
      ctx.addIssue({ code: "custom", message: "Jobs must finish within 25 days (PayPal authorization lifetime)" });
    }
  });

export type Brief = z.infer<typeof Brief>;
export type Milestone = z.infer<typeof Milestone>;
export type Criterion = z.infer<typeof Criterion>;

/** Stable JSON (sorted keys) so both parties sign the exact same bytes. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The hash both parties accept. A brief is AGREED when both accepted the same hash. */
export function briefHash(brief: Brief): string {
  return createHash("sha256").update(canonical(Brief.parse(brief))).digest("hex");
}
