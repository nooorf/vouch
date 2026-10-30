/**
 * Pre-computes the AI draft for the demo's example job, so "Use the coffee roastery example"
 * answers instantly from the cache even when the free Gemini tier is busy.
 *
 * The draft must pass the same scorers as the brief eval's coffee case. If the model (often the
 * backup model on the free tier) produces a weaker draft, ask again, up to 5 times, and keep the
 * first one that meets the bar. Run once per database (locally and after deploying):
 *   npm run demo:warm
 */
import { closeDb } from "../src/db";
import { EXAMPLE_JOB } from "../src/lib/brief/example";
import { draftBrief } from "../src/lib/brief/generate";
import { briefSuite } from "../evals/brief.eval";

const input = {
  description: EXAMPLE_JOB.description,
  totalCents: Math.round(Number(EXAMPLE_JOB.priceUsd) * 100),
  deadlineDays: Number(EXAMPLE_JOB.deadlineDays),
  clientName: EXAMPLE_JOB.clientName,
};
const scorers = briefSuite.cases.find((c) => c.id === "coffee-example")!.scorers;

async function main() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const started = Date.now();
    // First look at what's cached; after that, ask the model again and replace it.
    const { brief, model, cached } = await draftBrief(input, { cache: attempt === 1 ? true : "refresh" });
    const failed = scorers.map((s) => s(brief)).filter((s) => !s.pass);
    const took = ((Date.now() - started) / 1000).toFixed(1);
    if (!failed.length) {
      console.log(`${cached ? "Cached draft already meets the bar" : `Cached a draft that meets the bar (attempt ${attempt})`}: ${brief.milestones.length} milestones from ${model} (${took}s)`);
      return;
    }
    console.log(`Attempt ${attempt}: draft from ${model} misses ${failed.map((f) => f.name).join(", ")}; asking again`);
  }
  console.error("No draft met the bar in 5 attempts. Try again later (the free tier's main model may be out of quota).");
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Warm-up failed:", err.message, err.detail ?? "");
    process.exitCode = 1;
  })
  .finally(closeDb);
