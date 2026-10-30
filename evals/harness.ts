/**
 * Minimal eval harness for Vouch's AI. A suite runs real model calls on fixed cases and scores
 * each output with plain functions, so a prompt or model change that makes things worse shows up
 * as a failing score instead of a surprise in the demo.
 */
import { mkdirSync, writeFileSync } from "node:fs";

export interface Score {
  name: string;
  pass: boolean;
  detail?: string;
}

export type Scorer<O> = (output: O) => Score;

export interface EvalCase<I, O> {
  id: string;
  input: I;
  scorers: Scorer<O>[];
}

export interface Suite<I, O> {
  name: string;
  run: (input: I, opts: { fresh: boolean }) => Promise<{ output: O; meta?: Record<string, unknown> }>;
  cases: EvalCase<I, O>[];
}

interface CaseResult {
  id: string;
  ms: number;
  scores: Score[];
  error?: string;
  meta?: Record<string, unknown>;
  output?: unknown;
}

export async function runSuite<I, O>(suite: Suite<I, O>, opts: { fresh: boolean; only?: string }): Promise<boolean> {
  console.log(`\nSuite: ${suite.name}${opts.fresh ? " (fresh, cache bypassed)" : ""}\n`);
  const results: CaseResult[] = [];

  for (const c of suite.cases.filter((c) => !opts.only || c.id === opts.only)) {
    const started = Date.now();
    try {
      const { output, meta } = await suite.run(c.input, opts);
      const scores = c.scorers.map((s) => {
        try {
          return s(output);
        } catch (err) {
          return { name: "scorer crashed", pass: false, detail: String(err) };
        }
      });
      results.push({ id: c.id, ms: Date.now() - started, scores, meta, output });
    } catch (err) {
      results.push({ id: c.id, ms: Date.now() - started, scores: [], error: err instanceof Error ? err.message : String(err) });
    }
    const r = results.at(-1)!;
    const passed = r.scores.filter((s) => s.pass).length;
    const ok = !r.error && passed === r.scores.length;
    console.log(`${ok ? "✔" : "✘"} ${c.id}  ${r.error ? "ERROR" : `${passed}/${r.scores.length}`}  ${(r.ms / 1000).toFixed(1)}s${r.meta ? `  ${JSON.stringify(r.meta)}` : ""}`);
    if (r.error) console.log(`    ${r.error}`);
    for (const s of r.scores.filter((s) => !s.pass)) console.log(`    ✘ ${s.name}${s.detail ? `: ${s.detail}` : ""}`);
  }

  const total = results.reduce((n, r) => n + r.scores.length, 0);
  const passed = results.reduce((n, r) => n + r.scores.filter((s) => s.pass).length, 0);
  const errors = results.filter((r) => r.error).length;
  console.log(`\n${passed}/${total} checks passed${errors ? `, ${errors} case(s) errored` : ""}`);

  mkdirSync("evals/results", { recursive: true });
  const file = `evals/results/${suite.name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ suite: suite.name, fresh: opts.fresh, results }, null, 2));
  console.log(`Details: ${file}`);

  return errors === 0 && passed === total;
}
