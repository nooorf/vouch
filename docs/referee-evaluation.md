# How well does the referee judge real websites?

Vouch releases money when a delivery meets its brief, so the referee has to be right on sites it has never seen. This report runs the referee, exactly as production runs it, on public websites with realistic briefs, and compares its answers with labels a person set by looking at each site.

Run 2026-10-30 17:35 UTC · commit `d81c1c1` · AI judge: gemini-3.5-flash-lite · browser: local Chrome

| Set | Sites | Verdicts right | Criteria right | Money released that shouldn't have been |
| --- | --- | --- | --- | --- |
| **Held-out** (labelled before the referee ever ran on them) | 18 | **18/18** | **85/85** | **0 cases** |
| Development (the sites we built against) | 12 | 12/12 | 59/59 | 0 cases |

**What to read from this.** The held-out labels were frozen (and fingerprinted) before the referee saw those sites. Its first run (17/18 verdicts, 82/85 criteria) found two general bugs, which we fixed for every site, not for these cases: each fix is a rule about web pages in general, tested with made-up pages. Nothing in the referee refers to a benchmark site. The development set shows the approach works on the sites that shaped it.

**The column that matters most for an escrow** is the last one: a referee that wrongly withholds money can be corrected by the client's approval or a dispute, but one that wrongly releases money can't.

**What we don't claim.** This isn't a claim that the referee is right on every site. 30 sites is a small sample, and the limits below are real. What the design guarantees instead: every measured check shows its evidence, AI "yes" answers must quote the page, and anything the referee can't measure goes to a person instead of being guessed.

## What the referee covers

- **20 measured checks** in 4 groups (page 11, web app in a real browser 3, Lighthouse 3, GitHub repo 3), each a fixed rule with plain-English evidence.
- **AI-judged criteria** for what rules can't measure (is the copy real, does the page show a feed of articles), answered from the page text or a phone screenshot. A "yes" must quote the page, and code checks the quote is really there.
- **Safety rules** in code, not in the AI: a failed required check releases nothing whatever the AI says; content aimed at the AI grader (including text hidden by CSS) sends the delivery to a person; placeholder-only evidence turns a "yes" into a "no"; unreachable pages and unmeasurable checks become "a person decides", not "fail".
- **Delivery kinds tested:** client-rendered app, server-rendered app, template, wrong delivery, dead link, static site, broken app, not mobile-friendly, insecure link, server error, slow page.

## Held-out set

### What the first run caught

2026-10-30 16:34 UTC, working tree on top of commit d81c1c1: 17/18 verdicts, 82/85 criteria, 0 cases of money released wrongly.

- **Quotes to Scrape**: expected PARTIAL, got NEEDS_HUMAN. *A referee bug.* The AI quoted the page correctly, but our quote checker stripped curly quote marks from the AI's quote and not from the page, so the quote “wasn't found” and the case went to a person. The safe direction: nothing was released wrongly. Fixed after the run: quote marks, apostrophes and dashes are normalized on both sides, with unit tests.
- **HTML5 UP “Forty” template**: verdict right (FAIL), 3 criteria wrong. Our single page fetch timed out (10 s) from our network, though the page loaded in 5 s while we labelled it, so “loads in under 5 seconds” failed and the rest couldn't be checked. Fixed after the run: a timeout gets one more try before it counts.

### Where the referee caught what our labeller missed

- **Web Scraper test shop**: looks like a working shop, with laptops and phones and their prices, and we labelled it as meeting a brief for a site that sells products. The referee said no, quoting the page: “Items listed here are not for sale.” It was right: a client who asked for a shop wouldn't accept one that says its items aren't for sale. We corrected our label (recorded, with a new fingerprint); no referee code changed.

### Latest run

**18/18 verdicts** (100%) · **85/85 criteria** (100%)

| Delivery | Kind | Correct verdict | Referee | Criteria right |
| --- | --- | --- | --- | --- |
| Quotes to Scrape (JavaScript-rendered) | client-rendered app | PARTIAL | PARTIAL ✓ | 7/7 |
| A bookshop submitted for the quotes-site brief | wrong delivery | FAIL | FAIL ✓ | 4/4 |
| Books to Scrape (server-rendered catalogue) | server-rendered app | PASS | PASS ✓ | 7/7 |
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

## By kind of delivery (both sets)

| Kind | Verdicts right | Criteria right |
| --- | --- | --- |
| client-rendered app | 8/8 | 47/47 |
| server-rendered app | 5/5 | 29/29 |
| static site | 5/5 | 25/25 |
| template | 3/3 | 16/16 |
| wrong delivery | 2/2 | 9/9 |
| broken app | 2/2 | 7/7 |
| dead link | 1/1 | 1/1 |
| not mobile-friendly | 1/1 | 4/4 |
| insecure link | 1/1 | 3/3 |
| server error | 1/1 | 1/1 |
| slow page | 1/1 | 2/2 |

## By check (labelled criteria, both sets)

| Check | Right |
| --- | --- |
| Site loads over HTTPS | 30/30 |
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
| FAIL → FAIL | 16 |
| PARTIAL → PARTIAL | 1 |
| PASS → PASS | 7 |
| PASS/PARTIAL → PASS | 6 |

## How this was measured

- **Briefs** are written the way a client would write them, using the same criteria the app offers: measured checks plus yes/no questions for the AI judge. A milestone of $100 is assumed; verdicts follow the same policy as production (pass bar 90% of weight, partial bar 50%, required criteria must pass).
- **Labels:** each site was loaded on a phone and a desktop by an inspector script that shares no code with the referee; a person then decided each label from its screenshots and raw facts. Only criteria a person can say for sure are labelled; others (Lighthouse scores, borderline layout calls) still count toward the verdict but aren't graded.
- **Held-out freeze:** held-out briefs and labels were fingerprinted (SHA-256) before the first run. The first run's result and misses are recorded above. A miss may lead to a referee fix only when the fix is general (a rule about web pages, tested with made-up pages). A label changes only when review shows the label itself was wrong; that has happened once (the Web Scraper shop, above), and the correction is recorded with a new fingerprint.
- **Network, AI quota and Lighthouse:** a case whose site couldn't be reached, whose AI judge was busy (free-tier rate limits) or whose Lighthouse run failed on Google's side is retried up to three times, since the benchmark measures the referee, not our connection or other services.
- **Reproduce:** `npm run eval -- referee` (needs a Gemini key; Chrome locally or a Kernel key).

## Known limits

- **One page per delivery.** The referee judges the delivered URL, not the whole site; criteria about other pages need their own link.
- **No clicking through flows.** It loads pages; it doesn't log in, submit forms or complete a checkout.
- **What "visible" means.** Text a browser draws counts as visible even if it's the same colour as the background; content behind JavaScript accordions or tabs isn't read (native <details> sections are opened).
- **Loading has a limit.** A page gets 20 s to load and 10 s more for its data; slower apps are judged on what they show by then.
- **Phone fit is one phone.** 390 px wide, an iPhone-sized screen.
- **The AI judge can be wrong,** which is why its "yes" must quote the page, low confidence goes to a person, and either side can dispute a result once.
- **Small sample.** 30 sites. Enough to show the approach and catch real bugs, not enough for precise accuracy numbers.
