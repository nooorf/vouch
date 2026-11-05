# How well does the referee judge real deliveries?

Vouch releases money when a delivery meets its brief, so the referee has to be right on work it has never seen. This report runs the referee, exactly as production runs it, on public websites and open-source repositories with realistic briefs, and compares its answers with labels a person set by looking at each site and reading each repository's code.

Run 2026-10-30 19:30 UTC · commit `6d0421b` · AI judge: gemini-3.5-flash-lite · browser: local Chrome

| Set | Sites | Verdicts right | Criteria right | Money released that shouldn't have been |
| --- | --- | --- | --- | --- |
| **Held-out websites** (labelled before the referee ever ran on them) | 18 | **18/18** | **85/85** | **0 cases** |
| **Held-out repositories** (code questions, labelled from the source before the code judge ran) | 7 | **7/7** | **32/32** | **0 cases** |
| Development (the sites I built against) | 12 | 12/12 | 59/59 | 0 cases |

**What to read from this.** The held-out labels were frozen (and fingerprinted) before the referee saw those sites. Its first run (16/18 verdicts, 81/85 criteria, 1 wrong release) and repeat runs found three general weaknesses, which I fixed for every site, not for these cases: each fix is a rule about web pages or code in general, tested with made-up examples. Nothing in the referee refers to a benchmark site. The development set shows the approach works on the sites that shaped it.

**The column that matters most when money is on the line** is the last one: a referee that wrongly withholds money can be corrected by the client's approval or a dispute, but one that wrongly releases money can't.

**What I don't claim.** This isn't a claim that the referee is right on every site or repository. 37 deliveries is a small sample, and the limits below are real. What the design guarantees instead: every measured check shows its evidence, AI "yes" answers must quote the page or the code, and anything the referee can't measure goes to a person instead of being guessed.

## What the referee covers

- **20 measured checks** in 4 groups (page 11, web app in a real browser 3, Lighthouse 3, GitHub repo 3), each a fixed rule with plain-English evidence.
- **AI-judged criteria** for what rules can't measure (is the copy real, does the page show a feed of articles), answered from the page text or a phone screenshot. A "yes" must quote the page, and code checks the quote is really there.
- **AI-judged code questions** (does the form validate the email, is there a server-side password check) answered from the delivered GitHub repository, read at a pinned commit. A "yes" must cite file and lines, and code finds that code in the file; the card shows the real lines, linked on GitHub.
- **Safety rules** in code, not in the AI: a failed required check releases nothing whatever the AI says; content aimed at the AI grader (including text hidden by CSS, and comments in the code) sends the delivery to a person; placeholder-only evidence turns a "yes" into a "no"; unreachable pages and unmeasurable checks become "a person decides", not "fail".
- **Delivery kinds tested:** client-rendered app, server-rendered app, template, wrong delivery, dead link, static site, broken app, not mobile-friendly, insecure link, server error, slow page, repository.

## Held-out websites

### What the first run caught

2026-10-30 16:34 UTC, working tree on top of commit d81c1c1: 16/18 verdicts, 81/85 criteria, 1 cases of money released wrongly.

- **Quotes to Scrape**: expected PARTIAL, got NEEDS_HUMAN. *A referee bug.* The AI quoted the page correctly, but the quote checker stripped curly quote marks from the AI's quote and not from the page, so the quote “wasn't found” and the case went to a person. The safe direction: nothing was released wrongly. Fixed after the run: quote marks, apostrophes and dashes are normalized on both sides, with unit tests.
- **Books to Scrape**: expected FAIL, got PASS: *money released that shouldn't have been.* The page warns that it's “a demo website for web scraping purposes” with randomly assigned prices; the judge looked at the books and prices and said yes. (My own first label made the same mistake; see below.) Fixed after repeat runs showed the same weakness on the Web Scraper shop: the judge now treats a statement that undercuts the question as counting against it.
- **HTML5 UP “Forty” template**: verdict right (FAIL), 3 criteria wrong. The single page fetch timed out (10 s) from my network, though the page loaded in 5 s while I labelled it, so “loads in under 5 seconds” failed and the rest couldn't be checked. Fixed after the run: a timeout gets one more try before it counts.

### Where the referee caught what my labels missed

- **Books to Scrape**: once the judge read pages as a client would, it said no, quoting the page's warning that it's a demo with randomly assigned prices. My label had missed that warning too. Corrected the same way, with a new fingerprint.
- **Web Scraper test shop**: looks like a working shop, with laptops and phones and their prices, and I labelled it as meeting a brief for a site that sells products. The referee said no, quoting the page: “Items listed here are not for sale.” It was right: a client who asked for a shop wouldn't accept one that says its items aren't for sale. I corrected my label (recorded, with a new fingerprint); no referee code changed.

### Latest run

**18/18 verdicts** (100%) · **85/85 criteria** (100%)

