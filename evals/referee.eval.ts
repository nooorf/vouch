import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { assessDelivery } from "../src/lib/referee/evaluate";
import type { Verdict } from "../src/lib/policy/policy";
import { CHECKS } from "../src/lib/brief/checks";
import { CASES as ALL_CASES, type BenchCase } from "./benchmark/cases";
import type { CaseResult, Scorer, Suite } from "./harness";

/** Compact result: enough to grade and to explain. */
export interface RefereeOutput {
  verdict: Verdict;
  statuses: Record<string, "pass" | "fail" | "error">;
  evidence: Record<string, string>;
  reasons: string[];
  page: string;
  lighthouse: string;
  judgeModel: string | null;
}

const verdictScorer = (c: BenchCase): Scorer<RefereeOutput> => (o) => ({
  name: `verdict ${c.truth.join("/")}`,
  pass: c.truth.includes(o.verdict),
  detail: `got ${o.verdict}${o.reasons.length ? ` (${o.reasons.join("; ")})` : ""}`,
});

const labelScorer = (id: string, shouldPass: boolean): Scorer<RefereeOutput> => (o) => ({
  name: `${id} ${shouldPass ? "passes" : "fails"}`,
  pass: (o.statuses[id] === "pass") === shouldPass && o.statuses[id] !== "error",
  detail: `got ${o.statuses[id] ?? "missing"}: ${o.evidence[id] ?? ""}`.slice(0, 220),
});

/**
 * The first run on the held-out set, recorded by hand right after it finished, with what its misses
 * taught us. Fixes are allowed only when they're general (they apply to any site, and are tested
 * with made-up pages), so later runs are reported as the score; this keeps the history visible.
 */
