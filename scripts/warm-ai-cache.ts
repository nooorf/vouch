/**
 * Pre-computes the AI draft for the demo's example job, so "Use the coffee roastery example"
 * answers instantly from the cache even when the free Gemini tier is busy.
 * Run once per database (locally and after deploying):  npm run demo:warm
 */
import { closeDb } from "../src/db";
import { EXAMPLE_JOB } from "../src/lib/brief/example";
import { draftBrief } from "../src/lib/brief/generate";

const started = Date.now();
draftBrief({
  description: EXAMPLE_JOB.description,
  totalCents: Math.round(Number(EXAMPLE_JOB.priceUsd) * 100),
  deadlineDays: Number(EXAMPLE_JOB.deadlineDays),
  clientName: EXAMPLE_JOB.clientName,
})
  .then(({ model, cached, brief }) =>
    console.log(`${cached ? "Already cached" : "Cached"}: ${brief.milestones.length} milestones from ${model} (${((Date.now() - started) / 1000).toFixed(1)}s)`),
  )
  .catch((err) => {
    console.error("Warm-up failed:", err.message, err.detail ?? "");
    process.exitCode = 1;
  })
  .finally(closeDb);