| Delivery | Kind | Correct verdict | Referee | Criteria right |
| --- | --- | --- | --- | --- |
| Quotes to Scrape (JavaScript-rendered) | client-rendered app | PARTIAL | PARTIAL ✓ | 7/7 |
| A bookshop submitted for the quotes-site brief | wrong delivery | FAIL | FAIL ✓ | 4/4 |
| Books to Scrape (says it's a demo with random prices) | server-rendered app | FAIL | FAIL ✓ | 7/7 |
| Web Scraper test shop (says its items are not for sale) | server-rendered app | FAIL | FAIL ✓ | 6/6 |
| Swag Labs login (React) | client-rendered app | PASS | PASS ✓ | 6/6 |
| Bootstrap checkout example | static site | PASS | PASS ✓ | 5/5 |
| Bootstrap pricing example | static site | PASS | PASS ✓ | 5/5 |
| Svelte Hacker News | server-rendered app | PASS | PASS ✓ | 6/6 |
| Vite home page | static site | PASS | PASS ✓ | 7/7 |
| TodoMVC (Preact) | client-rendered app | PASS / PARTIAL | PASS ✓ | 6/6 |
| Bootstrap album example submitted as a photographer's portfolio | template | FAIL | FAIL ✓ | 5/5 |
| HTML5 UP “Forty” template submitted as an agency site | template | FAIL | FAIL ✓ | 4/4 |
| A gallery with broken images | broken app | FAIL | FAIL ✓ | 4/4 |
| A page that crashes on load | broken app | FAIL | FAIL ✓ | 3/3 |
| Space Jam (1996) submitted as a mobile-friendly promo site | not mobile-friendly | FAIL | FAIL ✓ | 4/4 |
| The first website, delivered as an http:// link | insecure link | FAIL | FAIL ✓ | 3/3 |
| A link that returns HTTP 500 | server error | FAIL | FAIL ✓ | 1/1 |
| A page that takes 8 seconds to answer | slow page | FAIL | FAIL ✓ | 2/2 |

No held-out misses on this run.

## Held-out repositories

Questions answered from the delivered code, on public open-source projects, with labels set by reading the source (each label names the file that decides it in `evals/benchmark/code-cases.ts`).

**7/7 verdicts** (100%) · **32/32 criteria** (100%)

| Delivery | Kind | Correct verdict | Referee | Criteria right |
| --- | --- | --- | --- | --- |
| RealWorld Conduit, Vue 3 (code) | repository | PARTIAL | PARTIAL ✓ | 5/5 |
| RealWorld Conduit, SvelteKit (code) | repository | PARTIAL | PARTIAL ✓ | 4/4 |
| Start Bootstrap Freelancer template (code) | repository | FAIL | FAIL ✓ | 4/4 |
| Swag Labs demo shop (code) | repository | PARTIAL | PARTIAL ✓ | 5/5 |
| Svelte Hacker News, Sapper version (code) | repository | PARTIAL | PARTIAL ✓ | 4/4 |
| The Freelancer template's repo submitted for the shop's brief (code) | wrong delivery | FAIL | FAIL ✓ | 5/5 |
| Code questions with no repository link | repository | FAIL | FAIL ✓ | 5/5 |

Read at: `StartBootstrap/startbootstrap-freelancer@5bc65b4`, `mutoe/vue3-realworld-example-app@741c215`, `saucelabs/sample-app-web@ad62bb2`, `sveltejs/hn.svelte.dev@0010bbe`, `sveltejs/realworld@df79670`.

No misses on this run.

## Development results

**12/12 verdicts** (100%) · **59/59 criteria** (100%)

| Delivery | Kind | Correct verdict | Referee | Criteria right |
| --- | --- | --- | --- | --- |
| TodoMVC (React) | client-rendered app | PASS / PARTIAL | PASS ✓ | 6/6 |
| TodoMVC (Vue) | client-rendered app | PASS / PARTIAL | PASS ✓ | 6/6 |
| TodoMVC (vanilla JS) | client-rendered app | PASS / PARTIAL | PASS ✓ | 6/6 |
| RealWorld Conduit (Vue, working) | client-rendered app | PASS / PARTIAL | PASS ✓ | 5/5 |
| RealWorld Conduit (Svelte, working) | server-rendered app | PASS / PARTIAL | PASS ✓ | 5/5 |
| RealWorld Conduit (Angular, backend down) | client-rendered app | FAIL | FAIL ✓ | 5/5 |
| RealWorld Conduit (Next.js, empty feed) | server-rendered app | FAIL | FAIL ✓ | 5/5 |
| Start Bootstrap Agency (template not customized) | template | FAIL | FAIL ✓ | 7/7 |
| Agency template submitted for the coffee roastery brief | wrong delivery | FAIL | FAIL ✓ | 5/5 |
| A link that doesn't exist | dead link | FAIL | FAIL ✓ | 1/1 |
| W3C CityLights demo (inaccessible version) | static site | FAIL | FAIL ✓ | 4/4 |
| W3C CityLights demo (fixed version) | static site | PASS | PASS ✓ | 4/4 |

No development misses on this run.

## What repeat runs showed

- **Disclaimers were read inconsistently.** On one run the Web Scraper shop (which says “Items listed here are not for sale”) came out PASS, the costly direction: the page lists different products on each visit, and the judge sometimes read only the products. Books to Scrape (“a demo website… prices randomly assigned”) had the same weakness from the first run. Fix: the judge now reads the page as the client would, and a statement that undercuts the question (“not for sale”, “demo only”, “coming soon”, “sample data”) counts against it. Three fresh repeats of the Web Scraper case all came out FAIL, Books to Scrape now does too, and the page-judge eval still passes.
- **Code answers depended on which files the judge saw.** In a 121-file repository, big low-signal files (a stylesheet whose class names mention “comment”, a generated API client, docs, test fixtures) used up the budget, and the small files that decide the answers were left out; the judge then cited docs or tests, and some quotes didn't verify (those cases went to a person). Fix: standard search-engine ranking (BM25: rare words count more, repeats count less), whole-word matching, implementation code before tests and styles unless the question is about them, each question's own best files first, and a short list of general web vocabulary (“saved in the browser” finds localStorage).
- **Outside services fail.** GitHub's API limit (60 an hour without a token), DNS failures on my network, a busy free-tier AI and Google's Lighthouse service each spoiled a run. The referee handled them safely (“a person decides”), and the code snapshot no longer uses GitHub's API at all, but they say nothing about judging, so the benchmark retries them with growing waits.

## By kind of delivery (all sets)

| Kind | Verdicts right | Criteria right |
| --- | --- | --- |
| client-rendered app | 8/8 | 47/47 |
| repository | 6/6 | 27/27 |
| server-rendered app | 5/5 | 29/29 |
| static site | 5/5 | 25/25 |
| template | 3/3 | 16/16 |
| wrong delivery | 3/3 | 14/14 |
| broken app | 2/2 | 7/7 |
| dead link | 1/1 | 1/1 |
| not mobile-friendly | 1/1 | 4/4 |
| insecure link | 1/1 | 3/3 |
| server error | 1/1 | 1/1 |
| slow page | 1/1 | 2/2 |

## By check (labelled criteria, all sets)

| Check | Right |
| --- | --- |
| Site loads over HTTPS | 37/37 |
| AI judge (code) | 25/25 |
| AI judge (page text) | 21/21 |
| Required phrases | 16/16 |
| Has a main heading | 14/14 |
| Mobile viewport tag | 12/12 |
| Runs without JavaScript errors | 12/12 |
| Fits a phone screen | 9/9 |
| No failed requests | 7/7 |
| AI judge (screenshot) | 6/6 |
| Image alt text | 6/6 |
| Form with fields | 4/4 |
| Content sections | 3/3 |
| Lighthouse accessibility | 2/2 |
| README in repo | 1/1 |
| No placeholder text | 1/1 |

## Expected verdict → referee's verdict

| | Cases |
| --- | --- |
| FAIL → FAIL | 20 |
| PARTIAL → PARTIAL | 5 |
| PASS → PASS | 6 |
| PASS/PARTIAL → PASS | 6 |

## How this was measured

- **Briefs** are written the way a client would write them, using the same criteria the app offers: measured checks plus yes/no questions for the AI judge. A milestone of $100 is assumed; verdicts follow the same policy as production (pass bar 90% of weight, partial bar 50%, required criteria must pass).
- **Labels:** each site was loaded on a phone and a desktop by an inspector script that shares no code with the referee; a person then decided each label from its screenshots and raw facts. Only criteria a person can say for sure are labelled; others (Lighthouse scores, borderline layout calls) still count toward the verdict but aren't graded.
- **Held-out freeze:** held-out briefs and labels were fingerprinted (SHA-256) before the first run. The first run's result and misses are recorded above. A miss may lead to a referee fix only when the fix is general (a rule about web pages, tested with made-up pages). A label changes only when review shows the label itself was wrong; that has happened once (the Web Scraper shop, above), and the correction is recorded with a new fingerprint.
- **Network, AI quota and Lighthouse:** a case whose site couldn't be reached, whose AI judge was busy (free-tier rate limits) or whose Lighthouse run failed on Google's side is retried up to three times, since the benchmark measures the referee, not my connection or other services.
- **Reproduce:** `npm run eval -- referee` (needs a Gemini key; Chrome locally or a Kernel key).

## Known limits

- **It checks pages, not whole journeys.** The referee loads the delivered page on a phone and a desktop; it doesn't log in, fill in forms or click through a checkout. Briefs that need those can link each page as its own check.
- **The AI judge can be wrong.** That's why every AI "yes" must quote the page or the code, low-confidence answers go to a person, and either side can dispute a result.
