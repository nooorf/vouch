/**
 * Real-world benchmark for the referee: public web apps and sites, each with a realistic brief,
 * the verdict a careful human reviewer would give, and human-verified truths for individual
 * criteria.
 *
 * Two sets:
 * - "dev": the sites we built the referee against. We fixed what they revealed, so their score
 *   shows the approach works, not how it generalizes.
 * - "heldout": new sites, picked for variety and labelled from screenshots and page text by an
 *   inspector that shares no code with the referee, BEFORE the referee ever ran on them (labels
 *   frozen 2026-10-30; see internal/benchmark/heldout-freeze.md). We don't tune against them: a
 *   miss here is reported, not fixed-and-rerun.
 *
 * Criteria without a truth label (Lighthouse scores, judgement calls) are still run and scored by
 * the policy, but not graded: we only label what a person can say for sure.
 */
import { demoBrief } from "../../src/lib/brief/demo";
import type { Criterion } from "../../src/lib/brief/schema";
import type { Verdict } from "../../src/lib/policy/policy";

export interface BenchCase {
  id: string;
  set: "dev" | "heldout";
  title: string;
  url: string;
  repoUrl?: string;
  /** What kind of delivery this is, for the scorecard. */
  kind:
    | "client-rendered app"
    | "server-rendered app"
    | "static site"
    | "template"
    | "dead link"
    | "wrong delivery"
    | "broken app"
    | "server error"
    | "slow page"
    | "insecure link"
    | "not mobile-friendly";
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

const todo = (impl: string, label: string, set: BenchCase["set"] = "dev"): BenchCase => ({
  id: `todomvc-${impl}`,
  set,
  title: `TodoMVC (${label})`,
  url: `https://todomvc.com/examples/${impl}/dist/`,
  kind: "client-rendered app",
  criteria: todoBrief,
  truth: ["PASS", "PARTIAL"], // PARTIAL only if Lighthouse accessibility lands under 80
  labels: { "t-http": true, "t-viewport": true, "t-h1": true, "t-text": true, "t-js": true, "t-app": true },
  why: "A working todo app whose HTML is an empty shell until JavaScript runs.",
});

export const DEV_CASES: BenchCase[] = [
  todo("react", "React"),
  todo("vue", "Vue"),
  todo("javascript-es6", "vanilla JS"),
  {
    set: "dev",
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
    set: "dev",
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
    set: "dev",
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
    set: "dev",
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
    set: "dev",
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
    set: "dev",
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
    set: "dev",
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
    set: "dev",
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
    set: "dev",
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

/* ---------------- held-out set (labelled before the referee ran) ---------------- */

const quotesBrief: Criterion[] = [
  check("q-http", "http_ok", 1, {}, true),
  check("q-h1", "has_h1", 1),
  check("q-text", "has_text", 2, { phrases: ["Albert Einstein", "Tags"] }),
  check("q-js", "no_js_errors", 2),
  check("q-phone", "no_horizontal_scroll", 2),
  check("q-viewport", "viewport_meta", 1),
  judged("q-list", "Does the page list several quotes, each with its author?", 3, { required: true }),
];

const shopBrief = (prefix: string, phrases: string[]): Criterion[] => [
  check(`${prefix}-http`, "http_ok", 1, {}, true),
  check(`${prefix}-text`, "has_text", 2, { phrases }),
  check(`${prefix}-js`, "no_js_errors", 2),
  check(`${prefix}-phone`, "no_horizontal_scroll", 2),
  judged(`${prefix}-products`, "Does the page show products for sale, each with a name and a price?", 3, { required: true }),
];

const plainPageBrief: Criterion[] = [
  check("x-http", "http_ok", 2, {}, true),
  check("x-h1", "has_h1", 1),
  judged("x-content", "Does the page present real content for visitors (not an error message or raw data)?", 2),
];

export const HELDOUT_CASES: BenchCase[] = [
  {
    set: "heldout",
    id: "quotes-js",
    title: "Quotes to Scrape (JavaScript-rendered)",
    url: "https://quotes.toscrape.com/js/",
    kind: "client-rendered app",
    criteria: quotesBrief,
    truth: ["PARTIAL"],
    labels: { "q-http": true, "q-h1": true, "q-text": true, "q-js": true, "q-phone": false, "q-viewport": false, "q-list": true },
    why: "Quotes are built by JavaScript and render fine, but there's no viewport tag: phones get a shrunk 980px desktop layout.",
  },
  {
    set: "heldout",
    id: "wrong-delivery-books",
    title: "A bookshop submitted for the quotes-site brief",
    url: "https://books.toscrape.com/",
    kind: "wrong delivery",
    criteria: quotesBrief,
    truth: ["FAIL"],
    labels: { "q-http": true, "q-h1": true, "q-text": false, "q-list": false },
    why: "A working site, but it lists books, not quotes.",
  },
  {
    set: "heldout",
    id: "books-toscrape",
    title: "Books to Scrape (server-rendered catalogue)",
    url: "https://books.toscrape.com/",
    kind: "server-rendered app",
    criteria: [
      ...shopBrief("b", ["In stock", "All products"]),
      check("b-alt", "img_alt_ratio", 2, { minRatio: 0.9 }),
      check("b-h1", "has_h1", 1),
    ],
    truth: ["PASS"],
    labels: { "b-http": true, "b-text": true, "b-js": true, "b-phone": true, "b-products": true, "b-alt": true, "b-h1": true },
    why: "A working catalogue: 20 books with covers (all with alt text), prices and stock.",
  },
  {
    set: "heldout",
    id: "webscraper-shop",
    title: "Web Scraper test shop (says its items are not for sale)",
    url: "https://webscraper.io/test-sites/e-commerce/allinone",
    kind: "server-rendered app",
    criteria: [...shopBrief("w", ["Computers", "Phones"]), check("w-req", "no_failed_requests", 2)],
    truth: ["FAIL"],
    // Corrected after the first run (see internal/benchmark/heldout-freeze.md): we first labelled
    // w-products true and the verdict PASS, missing the page's own disclaimer.
    labels: { "w-http": true, "w-text": true, "w-js": true, "w-phone": true, "w-products": false, "w-req": true },
    why: "Looks like a working shop, with products and prices, but it says “Items listed here are not for sale.” A client who asked for a site to sell products wouldn't accept that. Its analytics beacons are cancelled by the browser, which says nothing about the shop.",
  },
  {
    set: "heldout",
    id: "saucedemo-login",
    title: "Swag Labs login (React)",
    url: "https://www.saucedemo.com/",
    kind: "client-rendered app",
    criteria: [
      check("s-http", "http_ok", 1, {}, true),
      check("s-form", "has_form", 3, { fields: ["username", "password"] }),
      check("s-js", "no_js_errors", 2),
      check("s-phone", "no_horizontal_scroll", 2),
      check("s-viewport", "viewport_meta", 1),
      judged("s-login", "Does the page show a login screen where a user enters a username and a password?", 3, { required: true }),
    ],
    truth: ["PASS"],
    labels: { "s-http": true, "s-form": true, "s-js": true, "s-phone": true, "s-viewport": true, "s-login": true },
    why: "A working React login page.",
  },
  {
    set: "heldout",
    id: "bootstrap-checkout",
    title: "Bootstrap checkout example",
    url: "https://getbootstrap.com/docs/5.3/examples/checkout/",
    kind: "static site",
    criteria: [
      check("c-http", "http_ok", 1, {}, true),
      check("c-h1", "has_h1", 1),
      check("c-form", "has_form", 3, { fields: ["first name", "last name", "email", "address"] }),
      check("c-js", "no_js_errors", 2),
      judged("c-cart", "Does the page show an order summary with item prices and a total?", 3, { required: true }),
    ],
    truth: ["PASS"],
    labels: { "c-http": true, "c-h1": true, "c-form": true, "c-js": true, "c-cart": true },
    why: "A complete checkout form with a cart summary.",
  },
  {
    set: "heldout",
    id: "bootstrap-pricing",
    title: "Bootstrap pricing example",
    url: "https://getbootstrap.com/docs/5.3/examples/pricing/",
    kind: "static site",
    criteria: [
      check("p-http", "http_ok", 1, {}, true),
      check("p-h1", "has_h1", 1),
      check("p-text", "has_text", 2, { phrases: ["$15/mo", "Enterprise"] }),
      check("p-phone", "no_horizontal_scroll", 2),
      judged("p-tiers", "Does the page show three pricing plans, each with a monthly price and a list of what's included?", 4, { required: true }),
    ],
    truth: ["PASS"],
    labels: { "p-http": true, "p-h1": true, "p-text": true, "p-phone": true, "p-tiers": true },
    why: "Three plans with prices and features. The prices are marked up as h1s, which is unusual but valid.",
  },
  {
    set: "heldout",
    id: "hn-svelte",
    title: "Svelte Hacker News",
    url: "https://hn.svelte.dev/",
    kind: "server-rendered app",
    criteria: [
      check("n-http", "http_ok", 1, {}, true),
      check("n-h1", "has_h1", 1),
      check("n-js", "no_js_errors", 2),
      check("n-api", "no_failed_requests", 2),
      check("n-phone", "no_horizontal_scroll", 2),
      judged("n-stories", "Does the page list news stories, each with its points and number of comments?", 4, { required: true }),
    ],
    truth: ["PASS"],
    labels: { "n-http": true, "n-h1": false, "n-js": true, "n-api": true, "n-phone": true, "n-stories": true },
    why: "A working news reader. It has no h1 (the stories are h2s), so that one check rightly fails.",
  },
  {
    set: "heldout",
    id: "vite-landing",
    title: "Vite home page",
    url: "https://vite.dev/",
    kind: "static site",
    criteria: [
      check("v-http", "http_ok", 1, {}, true),
      check("v-h1", "has_h1", 1),
      check("v-text", "has_text", 2, { phrases: ["Get Started"] }),
      check("v-sections", "min_sections", 2, { min: 4 }),
      check("v-js", "no_js_errors", 2),
      check("v-phone", "no_horizontal_scroll", 2),
      judged("v-pitch", "Does the page explain what the tool does and link to a getting-started guide?", 3, { required: true }),
    ],
    truth: ["PASS"],
    labels: { "v-http": true, "v-h1": true, "v-text": true, "v-sections": true, "v-js": true, "v-phone": true, "v-pitch": true },
    why: "A polished product landing page.",
  },
  todo("preact", "Preact", "heldout"),
  {
    set: "heldout",
    id: "bootstrap-album",
    title: "Bootstrap album example submitted as a photographer's portfolio",
    url: "https://getbootstrap.com/docs/5.3/examples/album/",
    kind: "template",
    criteria: [
      check("a-http", "http_ok", 1, {}, true),
      check("a-h1", "has_h1", 1),
      check("a-phone", "no_horizontal_scroll", 2),
      judged("a-photos", "Does the page show the photographer's actual photos (real images, not grey placeholder boxes)?", 4, { required: true, visual: true }),
      judged("a-copy", "Does the page describe the photographer and their work in specific words, rather than generic template text?", 3),
    ],
    truth: ["FAIL"],
    labels: { "a-http": true, "a-h1": true, "a-phone": true, "a-photos": false, "a-copy": false },
    why: "The template as shipped: grey “Thumbnail” boxes and generic copy (“Something short and leading about the collection below”). No Lorem ipsum, so only judgement catches it.",
  },
  {
    set: "heldout",
    id: "html5up-forty",
    title: "HTML5 UP “Forty” template submitted as an agency site",
    url: "https://html5up.net/uploads/demos/forty/",
    kind: "template",
    criteria: [
      check("f-http", "http_ok", 1, {}, true),
      check("f-form", "has_form", 3, { fields: ["name", "email", "message"] }),
      check("f-placeholder", "no_placeholder_text", 2),
      judged("f-services", "Does the page describe the agency's services in real, specific words (not placeholder text such as Lorem ipsum)?", 4, { required: true }),
    ],
    truth: ["FAIL"],
    labels: { "f-http": true, "f-form": true, "f-placeholder": false, "f-services": false },
    why: "A good-looking template whose copy is still Lorem ipsum.",
  },
  {
    set: "heldout",
    id: "broken-images",
    title: "A gallery with broken images",
    url: "https://the-internet.herokuapp.com/broken_images",
    kind: "broken app",
    criteria: [
      check("i-http", "http_ok", 1, {}, true),
      check("i-req", "no_failed_requests", 3),
      check("i-alt", "img_alt_ratio", 2, { minRatio: 0.9 }),
      judged("i-images", "In the phone screenshot, do all the images on the page display properly (none broken)?", 3, { visual: true }),
    ],
    truth: ["FAIL"],
    labels: { "i-http": true, "i-req": false, "i-alt": false, "i-images": false },
    why: "Two of its three images return 404 and show as broken; only one of four img tags has alt text.",
  },
  {
    set: "heldout",
    id: "js-error",
    title: "A page that crashes on load",
    url: "https://the-internet.herokuapp.com/javascript_error",
    kind: "broken app",
    criteria: [
      check("e-http", "http_ok", 1, {}, true),
      check("e-js", "no_js_errors", 3, {}, true),
      check("e-text", "has_text", 1, { phrases: ["JavaScript error"] }),
    ],
    truth: ["FAIL"],
    labels: { "e-http": true, "e-js": false, "e-text": true },
    why: "Throws “Cannot read properties of undefined” in its onload handler.",
  },
  {
    set: "heldout",
    id: "spacejam-1996",
    title: "Space Jam (1996) submitted as a mobile-friendly promo site",
    url: "https://www.spacejam.com/1996/",
    kind: "not mobile-friendly",
    criteria: [
      check("j-http", "http_ok", 1, {}, true),
      check("j-viewport", "viewport_meta", 2, {}, true),
      check("j-phone", "no_horizontal_scroll", 2),
      check("j-alt", "img_alt_ratio", 2, { minRatio: 0.9 }),
    ],
    truth: ["FAIL"],
    labels: { "j-http": true, "j-viewport": false, "j-phone": false, "j-alt": true },
    why: "A 1996 table layout with no viewport tag: phones show it shrunk. Every image does have alt text.",
  },
  {
    set: "heldout",
    id: "insecure-link",
    title: "The first website, delivered as an http:// link",
    url: "http://info.cern.ch/",
    kind: "insecure link",
    criteria: plainPageBrief,
    truth: ["FAIL"],
    labels: { "x-http": false, "x-h1": true, "x-content": true },
    why: "The delivered link is plain http and doesn't redirect to HTTPS (the server also answers on HTTPS, but that isn't what was delivered).",
  },
  {
    set: "heldout",
    id: "server-error",
    title: "A link that returns HTTP 500",
    url: "https://postman-echo.com/status/500",
    kind: "server error",
    criteria: plainPageBrief,
    truth: ["FAIL"],
    labels: { "x-http": false },
    why: "The server answers with an error.",
  },
  {
    set: "heldout",
    id: "slow-page",
    title: "A page that takes 8 seconds to answer",
    url: "https://postman-echo.com/delay/8",
    kind: "slow page",
    criteria: plainPageBrief,
    truth: ["FAIL"],
    labels: { "x-http": false, "x-content": false },
    why: "Answers after 8 seconds (the brief allows 5), and with raw JSON rather than a page.",
  },
];

export const CASES: BenchCase[] = [...DEV_CASES, ...HELDOUT_CASES];
