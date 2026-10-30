/**
 * Remove demo workspaces (and the test data E2E runs leave behind). Open PayPal holds on those
 * jobs are voided first, so the shared sandbox buyer's balance isn't tied up.
 *
 *   npm run demo:cleanup                    # all demo users
 *   npm run demo:cleanup -- --older-than 24 # only demo users created more than 24 hours ago
 */
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";
import { hasFeature } from "../src/lib/env";
import { paypal, paypalErrorInfo } from "../src/lib/paypal/client";

const args = process.argv.slice(2);
const hoursArg = args.includes("--older-than") ? Number(args[args.indexOf("--older-than") + 1]) : 0;

async function main() {
  const cutoff = new Date(Date.now() - hoursArg * 3600_000);
  const users = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.isDemo, true), hoursArg ? lt(schema.users.createdAt, cutoff) : undefined));
  const userIds = users.map((u) => u.id);
  if (!userIds.length) {
    console.log("No demo users to remove.");
    return;
  }

  const held = await db
    .select({ id: schema.jobs.id, auth: schema.jobs.paypalAuthorizationId })
    .from(schema.jobs)
    .where(and(inArray(schema.jobs.ownerId, userIds), isNotNull(schema.jobs.paypalAuthorizationId)));

  let voided = 0;
  if (held.length && hasFeature("paypal")) {
    for (const job of held) {
      try {
        await paypal().payments.voidPayment({ authorizationId: job.auth!, paypalRequestId: `vouch-cleanup-void-${job.auth}` });
        voided++;
      } catch (err) {
        const e = paypalErrorInfo(err);
        // Already captured in full, voided or expired: nothing left to release.
        if (!["AUTHORIZATION_ALREADY_CAPTURED", "AUTHORIZATION_VOIDED", "AUTHORIZATION_EXPIRED", "PREVIOUSLY_VOIDED"].includes(e.issue ?? "")) {
          console.warn(`  could not void ${job.auth}: ${e.issue ?? e.message}`);
        }
      }
    }
  }

  const jobs = await db.delete(schema.jobs).where(inArray(schema.jobs.ownerId, userIds)).returning({ id: schema.jobs.id });
  await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  console.log(`Removed ${userIds.length} demo users and ${jobs.length} jobs; voided ${voided} PayPal hold(s).`);
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
