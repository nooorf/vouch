/**
 * Run AI evals against the real model.
 *   npm run eval                 # all suites, cached answers reused
 *   npm run eval -- brief        # one suite
 *   npm run eval -- --fresh      # bypass the cache (use after changing a prompt or model)
 *   npm run eval -- --case tiny-fix
 */
import { closeDb } from "../src/db";
import { briefSuite } from "./brief.eval";
import { runSuite, type Suite } from "./harness";
import { reviseSuite } from "./revise.eval";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const suites: Record<string, Suite<any, any>> = { brief: briefSuite, revise: reviseSuite };

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : undefined;
const names = args.filter((a) => !a.startsWith("--") && a !== only);
const selected = names.length ? names : Object.keys(suites);

(async () => {
  let ok = true;
  for (const name of selected) {
    const suite = suites[name];
    if (!suite) throw new Error(`Unknown suite "${name}". Available: ${Object.keys(suites).join(", ")}`);
    ok = (await runSuite(suite, { fresh, only })) && ok;
  }
  process.exitCode = ok ? 0 : 1;
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
