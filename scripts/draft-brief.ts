/**
 * Try the AI brief drafter from the terminal.
 *   npm run brief:try -- "Build a landing page for ..." 400 14
 */
import { closeDb } from "../src/db";
import { draftBrief } from "../src/lib/brief/generate";
import { lintBrief } from "../src/lib/brief/lint";

const [description, price = "400", days = "14"] = process.argv.slice(2);
if (!description) {
  console.error('Usage: npm run brief:try -- "<job description>" [priceUsd] [days]');
  process.exit(1);
}

const started = Date.now();
draftBrief({ description, totalCents: Math.round(Number(price) * 100), deadlineDays: Number(days) })
  .then(({ brief, model, cached }) => {
    console.log(`${model}${cached ? " (cached)" : ""} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    console.log(JSON.stringify(brief, null, 2));
    const lints = lintBrief(brief);
    if (lints.length) console.log("\nLint:\n" + lints.map((l) => `  [${l.level}] ${l.criterionId ?? l.milestoneId}: ${l.message}`).join("\n"));
  })
  .catch((err) => {
    console.error(err.message, err.detail ?? "");
    process.exitCode = 1;
  })
  .finally(closeDb);
