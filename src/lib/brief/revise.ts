import { z } from "zod";
import { CHECKS, isCheckId } from "./checks";
import { describeCriterion } from "./describe";
import { checkParams } from "./normalize";
import { Brief, MAX_JOB_DAYS, type Criterion, type Milestone } from "./schema";

/**
 * Edit operations the AI may propose for a client's change request. The model never returns a
 * whole brief: code applies these one by one, rejects what doesn't fit, and computes the diff
 * that people actually see.
 */
export const OP_NAMES = [
  "set_title",
  "set_summary",
  "set_milestone_title",
  "set_milestone_amount",
  "set_milestone_due",
  "set_milestone_description",
  "add_milestone",
  "remove_milestone",
  "add_criterion",
  "update_criterion",
  "remove_criterion",
  "set_terms",
] as const;

export const EditOp = z.object({
  op: z.enum(OP_NAMES),
  milestoneId: z.string().optional(),
  criterionId: z.string().optional(),
  /** add_milestone: a temporary key (e.g. "new1") that later add_criterion ops can use as milestoneId. */
  newMilestoneKey: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  amountUsd: z.number().optional(),
  dueInDays: z.number().optional(),
  kind: z.enum(["check", "judged"]).optional(),
  checkId: z.string().optional(),
  min: z.number().optional(),
  maxKb: z.number().optional(),
  items: z.array(z.string()).optional(),
  rubric: z.string().optional(),
  weight: z.number().optional(),
  required: z.boolean().optional(),
  visual: z.boolean().optional(),
  reviewWindowHours: z.number().optional(),
  maxResubmissions: z.number().optional(),
});
export type EditOp = z.infer<typeof EditOp>;

export const RevisionDraft = z.object({
  /** One sentence describing the change, for the people involved. */
  summary: z.string().default(""),
  /** Parts of the request that couldn't be expressed as edits, or null. */
  unclear: z.string().nullable().default(null),
  ops: z.array(EditOp).max(30).default([]),
});
export type RevisionDraft = z.infer<typeof RevisionDraft>;

export const REVISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One plain sentence describing the proposed change" },
    unclear: { type: "string", description: "Anything in the request you could not turn into edits; empty if none" },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: [...OP_NAMES] },
          milestoneId: { type: "string" },
          criterionId: { type: "string" },
          newMilestoneKey: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          description: { type: "string" },
          amountUsd: { type: "number" },
          dueInDays: { type: "integer" },
          kind: { type: "string", enum: ["check", "judged"] },
          checkId: { type: "string", enum: Object.keys(CHECKS) },
          min: { type: "integer" },
          maxKb: { type: "integer" },
          items: { type: "array", items: { type: "string" } },
          rubric: { type: "string" },
          weight: { type: "integer" },
          required: { type: "boolean" },
          visual: { type: "boolean" },
          reviewWindowHours: { type: "integer" },
          maxResubmissions: { type: "integer" },
        },
        required: ["op"],
      },
    },
  },
  required: ["summary", "ops"],
} as const;

export interface ApplyResult {
  brief: Brief;
  applied: string[];
  rejected: string[];
}

const toCents = (usd: number | undefined) => (typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : null);
const clampWeight = (w: number | undefined, fallback: number) => Math.min(10, Math.max(1, Math.round(typeof w === "number" && Number.isFinite(w) ? w : fallback)));

