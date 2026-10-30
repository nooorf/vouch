/**
 * Real-world benchmark for the referee: public, open-source web apps and sites, each with a
 * realistic brief, the verdict a careful human reviewer would give, and human-verified truths for
 * individual criteria (established by rendering each page in a real browser on 2026-10-30).
 *
 * Criteria without a truth label (Lighthouse scores, link checks, phone-layout judgements) are
 * still run and scored by the policy, but not graded here: we can't label them confidently by hand.
 */
import { demoBrief } from "../../src/lib/brief/demo";
import type { Criterion } from "../../src/lib/brief/schema";
import type { Verdict } from "../../src/lib/policy/policy";

export interface BenchCase {
  id: string;
  title: string;
  url: string;
  repoUrl?: string;
  /** What kind of delivery this is, for the scorecard. */
  kind: "client-rendered app" | "server-rendered app" | "static site" | "template" | "dead link" | "wrong delivery";
  criteria: Criterion[];
  /** Verdicts a careful reviewer would accept. */
  truth: Verdict[];
  /** criterionId → should it pass? Only where a person can say for sure. */
  labels: Record<string, boolean>;
  why: string;
}

const check = (id: string, checkId: Extract<Criterion, { kind: "check" }>["checkId"], weight: number, params: Record<string, unknown> = {}, required = false): Criterion => ({
  kind: "check",
  id,
  checkId,
  params,
  weight,
  required,
});
const judged = (id: string, rubric: string, weight: number, opts: { required?: boolean; visual?: boolean } = {}): Criterion => ({
  kind: "judged",
  id,
  rubric,
  weight,
  required: opts.required ?? false,
  visual: opts.visual ?? false,
});

/* ---------------- briefs ---------------- */

const todoBrief: Criterion[] = [
  check("t-http", "http_ok", 1, {}, true),
  check("t-viewport", "viewport_meta", 2),
  check("t-h1", "has_h1", 2),
  check("t-text", "has_text", 2, { phrases: ["todos", "Double-click to edit a todo"] }),
  check("t-js", "no_js_errors", 2),
  check("t-a11y", "lighthouse_a11y", 2, { min: 80 }),
  judged("t-app", "Does the page show a todo list app with a text field for adding a new todo?", 3, { visual: true }),
];

const conduitBrief: Criterion[] = [
  check("r-http", "http_ok", 1, {}, true),
  check("r-viewport", "viewport_meta", 1),
  check("r-text", "has_text", 2, { phrases: ["Global Feed", "A place to share your"] }),
  check("r-links", "links_ok", 1),
  check("r-api", "no_failed_requests", 3),
  check("r-a11y", "lighthouse_a11y", 2, { min: 80 }),
  judged("r-feed", "Does the home page show a feed with at least one article, including its title and its author?", 4, { required: true }),
  judged("r-mobile", "In the phone screenshot, is the layout readable, with nothing overlapping or cut off?", 2, { visual: true }),
];

const agencyBrief: Criterion[] = [
  check("a-http", "http_ok", 1, {}, true),
  check("a-viewport", "viewport_meta", 1),
  check("a-sections", "min_sections", 2, { min: 5 }),
  check("a-form", "has_form", 3, { fields: ["name", "email", "phone", "message"] }),
  check("a-alt", "img_alt_ratio", 2, { minRatio: 0.9 }),
  check("a-links", "links_ok", 1),
  check("a-a11y", "lighthouse_a11y", 2, { min: 80 }),
  check("a-readme", "repo_readme", 1),
  judged("a-services", "Does the page describe at least three services in real, specific words (not placeholder text such as Lorem ipsum)?", 4, { required: true }),
];

const accessibilityBrief: Criterion[] = [
  check("w-http", "http_ok", 1, {}, true),
  check("w-alt", "img_alt_ratio", 3, { minRatio: 0.9 }),
  check("w-a11y", "lighthouse_a11y", 3, { min: 90 }, true),
  judged("w-copy", "Does the page present the CityLights site's news or headlines in readable text?", 2),
];

/* ---------------- cases ---------------- */

const todo = (impl: string, label: string): BenchCase => ({
  id: `todomvc-${impl}`,
  title: `TodoMVC (${label})`,
  url: `https://todomvc.com/examples/${impl}/dist/`,
  kind: "client-rendered app",
  criteria: todoBrief,
  truth: ["PASS", "PARTIAL"], // PARTIAL only if Lighthouse accessibility lands under 80
  labels: { "t-http": true, "t-viewport": true, "t-h1": true, "t-text": true, "t-js": true, "t-app": true },
  why: "A working todo app whose HTML is an empty shell until JavaScript runs.",
});

