import { formatCents } from "@/lib/money";
import { describeCriterion } from "./describe";
import type { Brief, Criterion, Milestone } from "./schema";

export interface Change {
  /** Which part of the brief, e.g. "M2 Responsive and accessible". */
  where: string;
  kind: "added" | "removed" | "changed";
  text: string;
}

const label = (m: Milestone, i: number) => `M${i + 1} ${m.title}`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What a judged question is answered from, in words (matches the brief editor's three choices). */
const judgedFrom = (c: { visual?: boolean; source?: "page" | "code" }) => (c.source === "code" ? "the code in the repo" : c.visual ? "a screenshot" : "the page text");

function diffCriteria(where: string, before: Criterion[], after: Criterion[], out: Change[]) {
  const prev = new Map(before.map((c) => [c.id, c]));
  const next = new Map(after.map((c) => [c.id, c]));
  for (const c of before) {
    if (!next.has(c.id)) out.push({ where, kind: "removed", text: `Criterion removed: ${describeCriterion(c)}` });
  }
  for (const c of after) {
    const old = prev.get(c.id);
    if (!old) {
      out.push({ where, kind: "added", text: `Criterion added: ${describeCriterion(c)}` });
      continue;
    }
    if (describeCriterion(old) !== describeCriterion(c) || old.kind !== c.kind) {
      out.push({ where, kind: "changed", text: `“${describeCriterion(old)}” → “${describeCriterion(c)}”` });
    }
    if (old.weight !== c.weight) out.push({ where, kind: "changed", text: `Weight of “${describeCriterion(c)}”: ${old.weight} → ${c.weight}` });
    if (old.required !== c.required) {
      out.push({ where, kind: "changed", text: `“${describeCriterion(c)}” is ${c.required ? "now required" : "no longer required"}` });
    }
    if (old.kind === "judged" && c.kind === "judged" && judgedFrom(old) !== judgedFrom(c)) {
      out.push({ where, kind: "changed", text: `“${describeCriterion(c)}” is now judged from ${judgedFrom(c)} (was ${judgedFrom(old)})` });
    }
  }
}

/** What changed between two versions of a brief, in plain words. Ids keep identity across versions. */
export function diffBriefs(before: Brief, after: Brief): Change[] {
  const out: Change[] = [];
  if (before.title !== after.title) out.push({ where: "Job", kind: "changed", text: `Title: “${before.title}” → “${after.title}”` });
  if (before.summary !== after.summary) out.push({ where: "Job", kind: "changed", text: "Summary rewritten" });
  if (before.totalCents !== after.totalCents) {
    out.push({ where: "Job", kind: "changed", text: `Total: ${formatCents(before.totalCents)} → ${formatCents(after.totalCents)}` });
  }
  if (before.terms.reviewWindowHours !== after.terms.reviewWindowHours) {
    out.push({ where: "Terms", kind: "changed", text: `Review window: ${before.terms.reviewWindowHours} h → ${after.terms.reviewWindowHours} h` });
  }
  if (before.terms.maxResubmissions !== after.terms.maxResubmissions) {
    out.push({ where: "Terms", kind: "changed", text: `Resubmissions allowed: ${before.terms.maxResubmissions} → ${after.terms.maxResubmissions}` });
  }

  const prev = new Map(before.milestones.map((m, i) => [m.id, { m, i }]));
  const nextIds = new Set(after.milestones.map((m) => m.id));
  before.milestones.forEach((m, i) => {
    if (!nextIds.has(m.id)) out.push({ where: label(m, i), kind: "removed", text: `Milestone removed (${formatCents(m.amountCents)})` });
  });
  after.milestones.forEach((m, i) => {
    const where = label(m, i);
    const old = prev.get(m.id)?.m;
    if (!old) {
      out.push({ where, kind: "added", text: `Milestone added: ${formatCents(m.amountCents)}, due day ${m.dueInDays}` });
      return;
    }
    if (old.title !== m.title) out.push({ where, kind: "changed", text: `Renamed from “${old.title}”` });
    if (old.amountCents !== m.amountCents) out.push({ where, kind: "changed", text: `Amount: ${formatCents(old.amountCents)} → ${formatCents(m.amountCents)}` });
    if (old.dueInDays !== m.dueInDays) out.push({ where, kind: "changed", text: `Due: day ${old.dueInDays} → day ${m.dueInDays}` });
    if (old.description !== m.description) out.push({ where, kind: "changed", text: "Description updated" });
    if (!sameJson(old.criteria, m.criteria)) diffCriteria(where, old.criteria, m.criteria, out);
  });
  return out;
}