/** Deterministic: the same brief and ops always give the same result (ids included). */
export function applyOps(input: Brief, ops: EditOp[]): ApplyResult {
  const brief: Brief = structuredClone(input);
  const applied: string[] = [];
  const rejected: string[] = [];
  const keyToId = new Map<string, string>();
  const allIds = () => new Set(brief.milestones.flatMap((m) => [m.id, ...m.criteria.map((c) => c.id)]));
  const freshId = (base: string) => {
    const ids = allIds();
    let n = 1;
    while (ids.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  };
  const findMilestone = (id: string | undefined): Milestone | undefined => {
    const real = id && keyToId.has(id) ? keyToId.get(id) : id;
    return brief.milestones.find((m) => m.id === real);
  };
  const findCriterion = (id: string | undefined) => {
    for (const m of brief.milestones) {
      const c = m.criteria.find((x) => x.id === id);
      if (c) return { m, c };
    }
    return undefined;
  };

  for (const op of ops) {
    const reject = (why: string) => rejected.push(`${op.op}: ${why}`);
    switch (op.op) {
      case "set_title": {
        const t = op.title?.trim() ?? "";
        if (t.length < 3) reject("title too short");
        else applied.push(`title → “${(brief.title = t.slice(0, 100))}”`);
        break;
      }
      case "set_summary": {
        if (!op.summary?.trim()) reject("empty summary");
        else {
          brief.summary = op.summary.trim().slice(0, 1000);
          applied.push("summary rewritten");
        }
        break;
      }
      case "set_milestone_title":
      case "set_milestone_amount":
      case "set_milestone_due":
      case "set_milestone_description": {
        const m = findMilestone(op.milestoneId);
        if (!m) {
          reject(`unknown milestone ${op.milestoneId}`);
          break;
        }
        if (op.op === "set_milestone_title") {
          const t = op.title?.trim() ?? "";
          if (t.length < 3) reject("title too short");
          else applied.push(`${m.id} title → “${(m.title = t.slice(0, 80))}”`);
        } else if (op.op === "set_milestone_amount") {
          const cents = toCents(op.amountUsd);
          if (!cents) reject("amount must be positive");
          else applied.push(`${m.id} amount → ${(m.amountCents = cents)}`);
        } else if (op.op === "set_milestone_due") {
          const d = Math.round(op.dueInDays ?? NaN);
          if (!(d >= 1 && d <= MAX_JOB_DAYS)) reject(`due day must be 1-${MAX_JOB_DAYS}`);
          else applied.push(`${m.id} due → day ${(m.dueInDays = d)}`);
        } else {
          m.description = (op.description ?? "").trim().slice(0, 500);
          applied.push(`${m.id} description updated`);
        }
        break;
      }
      case "add_milestone": {
        if (brief.milestones.length >= 5) {
          reject("a brief has at most 5 milestones");
          break;
        }
        const cents = toCents(op.amountUsd);
        const title = op.title?.trim() ?? "";
        const due = Math.round(op.dueInDays ?? NaN);
        if (!cents || title.length < 3 || !(due >= 1 && due <= MAX_JOB_DAYS)) {
          reject("needs a title, a positive amount and a due day");
          break;
        }
        const id = freshId("m");
        if (op.newMilestoneKey) keyToId.set(op.newMilestoneKey, id);
        brief.milestones.push({
          id,
          title: title.slice(0, 80),
          description: (op.description ?? "").trim().slice(0, 500),
          amountCents: cents,
          dueInDays: due,
          criteria: [{ kind: "check", id: `${id}-c1`, checkId: "http_ok", params: {}, weight: 1, required: true }],
        });
        applied.push(`added milestone ${id}`);
        break;
      }
      case "remove_milestone": {
        const m = findMilestone(op.milestoneId);
        if (!m) reject(`unknown milestone ${op.milestoneId}`);
        else if (brief.milestones.length === 1) reject("a brief needs at least one milestone");
        else {
          brief.milestones = brief.milestones.filter((x) => x !== m);
          applied.push(`removed milestone ${m.id}`);
        }
        break;
      }
      case "add_criterion": {
        const m = findMilestone(op.milestoneId);
        if (!m) {
          reject(`unknown milestone ${op.milestoneId}`);
          break;
        }
        if (m.criteria.length >= 10) {
          reject("a milestone has at most 10 criteria");
          break;
        }
        // Adding a check the milestone already has means "change it": merge instead of rejecting.
        const existing = op.kind !== "judged" && isCheckId(op.checkId) ? m.criteria.find((x) => x.kind === "check" && x.checkId === op.checkId) : undefined;
        if (existing && existing.kind === "check") {
          if (existing.checkId === "http_ok") break; // every milestone already has it; nothing to do
          const oldItems = ((existing.params.fields ?? existing.params.phrases) as string[] | undefined) ?? [];
          const items = op.items ? [...new Set([...oldItems, ...op.items.map((s) => s.trim()).filter(Boolean)])] : oldItems;
          const params = checkParams(existing.checkId, { min: op.min ?? (existing.params.min as number | undefined), maxKb: op.maxKb ?? (existing.params.maxKb as number | undefined), items });
          if (!params) {
            reject("invalid settings for this check");
            break;
          }
          existing.params = params;
          if (op.weight !== undefined) existing.weight = clampWeight(op.weight, existing.weight);
          if (op.required !== undefined) existing.required = op.required;
          applied.push(`merged into ${existing.id}`);
          break;
        }
        let c: Criterion | null = null;
        if (op.kind === "judged") {
          const rubric = op.rubric?.trim() ?? "";
          if (rubric.length >= 15) {
            c = { kind: "judged", id: freshId(`${m.id}-x`), rubric: rubric.slice(0, 300), weight: clampWeight(op.weight, 2), required: op.required ?? false, visual: op.visual ?? false };
          }
        } else if (isCheckId(op.checkId)) {
          const params = checkParams(op.checkId, op);
          if (params) c = { kind: "check", id: freshId(`${m.id}-x`), checkId: op.checkId, params, weight: clampWeight(op.weight, 2), required: op.required ?? false };
        }
        if (!c) reject("not a valid new criterion for this milestone");
        else {
          m.criteria.push(c);
          applied.push(`${m.id} + ${describeCriterion(c)}`);
        }
        break;
      }
      case "update_criterion": {
        const found = findCriterion(op.criterionId);
        if (!found) {
          reject(`unknown criterion ${op.criterionId}`);
          break;
        }
        const { c } = found;
        if (c.kind === "check" && c.checkId === "http_ok") {
          reject("the page-loads gate can't be changed");
          break;
        }
        if (op.weight !== undefined) c.weight = clampWeight(op.weight, c.weight);
        if (op.required !== undefined) c.required = op.required;
        if (c.kind === "judged") {
          if (op.rubric !== undefined) {
            const r = op.rubric.trim();
            if (r.length >= 15) c.rubric = r.slice(0, 300);
            else reject("question too short");
          }
          if (op.visual !== undefined) c.visual = op.visual;
        } else if (op.min !== undefined || op.maxKb !== undefined || op.items !== undefined) {
          const merged = { min: op.min ?? (c.params.min as number | undefined), maxKb: op.maxKb ?? (c.params.maxKb as number | undefined), items: op.items ?? ((c.params.fields ?? c.params.phrases) as string[] | undefined) };
          const params = checkParams(c.checkId, merged);
          if (params) c.params = params;
          else reject("invalid settings for this check");
        }
        applied.push(`updated ${c.id}`);
        break;
      }
      case "remove_criterion": {
        const found = findCriterion(op.criterionId);
        if (!found) reject(`unknown criterion ${op.criterionId}`);
        else if (found.c.kind === "check" && found.c.checkId === "http_ok") reject("the page-loads gate can't be removed");
        else if (found.m.criteria.length === 1) reject("a milestone needs at least one criterion");
        else {
          found.m.criteria = found.m.criteria.filter((x) => x !== found.c);
          applied.push(`removed ${found.c.id}`);
        }
        break;
      }
      case "set_terms": {
        const h = op.reviewWindowHours;
        const r = op.maxResubmissions;
        if (h !== undefined) {
          if (Number.isInteger(h) && h >= 1 && h <= 168) brief.terms.reviewWindowHours = h;
          else reject("review window must be 1-168 hours");
        }
        if (r !== undefined) {
          if (Number.isInteger(r) && r >= 0 && r <= 5) brief.terms.maxResubmissions = r;
          else reject("resubmissions must be 0-5");
        }
        applied.push("terms updated");
        break;
      }
    }
  }

  brief.totalCents = brief.milestones.reduce((s, m) => s + m.amountCents, 0);
  return { brief: Brief.parse(brief), applied, rejected };
}
