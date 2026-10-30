import { describe, expect, it } from "vitest";
import { demoBrief } from "./demo";
import { diffBriefs } from "./diff";
import { applyOps, type EditOp } from "./revise";

describe("applyOps", () => {
  it("changes an amount and keeps the total in step", () => {
    const { brief, rejected } = applyOps(demoBrief, [{ op: "set_milestone_amount", milestoneId: "m1", amountUsd: 210 }]);
    expect(rejected).toEqual([]);
    expect(brief.milestones[0].amountCents).toBe(21000);
    expect(brief.totalCents).toBe(46000);
    expect(diffBriefs(demoBrief, brief).map((c) => c.text)).toEqual(["Total: $400 → $460", "Amount: $150 → $210"]);
  });

  it("adds a milestone and criteria to it through its temporary key", () => {
    const ops: EditOp[] = [
      { op: "add_milestone", newMilestoneKey: "new1", title: "Blog section", amountUsd: 80, dueInDays: 20 },
      { op: "add_criterion", milestoneId: "new1", kind: "check", checkId: "min_sections", min: 2, weight: 3 },
      { op: "add_criterion", milestoneId: "new1", kind: "judged", rubric: "Does the blog list at least three posts with dates?", weight: 2 },
    ];
    const { brief, rejected } = applyOps(demoBrief, ops);
    expect(rejected).toEqual([]);
    const m4 = brief.milestones[3];
    expect(m4.id).toBe("m4");
    expect(m4.criteria.map((c) => c.id)).toEqual(["m4-c1", "m4-x1", "m4-x2"]);
    expect(m4.criteria[0]).toMatchObject({ checkId: "http_ok", required: true });
  });

  it("updates check settings and judged questions", () => {
    const { brief } = applyOps(demoBrief, [
      { op: "update_criterion", criterionId: "m1-sections", min: 6 },
      { op: "update_criterion", criterionId: "m1-text", items: ["single-origin", "wholesale", "café locations"] },
      { op: "update_criterion", criterionId: "m1-copy", rubric: "Does the copy name the roastery's three café locations?", weight: 4 },
    ]);
    const [, , sections, text, copy] = brief.milestones[0].criteria;
    expect(sections.kind === "check" && sections.params).toEqual({ min: 6 });
    expect(text.kind === "check" && text.params).toEqual({ phrases: ["single-origin", "wholesale", "café locations"] });
    expect(copy).toMatchObject({ rubric: "Does the copy name the roastery's three café locations?", weight: 4 });
  });

  it("merges an added check the milestone already has instead of rejecting it", () => {
    const { brief, rejected } = applyOps(demoBrief, [
      { op: "add_criterion", milestoneId: "m1", kind: "check", checkId: "has_text", items: ["Shoreditch", "Hackney", "wholesale"] },
    ]);
    expect(rejected).toEqual([]);
    const text = brief.milestones[0].criteria.find((c) => c.kind === "check" && c.checkId === "has_text");
    expect(text?.kind === "check" && text.params).toEqual({ phrases: ["single-origin", "wholesale", "Shoreditch", "Hackney"] });
    expect(brief.milestones[0].criteria).toHaveLength(demoBrief.milestones[0].criteria.length);
  });

  it("rejects what doesn't fit and keeps the rest", () => {
    const { brief, applied, rejected } = applyOps(demoBrief, [
      { op: "remove_criterion", criterionId: "m1-http" },
      { op: "set_milestone_amount", milestoneId: "m9", amountUsd: 10 },
      { op: "set_milestone_due", milestoneId: "m2", dueInDays: 40 },
      { op: "add_criterion", milestoneId: "m1", kind: "check", checkId: "http_ok" },
      { op: "add_criterion", milestoneId: "m1", kind: "check", checkId: "telepathy" },
      { op: "set_terms", reviewWindowHours: 48 },
    ]);
    expect(rejected).toHaveLength(4); // re-adding the automatic http_ok gate is a silent no-op
    expect(applied).toEqual(["terms updated"]);
    expect(brief.terms.reviewWindowHours).toBe(48);
    expect(brief.milestones[0].criteria).toHaveLength(demoBrief.milestones[0].criteria.length);
  });

  it("is deterministic", () => {
    const ops: EditOp[] = [{ op: "add_criterion", milestoneId: "m2", kind: "check", checkId: "lighthouse_seo", min: 80 }];
    expect(applyOps(demoBrief, ops)).toEqual(applyOps(demoBrief, ops));
  });

  it("never mutates its input", () => {
    const before = JSON.stringify(demoBrief);
    applyOps(demoBrief, [{ op: "remove_milestone", milestoneId: "m3" }]);
    expect(JSON.stringify(demoBrief)).toBe(before);
  });
});
