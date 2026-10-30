/**
 * Held-out code cases: real open-source repositories with questions answered from the code.
 *
 * Labelled before the code judge ever ran on these repositories: each archive was downloaded and
 * unpacked with curl and tar (no referee code), and every label was checked by reading the files
 * (frozen 2026-10-30; fingerprint in internal/benchmark/heldout-freeze.md). Where it helps, the
 * comment names the file that decides the label.
 */
import type { Criterion } from "../../src/lib/brief/schema";
import type { BenchCase } from "./cases";

const http: Criterion = { kind: "check", id: "http", checkId: "http_ok", params: {}, weight: 1, required: true };
const code = (id: string, rubric: string, weight: number, required = false): Criterion => ({ kind: "judged", id, rubric, weight, required, visual: false, source: "code" });

const sauceBrief: Criterion[] = [
  http,
  code("s-locked", "Does the login show an error message when a locked-out user tries to sign in?", 2),
  code("s-tax", "Does the checkout add tax to the order total?", 2),
  code("s-tests", "Does the project include automated tests?", 2),
  code("s-auth", "Is the password checked on a server, rather than compared with a password written into the browser code?", 3),
];

export const CODE_CASES: BenchCase[] = [
  {
    set: "heldout",
    id: "repo-vue-realworld",
    title: "RealWorld Conduit, Vue 3 (code)",
    url: "https://vue3-realworld-example-app-mutoe.vercel.app/",
    repoUrl: "https://github.com/mutoe/vue3-realworld-example-app",
    kind: "repository",
    criteria: [
      http,
      code("k-tests", "Does the project include automated tests?", 2), // vitest + playwright/specs/*.spec.ts
      code("k-token", "After logging in, is the user's auth token saved in the browser so they stay logged in after a reload?", 3), // utils/storage.ts (localStorage) + store/user
      code("k-comments", "Can a logged-in user delete a comment on an article?", 2), // ArticleDetailComments.vue deleteArticleComment
      code("k-upload", "Can users upload a profile picture file from their device?", 2), // no: Settings.vue takes an image URL in a text field
    ],
    truth: ["PARTIAL"],
    labels: { http: true, "k-tests": true, "k-token": true, "k-comments": true, "k-upload": false },
    why: "A complete app with tests; the profile picture is a URL field, not a file upload.",
  },
  {
    set: "heldout",
    id: "repo-svelte-realworld",
    title: "RealWorld Conduit, SvelteKit (code)",
    url: "https://realworld.svelte.dev/",
    repoUrl: "https://github.com/sveltejs/realworld",
    kind: "repository",
    criteria: [
      http,
      code("v-api", "Are the articles loaded from the Conduit API rather than hard-coded in the app?", 3, true), // lib/api.js base = api.realworld.show
      code("v-session", "Is the logged-in session kept in a cookie?", 2), // cookies.set('jwt', …) in login/register actions
      code("v-tests", "Does the project include automated tests?", 2), // no test files, no test script
    ],
    truth: ["PARTIAL"],
    labels: { http: true, "v-api": true, "v-session": true, "v-tests": false },
    why: "A working app backed by the Conduit API, with no automated tests.",
  },
  {
    set: "heldout",
    id: "repo-freelancer-template",
    title: "Start Bootstrap Freelancer template (code)",
    url: "https://startbootstrap.github.io/startbootstrap-freelancer/",
    repoUrl: "https://github.com/StartBootstrap/startbootstrap-freelancer",
    kind: "repository",
    criteria: [
      http,
      code("f-email", "Does the contact form require a valid email address before it can be sent?", 2), // index.pug data-sb-validations='required,email'
      code("f-modals", "Does each portfolio item open a detail view in a modal window?", 2), // index.pug data-bs-toggle='modal'
      code("f-connected", "Is the contact form connected to a real form-handling service, rather than a placeholder setting?", 4, true), // no: data-sb-form-api-token='API_TOKEN'
    ],
    truth: ["FAIL"],
    labels: { http: true, "f-email": true, "f-modals": true, "f-connected": false },
    why: "The form validates input, but its form-service key is still the template's literal placeholder 'API_TOKEN', so messages go nowhere.",
  },
  {
    set: "heldout",
    id: "repo-saucedemo",
    title: "Swag Labs demo shop (code)",
    url: "https://www.saucedemo.com/",
    repoUrl: "https://github.com/saucelabs/sample-app-web",
    kind: "repository",
    criteria: sauceBrief,
    truth: ["PARTIAL"],
    // Login.jsx "Sorry, this user has been locked out."; orderCalculations.js tax 8%; jest + e2e specs;
    // Constants.js VALID_PASSWORD = "secret_sauce" compared in the browser.
    labels: { http: true, "s-locked": true, "s-tax": true, "s-tests": true, "s-auth": false },
    why: "A thorough demo shop with tests, but the password is compared with a constant in the browser code: there's no server check.",
  },
  {
    set: "heldout",
    id: "repo-hn-svelte",
    title: "Svelte Hacker News, Sapper version (code)",
    url: "https://hn.svelte.dev/",
    repoUrl: "https://github.com/sveltejs/hn.svelte.dev",
    kind: "repository",
    criteria: [
      http,
      code("h-api", "Does the app load its stories from a Hacker News API?", 3, true), // fetch(`https://api.hnpwa.com/v0/${list}/${page}.json`)
      code("h-offline", "Does the app use a service worker to cache files so it can work offline?", 2), // service-worker.js cache.addAll / caches.match
      code("h-comments", "Can users post new comments from the app?", 2), // no forms anywhere: read-only
    ],
    truth: ["PARTIAL"],
    labels: { http: true, "h-api": true, "h-offline": true, "h-comments": false },
    why: "A read-only news reader with offline caching; nobody can comment from it.",
  },
  {
    set: "heldout",
    id: "repo-wrong",
    title: "The Freelancer template's repo submitted for the shop's brief (code)",
    url: "https://www.saucedemo.com/",
    repoUrl: "https://github.com/StartBootstrap/startbootstrap-freelancer",
    kind: "wrong delivery",
    criteria: sauceBrief,
    truth: ["FAIL"],
    labels: { http: true, "s-locked": false, "s-tax": false, "s-tests": false, "s-auth": false },
    why: "A real repository, but not the one for this app: none of the shop's features are in it.",
  },
  {
    set: "heldout",
    id: "repo-missing",
    title: "Code questions with no repository link",
    url: "https://www.saucedemo.com/",
    kind: "repository",
    criteria: sauceBrief,
    truth: ["FAIL"],
    labels: { http: true, "s-locked": false, "s-tax": false, "s-tests": false, "s-auth": false },
    why: "The brief asks about the code, and no repository was submitted.",
  },
];
