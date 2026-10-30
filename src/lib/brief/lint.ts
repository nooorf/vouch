import type { Brief, Criterion, Milestone } from "./schema";

export interface Lint {
  milestoneId: string;
  criterionId?: string;
  level: "warn" | "info";
  message: string;
}

/** Words that sound like criteria but can't be checked. */
const VAGUE = [
  "good",
  "nice",
  "great",
  "modern",
  "beautiful",
  "pretty",
  "professional",
  "clean",
  "sleek",
  "user-friendly",
  "user friendly",
  "high quality",
  "high-quality",
  "awesome",
  "attractive",
  "engaging",
  "appealing",
  "polished",
  "stunning",
  "intuitive",
];

const vagueRe = new RegExp(`\\b(${VAGUE.map((w) => w.replace(/[-\s]/g, "[-\\s]")).join("|")})\\b`, "i");

/** Share of a milestone's weight backed by measured checks, 0..1. */
export function measuredShare(m: Pick<Milestone, "criteria">): number {
  const total = m.criteria.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return 0;
  return m.criteria.filter((c) => c.kind === "check").reduce((s, c) => s + c.weight, 0) / total;
}

function lintCriterion(m: Milestone, c: Criterion): Lint[] {
  const out: Lint[] = [];
  const at = { milestoneId: m.id, criterionId: c.id };
  if (c.kind === "judged") {
    const word = c.rubric.match(vagueRe)?.[1];
    if (word) {
      out.push({
        ...at,
        level: "warn",
        message: `"${word}" is a matter of taste. Say what a reviewer should see on the page instead.`,
      });
    }
    if (!c.rubric.trim().endsWith("?")) {
      out.push({ ...at, level: "info", message: "Phrase it as a yes/no question, so the answer is clear." });
    }
  } else {
    if (c.checkId === "has_text" && !((c.params.phrases as string[] | undefined)?.length)) {
      out.push({ ...at, level: "warn", message: "Add at least one phrase to look for." });
    }
    if (c.checkId === "has_form" && !((c.params.fields as string[] | undefined)?.length)) {
      out.push({ ...at, level: "warn", message: "Name at least one form field." });
    }
  }
  return out;
}

export function lintBrief(brief: Brief): Lint[] {
  const out: Lint[] = [];
  for (const m of brief.milestones) {
    const meaningfulChecks = m.criteria.filter((c) => c.kind === "check" && c.checkId !== "http_ok");
    if (meaningfulChecks.length === 0) {
      out.push({
        milestoneId: m.id,
        level: "warn",
        message: "Only AI-judged criteria. Add a measured check so part of this payment rests on facts.",
      });
    } else if (measuredShare(m) < 0.4) {
      out.push({
        milestoneId: m.id,
        level: "info",
        message: "Most of this payment depends on AI judgement. Consider more weight on measured checks.",
      });
    }
    for (const c of m.criteria) out.push(...lintCriterion(m, c));
  }
  return out;
}
