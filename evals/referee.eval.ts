import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { assessDelivery } from "../src/lib/referee/evaluate";
import type { Verdict } from "../src/lib/policy/policy";
import { CASES, type BenchCase } from "./benchmark/cases";
import type { CaseResult, Scorer, Suite } from "./harness";

/** Compact result: enough to grade and to explain. */
export interface RefereeOutput {
  verdict: Verdict;
  statuses: Record<string, "pass" | "fail" | "error">;
  evidence: Record<string, string>;
  reasons: string[];
  page: string;
  lighthouse: string;
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

function writeScorecard(results: CaseResult[]) {
  const commit = (() => {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return "unknown";
    }
  })();
  const byId = new Map(CASES.map((c) => [c.id, c]));
  let verdictsRight = 0;
  let labelsRight = 0;
  let labelsTotal = 0;
  const rows: string[] = [];
  const misses: string[] = [];
  for (const r of results) {
    const c = byId.get(r.id)!;
    const out = r.output as RefereeOutput | undefined;
    const verdictOk = r.scores[0]?.pass ?? false;
    if (verdictOk) verdictsRight++;
    const labelScores = r.scores.slice(1);
    labelsTotal += labelScores.length;
    labelsRight += labelScores.filter((s) => s.pass).length;
    const wrong = labelScores.filter((s) => !s.pass);
    rows.push(
      `| ${c.title} | ${c.kind} | ${c.truth.join(" / ")} | ${r.error ? "error" : out?.verdict ?? "?"} | ${verdictOk ? "✓" : "✗"} | ${labelScores.length - wrong.length}/${labelScores.length} |`,
    );
    if (r.error || wrong.length || !verdictOk) {
      misses.push(`### ${c.title}\n\n${c.why}\n\n- URL: ${c.url}\n${r.error ? `- Error: ${r.error}\n` : ""}${!verdictOk && out ? `- Verdict: expected ${c.truth.join(" or ")}, got **${out.verdict}**\n` : ""}${wrong.map((s) => `- \`${s.name}\`: ${s.detail}`).join("\n")}\n`);
    }
  }
  const md = `# Referee benchmark: real-world web deliveries

Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · commit \`${commit}\` · ${results.length} cases

**Verdicts right: ${verdictsRight}/${results.length}** · **Criteria right: ${labelsRight}/${labelsTotal}** (only criteria a person verified by rendering the page in a real browser)

| Delivery | Kind | Correct verdict | Referee | Verdict | Criteria |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## Misses

${misses.join("\n") || "None."}
`;
  mkdirSync("internal/benchmark", { recursive: true });
  writeFileSync("internal/benchmark/scorecard.md", md);
  console.log(`\nScorecard: internal/benchmark/scorecard.md (verdicts ${verdictsRight}/${results.length}, criteria ${labelsRight}/${labelsTotal})`);
}

export const refereeSuite: Suite<BenchCase, RefereeOutput> = {
  name: "referee",
  async run(c) {
    // The benchmark measures the referee, not our connection: retry a case whose page couldn't be
    // reached or rendered for network reasons (up to twice).
    const networkTrouble = (x: Awaited<ReturnType<typeof assessDelivery>>) =>
      x.results.some((r) => r.status === "error" && /couldn't be reached|ENOTFOUND|EAI_AGAIN|ERR_CONNECTION|ERR_QUIC|ERR_NAME|ECONNRESET/.test(`${r.evidence} ${r.explanation ?? ""}`)) ||
      /ERR_CONNECTION|ERR_QUIC|ERR_NAME|ECONNRESET/.test(x.report.renderError ?? "");
    let a = await assessDelivery({
      url: c.url,
      repoUrl: c.repoUrl ?? null,
      criteria: c.criteria,
      fundedAt: new Date(Date.now() - 30 * 86_400_000),
      milestoneAmountCents: 10_000,
      alreadyReleasedCents: 0,
    });
    for (let retry = 1; retry <= 2 && networkTrouble(a); retry++) {
      console.log(`    (network trouble reaching ${new URL(c.url).host}; retry ${retry})`);
      await new Promise((r) => setTimeout(r, 4000));
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
      },
      meta: { verdict: a.verdict.verdict, page: a.report.page ? `${Math.ceil(a.report.page.bytes / 1024)} KB` : "not loaded" },
    };
  },
  cases: CASES.map((c) => ({
    id: c.id,
    input: c,
    scorers: [verdictScorer(c), ...Object.entries(c.labels).map(([id, should]) => labelScorer(id, should))],
  })),
  afterAll: writeScorecard,
};
