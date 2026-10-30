import { z } from "zod";

/** How the editor renders one param, and how the AI is told about it. */
export type ParamField =
  | { key: string; type: "int"; label: string; min: number; max: number; suffix?: string }
  | { key: string; type: "percent"; label: string }
  | { key: string; type: "list"; label: string; placeholder: string };

interface CheckDef {
  label: string;
  /** One line for the AI prompt and the editor's help text. */
  help: string;
  group: "page" | "app" | "lighthouse" | "repo";
  params: z.ZodType;
  fields: ParamField[];
}

/**
 * The check library. The brief generator may only pick checks from here, which is what keeps
 * verdicts reproducible. Safe to import in the browser (no Node APIs).
 */
export const CHECKS = {
  http_ok: {
    label: "Site loads over HTTPS",
    help: "Page returns 200 over HTTPS in under 5 seconds.",
    group: "page",
    params: z.object({}),
    fields: [],
  },
  has_h1: {
    label: "Has a main heading",
    help: "Page has a main heading (h1).",
    group: "page",
    params: z.object({}),
    fields: [],
  },
  min_sections: {
    label: "Content sections",
    help: "Page has at least N section or h2 blocks.",
    group: "page",
    params: z.object({ min: z.number().int().min(1).max(20) }),
    fields: [{ key: "min", type: "int", label: "At least", min: 1, max: 20, suffix: "sections" }],
  },
  viewport_meta: {
    label: "Mobile viewport tag",
    help: "Page has a viewport meta tag for phones.",
    group: "page",
    params: z.object({}),
    fields: [],
  },
  responsive_css: {
    label: "Responsive CSS",
    help: "Styles use media queries or fluid units.",
    group: "page",
    params: z.object({}),
    fields: [],
  },
  img_alt_ratio: {
    label: "Image alt text",
    help: "Share of images with alt text is at least the given ratio.",
    group: "page",
    params: z.object({ minRatio: z.number().min(0).max(1) }),
    fields: [{ key: "minRatio", type: "percent", label: "At least" }],
  },
  has_form: {
    label: "Form with fields",
    help: "Page has a form with inputs named like the given fields.",
    group: "page",
    params: z.object({ fields: z.array(z.string().min(1).max(40)).min(1).max(10) }),
    fields: [{ key: "fields", type: "list", label: "Fields", placeholder: "name, email, message" }],
  },
  has_text: {
    label: "Required phrases",
    help: "Page text contains every given phrase (case-insensitive).",
    group: "page",
    params: z.object({ phrases: z.array(z.string().min(1).max(60)).min(1).max(10) }),
    fields: [{ key: "phrases", type: "list", label: "Phrases", placeholder: "wholesale, opening hours" }],
  },
  no_placeholder_text: {
    label: "No placeholder text",
    help: "The page has no leftover template text such as Lorem ipsum or “Project Name”.",
    group: "page",
    params: z.object({}),
    fields: [],
  },
  links_ok: {
    label: "Links work",
    help: "Up to 10 internal links return 200.",
    group: "page",
    params: z.object({}),
    fields: [],
  },
  page_weight: {
    label: "Page size",
    help: "HTML document is under the given size in KB.",
    group: "page",
    params: z.object({ maxKb: z.number().int().min(10).max(5000) }),
    fields: [{ key: "maxKb", type: "int", label: "At most", min: 10, max: 5000, suffix: "KB" }],
  },
  // Measured in a real browser (needed for web apps that render with JavaScript).
  no_js_errors: {
    label: "Runs without JavaScript errors",
    help: "Loaded in a real browser, the page throws no uncaught JavaScript errors.",
    group: "app",
    params: z.object({}),
    fields: [],
  },
  no_failed_requests: {
    label: "No failed requests",
    help: "In a real browser, every API call answers and the site's own scripts, styles and images load (no errors, no 4xx/5xx).",
    group: "app",
    params: z.object({}),
    fields: [],
  },
  no_horizontal_scroll: {
    label: "Fits a phone screen",
    help: "On a 390-pixel-wide phone, nothing spills off the side of the screen.",
    group: "app",
    params: z.object({}),
    fields: [],
  },
  lighthouse_a11y: {
    label: "Lighthouse accessibility",
    help: "Google Lighthouse accessibility score on mobile is at least N (0-100).",
    group: "lighthouse",
    params: z.object({ min: z.number().int().min(0).max(100) }),
    fields: [{ key: "min", type: "int", label: "Score at least", min: 0, max: 100 }],
  },
  lighthouse_perf: {
    label: "Lighthouse performance",
    help: "Google Lighthouse performance score on mobile is at least N (0-100).",
    group: "lighthouse",
    params: z.object({ min: z.number().int().min(0).max(100) }),
    fields: [{ key: "min", type: "int", label: "Score at least", min: 0, max: 100 }],
  },
  lighthouse_seo: {
    label: "Lighthouse SEO",
    help: "Google Lighthouse SEO score is at least N (0-100).",
    group: "lighthouse",
    params: z.object({ min: z.number().int().min(0).max(100) }),
    fields: [{ key: "min", type: "int", label: "Score at least", min: 0, max: 100 }],
  },
  repo_readme: {
    label: "README in repo",
    help: "The GitHub repo has a README with real content.",
    group: "repo",
    params: z.object({}),
    fields: [],
  },
  repo_fresh_commits: {
    label: "New commits",
    help: "The GitHub repo has commits made after the job was funded.",
    group: "repo",
    params: z.object({}),
    fields: [],
  },
  ci_passing: {
    label: "CI passing",
    help: "Latest GitHub Actions run on the default branch succeeded.",
    group: "repo",
    params: z.object({}),
    fields: [],
  },
} as const satisfies Record<string, CheckDef>;

export type CheckId = keyof typeof CHECKS;
export const CHECK_IDS = Object.keys(CHECKS) as [CheckId, ...CheckId[]];

export function isCheckId(value: unknown): value is CheckId {
  return typeof value === "string" && value in CHECKS;
}

/** Sensible starting params when a check is added in the editor. */
export const DEFAULT_PARAMS: Record<CheckId, Record<string, unknown>> = {
  http_ok: {},
  has_h1: {},
  min_sections: { min: 4 },
  viewport_meta: {},
  responsive_css: {},
  img_alt_ratio: { minRatio: 0.9 },
  has_form: { fields: ["name", "email", "message"] },
  has_text: { phrases: [] },
  no_placeholder_text: {},
  links_ok: {},
  page_weight: { maxKb: 500 },
  no_js_errors: {},
  no_failed_requests: {},
  no_horizontal_scroll: {},
  lighthouse_a11y: { min: 90 },
  lighthouse_perf: { min: 70 },
  lighthouse_seo: { min: 90 },
  repo_readme: {},
  repo_fresh_commits: {},
  ci_passing: {},
};
