import { describe, expect, it } from "vitest";
import { demoBrief } from "./demo";
import { describeCriterion } from "./describe";
import { diffBriefs } from "./diff";

describe("describeCriterion", () => {
  it("reads like plain English", () => {
    const [, h1, sections, text, copy] = demoBrief.milestones[0].criteria;
    expect(describeCriterion(h1)).toBe("The page has exactly one main heading");
    expect(describeCriterion(sections)).toBe("The page has at least 4 content sections");
    expect(describeCriterion(text)).toBe("The page mentions “single-origin”, “wholesale”");
    expect(describeCriterion(copy)).toMatch(/specialty coffee roastery/);
  });
});

describe("diffBriefs", () => {
  it("finds nothing between identical briefs", () => {
    expect(diffBriefs(demoBrief, structuredClone(demoBrief))).toEqual([]);
  });

  it("reports amounts, due days, totals and criteria in plain words", () => {
    const after = structuredClone(demoBrief);
    after.milestones[1].amountCents = 20000;
    after.totalCents = 45000;
    after.milestones[1].dueInDays = 12;
    after.milestones[0].criteria[2] = { ...after.milestones[0].criteria[2], params: { min: 6 } } as typeof after.milestones[0]["criteria"][2];
    after.milestones[2].criteria.push({ kind: "judged", id: "m3-new", rubric: "Does the contact form show a thank-you message?", weight: 2, required: false, visual: false });
    after.terms.reviewWindowHours = 48;

    const texts = diffBriefs(demoBrief, after).map((c) => `${c.where} | ${c.kind} | ${c.text}`);
    expect(texts).toEqual([
      "Job | changed | Total: $400 → $450",
      "Terms | changed | Review window: 24 h → 48 h",
      "M1 Structure and copy | changed | “The page has at least 4 content sections” → “The page has at least 6 content sections”",
      "M2 Responsive and accessible | changed | Amount: $150 → $200",
      "M2 Responsive and accessible | changed | Due: day 10 → day 12",
      "M3 Contact form and launch | added | Criterion added: Does the contact form show a thank-you message?",
    ]);
  });

  it("reports added and removed milestones", () => {
    const after = structuredClone(demoBrief);
    const removed = after.milestones.pop()!;
    after.milestones.push({ ...removed, id: "m4", title: "Launch" });
    const kinds = diffBriefs(demoBrief, after).map((c) => [c.kind, c.where]);
    expect(kinds).toContainEqual(["removed", "M3 Contact form and launch"]);
    expect(kinds).toContainEqual(["added", "M3 Launch"]);
  });
});
