import { describe, expect, it } from "vitest";
import { lintBrief, measuredShare } from "./lint";
import { demoBrief } from "./demo";
import { normalizeDraft, RawDraft, splitByShares } from "./normalize";

describe("splitByShares", () => {
  it("adds up exactly, giving leftover cents to the largest remainders", () => {
    expect(splitByShares(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(splitByShares(40000, [38, 37, 25])).toEqual([15200, 14800, 10000]);
    const parts = splitByShares(99999, [33, 33, 34]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(99999);
  });

  it("treats missing or broken shares as equal", () => {
    expect(splitByShares(900, [0, 0, 0])).toEqual([300, 300, 300]);
    expect(splitByShares(900, [NaN, -5, 0])).toEqual([300, 300, 300]);
  });
});

const sloppy = RawDraft.parse({
  title: "  Coffee site  ",
  summary: "A landing page.",
  milestones: [
    {
      title: "Structure",
      sharePercent: 40,
      dueInDays: 99,
      criteria: [
        { kind: "check", checkId: "min_sections", min: 500, weight: 50 },
        { kind: "check", checkId: "looks_amazing", weight: 3 },
        { kind: "check", checkId: "has_text", items: [], weight: 2 },
        { kind: "judged", rubric: "nice?", weight: 2 },
        { kind: "judged", rubric: "Does the copy mention single-origin beans?", weight: 3 },
        { kind: "check", checkId: "min_sections", min: 3, weight: 1 },
      ],
    },
    { title: "", sharePercent: 40, dueInDays: 2, criteria: [{ kind: "check", checkId: "has_form", weight: 2 }] },
  ],
});

describe("normalizeDraft", () => {
  const brief = normalizeDraft(sloppy, { totalCents: 40000, deadlineDays: 14 });

  it("produces a valid brief whose milestones add up to the total", () => {
    expect(brief.milestones.reduce((s, m) => s + m.amountCents, 0)).toBe(40000);
    expect(brief.title).toBe("Coffee site");
  });

  it("clamps params and weights, and drops unknown, duplicate and empty criteria", () => {
    const m1 = brief.milestones[0];
    const kinds = m1.criteria.map((c) => (c.kind === "check" ? c.checkId : "judged"));
    expect(kinds).toEqual(["http_ok", "min_sections", "judged"]);
    const sections = m1.criteria[1];
    expect(sections.kind === "check" && sections.params).toEqual({ min: 20 });
    expect(sections.weight).toBe(10);
  });

  it("keeps http_ok as a weight-1 gate even if the AI weights it heavily", () => {
    const heavy = RawDraft.parse({
      title: "t",
      summary: "",
      milestones: [{ title: "M", sharePercent: 100, dueInDays: 3, criteria: [{ kind: "check", checkId: "http_ok", weight: 10 }, { kind: "check", checkId: "has_h1", weight: 4 }] }],
    });
    const first = normalizeDraft(heavy, { totalCents: 10000, deadlineDays: 5 }).milestones[0].criteria[0];
    expect(first).toMatchObject({ checkId: "http_ok", weight: 1, required: true });
  });

  it("puts a required http_ok first and numbers criterion ids", () => {
    for (const m of brief.milestones) {
      const first = m.criteria[0];
      expect(first.kind === "check" && first.checkId).toBe("http_ok");
      expect(first.required).toBe(true);
    }
    expect(brief.milestones[0].criteria.map((c) => c.id)).toEqual(["m1-c1", "m1-c2", "m1-c3"]);
  });

  it("keeps due days inside the deadline and in order", () => {
    expect(brief.milestones.map((m) => m.dueInDays)).toEqual([14, 14]);
  });

  it("fills sensible defaults for missing params and titles", () => {
    const m2 = brief.milestones[1];
    expect(m2.title).toBe("Milestone 2");
    const form = m2.criteria.find((c) => c.kind === "check" && c.checkId === "has_form");
    expect(form?.kind === "check" && form.params).toEqual({ fields: ["name", "email", "message"] });
  });
});

describe("lintBrief", () => {
  it("passes the demo brief without warnings", () => {
    expect(lintBrief(demoBrief).filter((l) => l.level === "warn")).toEqual([]);
  });

  it("flags vague wording, non-questions and AI-only milestones", () => {
    const brief = structuredClone(demoBrief);
    brief.milestones[0].criteria = [
      { kind: "check", id: "a", checkId: "http_ok", params: {}, weight: 1, required: true },
      { kind: "judged", id: "b", rubric: "The site looks modern and professional", weight: 5, required: false, visual: false },
    ];
    const lints = lintBrief(brief).filter((l) => l.milestoneId === "m1");
    expect(lints.map((l) => l.message)).toEqual([
      expect.stringMatching(/Only AI-judged criteria/),
      expect.stringMatching(/"modern" is a matter of taste/),
      expect.stringMatching(/yes\/no question/),
    ]);
  });

  it("computes the measured share of a milestone", () => {
    expect(measuredShare(demoBrief.milestones[1])).toBeCloseTo(0.8);
  });
});
