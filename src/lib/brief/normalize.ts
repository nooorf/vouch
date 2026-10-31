import { z } from "zod";
import { CHECKS, DEFAULT_PARAMS, isCheckId, type CheckId } from "./checks";
import { Brief, MAX_JOB_DAYS, type Criterion } from "./schema";

/**
 * What we ask the model for. Deliberately loose and flat: the model returns shares, not cents,
 * and simple optional fields instead of per-check param objects. Code turns it into a valid
 * Brief, so a sloppy answer is repaired instead of failing the request.
 */
export const RawDraft = z.object({
  title: z.string().default(""),
  summary: z.string().default(""),
  milestones: z
    .array(
      z.object({
        title: z.string().default(""),
        description: z.string().default(""),
        sharePercent: z.number().default(0),
        dueInDays: z.number().default(0),
        criteria: z
          .array(
            z.object({
              kind: z.string(),
              checkId: z.string().optional(),
              min: z.number().optional(),
              maxKb: z.number().optional(),
              items: z.array(z.string()).optional(),
              rubric: z.string().optional(),
              weight: z.number().optional(),
              required: z.boolean().optional(),
              visual: z.boolean().optional(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});
export type RawDraft = z.infer<typeof RawDraft>;

/**
 * JSON Schema for Gemini's structured output. Gemini rejects numeric and length limits
 * (minimum, maximum, minItems, maxItems) here, so ranges are stated in descriptions and
 * enforced by normalizeDraft() instead.
 */
export const RAW_DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short job title, at most 80 characters" },
    summary: { type: "string", description: "Two or three sentences describing the job" },
    milestones: {
      type: "array",
      description: "1 to 5 milestones, usually 2 to 4",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          sharePercent: { type: "integer", description: "Share of the total price, 1-100; all milestones add up to 100" },
          dueInDays: { type: "integer", description: `Days after funding, 1-${MAX_JOB_DAYS}, never past the deadline` },
          criteria: {
            type: "array",
            description: "3 to 6 acceptance criteria",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["check", "judged"] },
                checkId: { type: "string", enum: Object.keys(CHECKS) },
                min: { type: "integer", description: "For min_sections (count) or lighthouse_* (score 0-100)" },
                maxKb: { type: "integer", description: "For page_weight" },
                items: { type: "array", items: { type: "string" }, description: "For has_form (field names) or has_text (phrases)" },
                rubric: { type: "string", description: "For judged: one concrete yes/no question about the page" },
                weight: { type: "integer", description: "1-10: how much of the milestone's payment this is worth" },
                required: { type: "boolean" },
                visual: { type: "boolean", description: "For judged: answer from a screenshot of the page" },
              },
              required: ["kind", "weight"],
            },
          },
        },
        required: ["title", "sharePercent", "dueInDays", "criteria"],
      },
    },
  },
  required: ["title", "summary", "milestones"],
} as const;

/** Split total into integer cents by shares, largest remainder first, so parts add up exactly. */
export function splitByShares(totalCents: number, shares: number[]): number[] {
  const clean = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const weights = sum === 0 ? clean.map(() => 1) : clean;
  const wsum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (totalCents * w) / wsum);
  const parts = exact.map(Math.floor);
  let left = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** Fields the model may use to set check params (shared with revise.ts). */
export interface ParamFields {
  min?: number;
  maxKb?: number;
  items?: string[];
}

/** Valid params for a check from the model's flat fields, or null if they can't be made valid. */
export function checkParams(checkId: CheckId, c: ParamFields) {
  const items = (c.items ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  let params: Record<string, unknown>;
  switch (checkId) {
    case "min_sections":
      params = { min: clampInt(c.min, 1, 20, 4) };
      break;
    case "lighthouse_a11y":
    case "lighthouse_perf":
    case "lighthouse_seo":
      params = { min: clampInt(c.min, 0, 100, DEFAULT_PARAMS[checkId].min as number) };
      break;
    case "page_weight":
      params = { maxKb: clampInt(c.maxKb, 10, 5000, 500) };
      break;
    case "has_form":
      params = { fields: items.length ? items : DEFAULT_PARAMS.has_form.fields };
      break;
    case "has_text":
      params = { phrases: items };
      break;
    default:
      params = { ...DEFAULT_PARAMS[checkId] };
  }
  return CHECKS[checkId].params.safeParse(params).success ? params : null;
}

export function normalizeDraft(raw: RawDraft, input: { totalCents: number; deadlineDays: number }): Brief {
  const deadline = clampInt(input.deadlineDays, 1, MAX_JOB_DAYS, MAX_JOB_DAYS);
  const rawMilestones = raw.milestones.slice(0, 5);
  const amounts = splitByShares(input.totalCents, rawMilestones.map((m) => m.sharePercent));

  let lastDue = 0;
  const milestones = rawMilestones.map((m, mi) => {
    const mid = `m${mi + 1}`;
    const criteria: Criterion[] = [];
    const seenChecks = new Set<string>();

    for (const c of m.criteria) {
      if (criteria.length >= 9) break;
      const weight = clampInt(c.weight, 1, 10, 2);
      if (c.kind === "check" && isCheckId(c.checkId) && !seenChecks.has(c.checkId)) {
        const params = checkParams(c.checkId, c);
        if (!params) continue; // e.g. has_text with no phrases
        seenChecks.add(c.checkId);
        criteria.push({ kind: "check", id: "", checkId: c.checkId, params, weight, required: c.required ?? false });
      } else if (c.kind === "judged") {
        const rubric = (c.rubric ?? "").trim().slice(0, 300);
        if (rubric.length < 15) continue;
        criteria.push({ kind: "judged", id: "", rubric, weight, required: c.required ?? false, visual: c.visual ?? false });
      }
    }

    // The page must load. Every milestone starts with a required http_ok check.
    if (!seenChecks.has("http_ok")) {
      criteria.unshift({ kind: "check", id: "", checkId: "http_ok", params: {}, weight: 1, required: true });
    } else {
      // A gate, not a source of value: "the page loads" shouldn't earn a big share of the payment.
      const ok = criteria.find((c) => c.kind === "check" && c.checkId === "http_ok")!;
      ok.required = true;
      ok.weight = 1;
    }

    criteria.forEach((c, ci) => (c.id = `${mid}-c${ci + 1}`));

    // Due days: within the deadline and never before the previous milestone.
    const due = Math.max(lastDue, clampInt(m.dueInDays, 1, deadline, Math.ceil((deadline * (mi + 1)) / rawMilestones.length)));
    lastDue = due;

    return {
      id: mid,
      title: (m.title.trim().length >= 3 ? m.title.trim() : `Milestone ${mi + 1}`).slice(0, 80),
      description: m.description.trim().slice(0, 500),
      amountCents: amounts[mi],
      dueInDays: due,
      criteria,
    };
  });

  return Brief.parse({
    title: (raw.title.trim().length >= 3 ? raw.title.trim() : "Untitled job").slice(0, 100),
    summary: raw.summary.trim().slice(0, 1000),
    currency: "USD",
    totalCents: input.totalCents,
    milestones: milestones.filter((m) => m.amountCents > 0),
    terms: { reviewWindowHours: 24, maxResubmissions: 1 },
  });
}
