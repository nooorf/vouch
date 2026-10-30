/**
 * Rebuild docs/referee-evaluation.md from a saved benchmark run, without running it again
 * (e.g. after editing the report's wording).
 *   npm run eval:report                        # latest referee run
 *   npm run eval:report -- evals/results/referee-….json
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CaseResult } from "./harness";
import { refereeSuite, writeReport, type RefereeOutput } from "./referee.eval";

const dir = path.join(__dirname, "results");
const file = process.argv[2] ?? path.join(dir, readdirSync(dir).filter((f) => f.startsWith("referee-")).sort().at(-1)!);
const { results } = JSON.parse(readFileSync(file, "utf8")) as { results: CaseResult[] };
console.log(`From ${path.relative(process.cwd(), file)}`);
// Score the saved answers against the current labels (labels can be corrected after review;
// the referee's answers are what was saved).
const cases = new Map(refereeSuite.cases.map((c) => [c.id, c]));
writeReport(
  results.map((r) => {
    const c = cases.get(r.id);
    return c && r.output ? { ...r, scores: c.scorers.map((s) => s(r.output as RefereeOutput)) } : r;
  }),
);
