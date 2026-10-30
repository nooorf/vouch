/**
 * Run the referee's measured checks on any URL, with the demo brief's criteria.
 *   npm run referee -- https://example.com
 *   npm run referee -- https://example.com --repo https://github.com/owner/repo --milestone m2
 * For the local demo sites set REFEREE_ALLOW_LOCALHOST=true (development only).
 */
import { demoBrief } from "../src/lib/brief/demo";
import type { Criterion } from "../src/lib/brief/schema";
import { runReferee } from "../src/lib/referee/run";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--repo" && args[args.indexOf(a) - 1] !== "--milestone");
const repoUrl = args.includes("--repo") ? args[args.indexOf("--repo") + 1] : null;
const only = args.includes("--milestone") ? args[args.indexOf("--milestone") + 1] : null;
if (!url) {
  console.error("Usage: npm run referee -- <url> [--repo <github url>] [--milestone m1|m2|m3]");
  process.exit(1);
}

// All checks across the chosen milestones, one per check id.
const criteria = new Map<string, Criterion>();
for (const m of demoBrief.milestones.filter((m) => !only || m.id === only)) {
  for (const c of m.criteria) if (c.kind === "check" && !criteria.has(c.checkId)) criteria.set(c.checkId, c);
}

const icon = { pass: "✔", fail: "✘", error: "!" } as const;

runReferee({ url, repoUrl, criteria: [...criteria.values()], fundedAt: new Date(Date.now() - 7 * 86_400_000) })
  .then((r) => {
    console.log(`\n${url}`);
    console.log(r.page ? `  ${r.page.status} · ${r.page.ms} ms · ${Math.ceil(r.page.bytes / 1024)} KB · “${r.page.title}”` : `  could not load: ${r.fetchError}`);
    console.log("");
    for (const c of r.checks) console.log(`  ${icon[c.status]} ${c.label.padEnd(30)} ${c.evidence}`);
    if (r.pagespeed) console.log(`\n  Lighthouse: ${r.pagespeed.ok ? JSON.stringify(r.pagespeed.scores) : `unavailable (${r.pagespeed.error})`}${r.screenshot ? " · screenshot captured" : ""}`);
    console.log(`\n  Suspicious content: ${r.suspicious.flagged ? "FLAGGED" : "none"}`);
    for (const f of r.suspicious.findings) console.log(`    - ${f.where}: ${f.excerpt}`);
    console.log(`\n  Done in ${(r.ms / 1000).toFixed(1)} s`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