export const CASES: BenchCase[] = [
  todo("react", "React"),
  todo("vue", "Vue"),
  todo("javascript-es6", "vanilla JS"),
  {
    id: "realworld-vue",
    title: "RealWorld Conduit (Vue, working)",
    url: "https://vue3-realworld-example-app-mutoe.vercel.app/",
    kind: "client-rendered app",
    criteria: conduitBrief,
    truth: ["PASS", "PARTIAL"],
    labels: { "r-http": true, "r-viewport": true, "r-text": true, "r-api": true, "r-feed": true },
    why: "A working blogging app, rendered in the browser: the feed shows 4 articles.",
  },
  {
    id: "realworld-svelte",
    title: "RealWorld Conduit (Svelte, working)",
    url: "https://realworld.svelte.dev/",
    kind: "server-rendered app",
    criteria: conduitBrief,
    truth: ["PASS", "PARTIAL"],
    labels: { "r-http": true, "r-viewport": true, "r-text": true, "r-api": true, "r-feed": true },
    why: "The same app rendered on the server: the feed shows 4 articles.",
  },
  {
    id: "realworld-angular",
    title: "RealWorld Conduit (Angular, backend down)",
    url: "https://angular.realworld.io/",
    kind: "client-rendered app",
    criteria: conduitBrief,
    truth: ["FAIL"],
    labels: { "r-http": true, "r-viewport": true, "r-text": true, "r-api": false, "r-feed": false },
    why: "Loads, but shows “Loading articles…” forever: its API no longer answers.",
  },
  {
    id: "realworld-next",
    title: "RealWorld Conduit (Next.js, empty feed)",
    url: "https://next-realworld.vercel.app/",
    kind: "server-rendered app",
    criteria: conduitBrief,
    truth: ["FAIL"],
    labels: { "r-http": true, "r-viewport": true, "r-text": true, "r-api": false, "r-feed": false },
    why: "Renders the page shell, but the feed is empty: its API (api.realworld.io) no longer answers.",
  },
  {
    id: "agency-template",
    title: "Start Bootstrap Agency (template not customized)",
    url: "https://startbootstrap.github.io/startbootstrap-agency/",
    repoUrl: "https://github.com/StartBootstrap/startbootstrap-agency",
    kind: "template",
    criteria: agencyBrief,
    truth: ["FAIL"],
    labels: { "a-http": true, "a-viewport": true, "a-sections": true, "a-form": true, "a-alt": true, "a-readme": true, "a-services": false },
    why: "A polished template handed over as is: every service description is still Lorem ipsum.",
  },
  {
    id: "wrong-delivery",
    title: "Agency template submitted for the coffee roastery brief",
    url: "https://startbootstrap.github.io/startbootstrap-agency/",
    kind: "wrong delivery",
    criteria: demoBrief.milestones[0].criteria,
    truth: ["FAIL"],
    labels: { "m1-http": true, "m1-h1": false, "m1-sections": true, "m1-text": false, "m1-copy": false },
    why: "A real site, but not the one the brief asked for.",
  },
  {
    id: "dead-link",
    title: "A link that doesn't exist",
    url: "https://startbootstrap.github.io/startbootstrap-agency/this-page-does-not-exist.html",
    kind: "dead link",
    criteria: agencyBrief,
    truth: ["FAIL"],
    labels: { "a-http": false },
    why: "The delivery link returns 404.",
  },
  {
    id: "w3c-before",
    title: "W3C CityLights demo (inaccessible version)",
    url: "https://www.w3.org/WAI/demos/bad/before/home.html",
    kind: "static site",
    criteria: accessibilityBrief,
    truth: ["FAIL"],
    labels: { "w-http": true, "w-alt": false, "w-a11y": false, "w-copy": true },
    why: "The W3C's deliberately inaccessible demo: 21% of images have alt text.",
  },
  {
    id: "w3c-after",
    title: "W3C CityLights demo (fixed version)",
    url: "https://www.w3.org/WAI/demos/bad/after/home.html",
    kind: "static site",
    criteria: accessibilityBrief,
    truth: ["PASS"],
    labels: { "w-http": true, "w-alt": true, "w-a11y": true, "w-copy": true },
    why: "The same site with its accessibility fixed.",
  },
];
