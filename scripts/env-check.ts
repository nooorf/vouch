/**
 * Validate .env.local (or the real environment) and show which features are on.
 *   npm run env:check
 */
import { EnvError, env, featureReport } from "../src/lib/env";

try {
  const e = env();
  console.log(`Core config OK (PayPal ${e.PAYPAL_ENV}, AI provider ${e.LLM_PROVIDER}, app ${e.APP_URL})\n`);
  console.log(featureReport().map((l) => `  ${l}`).join("\n"));
} catch (err) {
  console.error(err instanceof EnvError ? err.message : err);
  process.exitCode = 1;
}
