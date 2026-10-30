import type { Brief } from "./schema";

/** The Coffee Roastery job used by the demo seed and the video. $400 over three milestones. */
export const demoBrief: Brief = {
  title: "Landing page for Ember & Oak Coffee Roasters",
  summary:
    "A one-page marketing site for a specialty coffee roastery: story, bean origins, wholesale info and a contact form.",
  currency: "USD",
  totalCents: 40000,
  terms: { reviewWindowHours: 24, maxResubmissions: 2 },
  milestones: [
    {
      id: "m1",
      title: "Structure and copy",
      description: "All sections in place with real copy.",
      amountCents: 15000,
      dueInDays: 5,
      criteria: [
        { kind: "check", id: "m1-http", checkId: "http_ok", params: {}, weight: 1, required: true },
        { kind: "check", id: "m1-h1", checkId: "has_h1", params: {}, weight: 2, required: false },
        { kind: "check", id: "m1-sections", checkId: "min_sections", params: { min: 4 }, weight: 2, required: false },
        { kind: "check", id: "m1-text", checkId: "has_text", params: { phrases: ["single-origin", "wholesale"] }, weight: 2, required: false },
        { kind: "judged", id: "m1-copy", rubric: "Does the copy read as written for a specialty coffee roastery, not generic filler text?", weight: 3, required: false, visual: false },
      ],
    },
    {
      id: "m2",
      title: "Responsive and accessible",
      description: "Works on phones and meets basic accessibility.",
      amountCents: 15000,
      dueInDays: 10,
      criteria: [
        { kind: "check", id: "m2-http", checkId: "http_ok", params: {}, weight: 1, required: true },
        { kind: "check", id: "m2-viewport", checkId: "viewport_meta", params: {}, weight: 2, required: false },
        { kind: "check", id: "m2-alt", checkId: "img_alt_ratio", params: { minRatio: 0.9 }, weight: 2, required: false },
        { kind: "check", id: "m2-css", checkId: "responsive_css", params: {}, weight: 2, required: false },
        { kind: "check", id: "m2-a11y", checkId: "lighthouse_a11y", params: { min: 90 }, weight: 2, required: false },
        { kind: "judged", id: "m2-mobile", rubric: "In the mobile screenshot, is the layout readable with no overlapping or cut-off content?", weight: 1, required: false, visual: true },
      ],
    },
    {
      id: "m3",
      title: "Contact form and launch",
      description: "Working contact form, links checked, repo handed over.",
      amountCents: 10000,
      dueInDays: 14,
      criteria: [
        { kind: "check", id: "m3-http", checkId: "http_ok", params: {}, weight: 1, required: true },
        { kind: "check", id: "m3-form", checkId: "has_form", params: { fields: ["name", "email", "message"] }, weight: 3, required: true },
        { kind: "check", id: "m3-links", checkId: "links_ok", params: {}, weight: 2, required: false },
        { kind: "check", id: "m3-perf", checkId: "lighthouse_perf", params: { min: 70 }, weight: 2, required: false },
        { kind: "check", id: "m3-readme", checkId: "repo_readme", params: {}, weight: 1, required: false },
        { kind: "check", id: "m3-ci", checkId: "ci_passing", params: {}, weight: 2, required: false },
      ],
    },
  ],
};