const HELDOUT_FIRST_RUN = {
  when: "2026-10-30 16:34 UTC, working tree on top of commit d81c1c1",
  // Scored against the corrected Web Scraper label (see below); against the original label: 16/18, 81/85.
  verdicts: "17/18",
  criteria: "82/85",
  overReleases: 0,
  misses: [
    "**Quotes to Scrape**: expected PARTIAL, got NEEDS_HUMAN. *A referee bug.* The AI quoted the page correctly, but our quote checker stripped curly quote marks from the AI's quote and not from the page, so the quote “wasn't found” and the case went to a person. The safe direction: nothing was released wrongly. Fixed after the run: quote marks, apostrophes and dashes are normalized on both sides, with unit tests.",
    "**HTML5 UP “Forty” template**: verdict right (FAIL), 3 criteria wrong. Our single page fetch timed out (10 s) from our network, though the page loaded in 5 s while we labelled it, so “loads in under 5 seconds” failed and the rest couldn't be checked. Fixed after the run: a timeout gets one more try before it counts.",
  ],
  /** Where the referee was right and our label was wrong. */
  caught: [
    "**Web Scraper test shop**: looks like a working shop, with laptops and phones and their prices, and we labelled it as meeting a brief for a site that sells products. The referee said no, quoting the page: “Items listed here are not for sale.” It was right: a client who asked for a shop wouldn't accept one that says its items aren't for sale. We corrected our label (recorded, with a new fingerprint); no referee code changed.",
  ],
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

interface Tally {
  verdicts: number;
  verdictsRight: number;
  labels: number;
  labelsRight: number;
}
const tally = (): Tally => ({ verdicts: 0, verdictsRight: 0, labels: 0, labelsRight: 0 });

/** What kind of measurement a criterion is, for the per-check breakdown. */
function criterionKind(c: BenchCase, id: string): string {
  const crit = c.criteria.find((x) => x.id === id);
  if (!crit) return "?";
  if (crit.kind === "judged") return crit.visual ? "AI judge (screenshot)" : "AI judge (page text)";
  return CHECKS[crit.checkId].label;
}

/** The public evaluation report: held-out and development results, by kind and by check, misses and limits. */
function writeReport(results: CaseResult[]) {
  const commit = (() => {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return "unknown";
    }
  })();
  const byId = new Map(CASES.map((c) => [c.id, c]));
  const sets: Record<BenchCase["set"], Tally> = { heldout: tally(), dev: tally() };
  const kinds = new Map<string, Tally>();
  const checks = new Map<string, Tally>();
  const confusion = new Map<string, number>();
  const rows: Record<BenchCase["set"], string[]> = { heldout: [], dev: [] };
  const misses: Record<BenchCase["set"], string[]> = { heldout: [], dev: [] };
  const models = new Set<string>();
  /** Expected FAIL but the referee would release money (PASS or PARTIAL): the costly mistake. */
  const overReleases: Record<BenchCase["set"], number> = { heldout: 0, dev: 0 };

  for (const r of results) {
    const c = byId.get(r.id)!;
    const out = r.output as RefereeOutput | undefined;
    if (out?.judgeModel) models.add(out.judgeModel);
    const verdictOk = r.scores[0]?.pass ?? false;
    const labelScores = r.scores.slice(1);
    const wrong = labelScores.filter((s) => !s.pass);
    const kind = kinds.get(c.kind) ?? tally();
    kinds.set(c.kind, kind);
    for (const t of [sets[c.set], kind]) {
      t.verdicts++;
      if (verdictOk) t.verdictsRight++;
      t.labels += labelScores.length;
      t.labelsRight += labelScores.length - wrong.length;
    }
    for (const [i, id] of Object.keys(c.labels).entries()) {
      const k = criterionKind(c, id);
      const t = checks.get(k) ?? tally();
      checks.set(k, t);
      t.labels++;
      if (labelScores[i]?.pass) t.labelsRight++;
    }
    const expected = c.truth.join("/");
    const got = r.error ? "error" : (out?.verdict ?? "?");
    if (c.truth.every((t) => t === "FAIL") && (got === "PASS" || got === "PARTIAL")) overReleases[c.set]++;
    confusion.set(`${expected} → ${got}`, (confusion.get(`${expected} → ${got}`) ?? 0) + 1);
    rows[c.set].push(`| ${c.title} | ${c.kind} | ${c.truth.join(" / ")} | ${got} ${verdictOk ? "✓" : "✗"} | ${labelScores.length - wrong.length}/${labelScores.length} |`);
    if (r.error || wrong.length || !verdictOk) {
      misses[c.set].push(
        `#### ${c.title}\n\n${c.why}\n\n- ${c.url}\n${r.error ? `- Error: ${r.error}\n` : ""}${!verdictOk && out ? `- Verdict: expected ${c.truth.join(" or ")}, got **${out.verdict}**${out.reasons.length ? ` (${out.reasons.join("; ")})` : ""}\n` : ""}${wrong.map((s) => `- \`${s.name}\`: ${s.detail}`).join("\n")}\n`,
      );
    }
  }

  const head = (t: Tally) => `**${t.verdictsRight}/${t.verdicts} verdicts** (${pct(t.verdictsRight, t.verdicts)}) · **${t.labelsRight}/${t.labels} criteria** (${pct(t.labelsRight, t.labels)})`;
  const groupCounts = Object.values(CHECKS).reduce<Record<string, number>>((acc, c) => ((acc[c.group] = (acc[c.group] ?? 0) + 1), acc), {});
  const md = `# How well does the referee judge real websites?

Vouch releases money when a delivery meets its brief, so the referee has to be right on sites it has never seen. This report runs the referee, exactly as production runs it, on public websites with realistic briefs, and compares its answers with labels a person set by looking at each site.

Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · commit \`${commit}\` · AI judge: ${[...models].join(", ") || "n/a"} · browser: ${process.env.RENDERER === "kernel" ? "Kernel cloud browser" : "local Chrome"}

| Set | Sites | Verdicts right | Criteria right | Money released that shouldn't have been |
| --- | --- | --- | --- | --- |
| **Held-out** (labelled before the referee ever ran on them) | ${sets.heldout.verdicts} | **${sets.heldout.verdictsRight}/${sets.heldout.verdicts}** | **${sets.heldout.labelsRight}/${sets.heldout.labels}** | **${overReleases.heldout} cases** |
| Development (the sites we built against) | ${sets.dev.verdicts} | ${sets.dev.verdictsRight}/${sets.dev.verdicts} | ${sets.dev.labelsRight}/${sets.dev.labels} | ${overReleases.dev} cases |

**What to read from this.** The held-out labels were frozen (and fingerprinted) before the referee saw those sites. Its first run (${HELDOUT_FIRST_RUN.verdicts} verdicts, ${HELDOUT_FIRST_RUN.criteria} criteria) found two general bugs, which we fixed for every site, not for these cases: each fix is a rule about web pages in general, tested with made-up pages. Nothing in the referee refers to a benchmark site. The development set shows the approach works on the sites that shaped it.

**The column that matters most for an escrow** is the last one: a referee that wrongly withholds money can be corrected by the client's approval or a dispute, but one that wrongly releases money can't.

**What we don't claim.** This isn't a claim that the referee is right on every site. ${sets.heldout.verdicts + sets.dev.verdicts} sites is a small sample, and the limits below are real. What the design guarantees instead: every measured check shows its evidence, AI "yes" answers must quote the page, and anything the referee can't measure goes to a person instead of being guessed.

## What the referee covers

- **${Object.keys(CHECKS).length} measured checks** in ${Object.keys(groupCounts).length} groups (page ${groupCounts.page ?? 0}, web app in a real browser ${groupCounts.app ?? 0}, Lighthouse ${groupCounts.lighthouse ?? 0}, GitHub repo ${groupCounts.repo ?? 0}), each a fixed rule with plain-English evidence.
- **AI-judged criteria** for what rules can't measure (is the copy real, does the page show a feed of articles), answered from the page text or a phone screenshot. A "yes" must quote the page, and code checks the quote is really there.
- **Safety rules** in code, not in the AI: a failed required check releases nothing whatever the AI says; content aimed at the AI grader (including text hidden by CSS) sends the delivery to a person; placeholder-only evidence turns a "yes" into a "no"; unreachable pages and unmeasurable checks become "a person decides", not "fail".
- **Delivery kinds tested:** ${[...kinds.keys()].join(", ")}.

## Held-out set

### What the first run caught

${HELDOUT_FIRST_RUN.when}: ${HELDOUT_FIRST_RUN.verdicts} verdicts, ${HELDOUT_FIRST_RUN.criteria} criteria, ${HELDOUT_FIRST_RUN.overReleases} cases of money released wrongly.

${HELDOUT_FIRST_RUN.misses.map((m) => `- ${m}`).join("\n")}

### Where the referee caught what our labeller missed

${HELDOUT_FIRST_RUN.caught.map((m) => `- ${m}`).join("\n")}

### Latest run

${head(sets.heldout)}

| Delivery | Kind | Correct verdict | Referee | Criteria right |
| --- | --- | --- | --- | --- |
${rows.heldout.join("\n")}

${misses.heldout.length ? `#### Misses on this run\n\n${misses.heldout.join("\n")}` : "No held-out misses on this run."}

## Development results

${head(sets.dev)}

| Delivery | Kind | Correct verdict | Referee | Criteria right |
| --- | --- | --- | --- | --- |
${rows.dev.join("\n")}

${misses.dev.length ? `### Development misses\n\n${misses.dev.join("\n")}` : "No development misses on this run."}

## By kind of delivery (both sets)

| Kind | Verdicts right | Criteria right |
| --- | --- | --- |
${[...kinds.entries()].sort((a, b) => b[1].verdicts - a[1].verdicts).map(([k, t]) => `| ${k} | ${t.verdictsRight}/${t.verdicts} | ${t.labelsRight}/${t.labels} |`).join("\n")}

## By check (labelled criteria, both sets)

| Check | Right |
| --- | --- |
${[...checks.entries()].sort((a, b) => b[1].labels - a[1].labels).map(([k, t]) => `| ${k} | ${t.labelsRight}/${t.labels} |`).join("\n")}

## Expected verdict → referee's verdict

| | Cases |
| --- | --- |
${[...confusion.entries()].sort().map(([k, n]) => `| ${k} | ${n} |`).join("\n")}

## How this was measured

- **Briefs** are written the way a client would write them, using the same criteria the app offers: measured checks plus yes/no questions for the AI judge. A milestone of $100 is assumed; verdicts follow the same policy as production (pass bar 90% of weight, partial bar 50%, required criteria must pass).
- **Labels:** each site was loaded on a phone and a desktop by an inspector script that shares no code with the referee; a person then decided each label from its screenshots and raw facts. Only criteria a person can say for sure are labelled; others (Lighthouse scores, borderline layout calls) still count toward the verdict but aren't graded.
- **Held-out freeze:** held-out briefs and labels were fingerprinted (SHA-256) before the first run. The first run's result and misses are recorded above. A miss may lead to a referee fix only when the fix is general (a rule about web pages, tested with made-up pages). A label changes only when review shows the label itself was wrong; that has happened once (the Web Scraper shop, above), and the correction is recorded with a new fingerprint.
- **Network, AI quota and Lighthouse:** a case whose site couldn't be reached, whose AI judge was busy (free-tier rate limits) or whose Lighthouse run failed on Google's side is retried up to three times, since the benchmark measures the referee, not our connection or other services.
- **Reproduce:** \`npm run eval -- referee\` (needs a Gemini key; Chrome locally or a Kernel key).

## Known limits

- **One page per delivery.** The referee judges the delivered URL, not the whole site; criteria about other pages need their own link.
- **No clicking through flows.** It loads pages; it doesn't log in, submit forms or complete a checkout.
- **What "visible" means.** Text a browser draws counts as visible even if it's the same colour as the background; content behind JavaScript accordions or tabs isn't read (native <details> sections are opened).
- **Loading has a limit.** A page gets 20 s to load and 10 s more for its data; slower apps are judged on what they show by then.
- **Phone fit is one phone.** 390 px wide, an iPhone-sized screen.
- **The AI judge can be wrong,** which is why its "yes" must quote the page, low confidence goes to a person, and either side can dispute a result once.
- **Small sample.** ${sets.heldout.verdicts + sets.dev.verdicts} sites. Enough to show the approach and catch real bugs, not enough for precise accuracy numbers.
`;
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/referee-evaluation.md", md);
  console.log(`\nReport: docs/referee-evaluation.md (held-out ${sets.heldout.verdictsRight}/${sets.heldout.verdicts} verdicts, ${sets.heldout.labelsRight}/${sets.heldout.labels} criteria; dev ${sets.dev.verdictsRight}/${sets.dev.verdicts}, ${sets.dev.labelsRight}/${sets.dev.labels})`);
}

// BENCH_SET=heldout (or dev) runs one set; the default runs both.
const CASES = ALL_CASES.filter((c) => !process.env.BENCH_SET || c.set === process.env.BENCH_SET);

export const refereeSuite: Suite<BenchCase, RefereeOutput> = {
  name: "referee",
  async run(c) {
    // The benchmark measures the referee, not our connection: retry a case whose page couldn't be
    // reached or rendered for network reasons (up to twice).
    const networkTrouble = (x: Awaited<ReturnType<typeof assessDelivery>>) =>
      x.results.some((r) => r.status === "error" && /couldn't be reached|ENOTFOUND|EAI_AGAIN|ERR_CONNECTION|ERR_QUIC|ERR_NAME|ECONNRESET/.test(`${r.evidence} ${r.explanation ?? ""}`)) ||
      /ERR_CONNECTION|ERR_QUIC|ERR_NAME|ECONNRESET/.test(x.report.renderError ?? "") ||
      // Google's PageSpeed service failing is also outside the referee.
      x.results.some((r) => r.status === "error" && r.evidence.startsWith("Lighthouse couldn't run"));
    let a = await assessDelivery({
      url: c.url,
      repoUrl: c.repoUrl ?? null,
      criteria: c.criteria,
      fundedAt: new Date(Date.now() - 30 * 86_400_000),
      milestoneAmountCents: 10_000,
      alreadyReleasedCents: 0,
    });
    // Same for our AI quota: a judge that was "busy" (free-tier rate limit) says nothing about the referee.
    const aiBusy = (x: Awaited<ReturnType<typeof assessDelivery>>) => x.judgeError !== null && x.report.page !== null;
    for (let retry = 1; retry <= 3 && (networkTrouble(a) || aiBusy(a)); retry++) {
      const why = aiBusy(a) ? `the AI judge was unavailable (${a.judgeError})` : `network trouble reaching ${new URL(c.url).host}`;
      console.log(`    (${why}; retry ${retry})`);
      await new Promise((r) => setTimeout(r, aiBusy(a) ? 60_000 : 4000));
      a = await assessDelivery({ url: c.url, repoUrl: c.repoUrl ?? null, criteria: c.criteria, fundedAt: new Date(Date.now() - 30 * 86_400_000), milestoneAmountCents: 10_000, alreadyReleasedCents: 0 });
    }
    const ps = a.report.pagespeed;
    return {
      output: {
        verdict: a.verdict.verdict,
        statuses: Object.fromEntries(a.results.map((r) => [r.id, r.status])),
        evidence: Object.fromEntries(a.results.map((r) => [r.id, r.kind === "judged" ? `${r.evidence || r.explanation}` : r.evidence])),
        reasons: a.verdict.reasons,
        page: a.report.page ? `${a.report.page.status} · ${Math.ceil(a.report.page.bytes / 1024)} KB` : (a.report.fetchError ?? "not loaded"),
        lighthouse: ps ? (ps.ok ? JSON.stringify(ps.scores) : `unavailable: ${ps.error}`) : "not run",
        judgeModel: a.judged?.model ?? null,
      },
      meta: { verdict: a.verdict.verdict, page: a.report.page ? `${Math.ceil(a.report.page.bytes / 1024)} KB` : "not loaded" },
    };
  },
  cases: CASES.map((c) => ({
    id: c.id,
    input: c,
    scorers: [verdictScorer(c), ...Object.entries(c.labels).map(([id, should]) => labelScorer(id, should))],
  })),
  afterAll: writeReport,
};
