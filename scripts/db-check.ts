/**
 * Database check: connects through the app's pooled client, writes a throwaway job inside a
 * transaction, confirms the idempotency constraints hold, then rolls everything back.
 *
 *   npm run db:check
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "../src/db";

class Rollback extends Error {}

async function expectUniqueViolation(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
    if (code === "23505") {
      console.log(`  ✔ ${label}`);
      return;
    }
    throw err;
  }
  throw new Error(`${label}: duplicate was accepted`);
}

async function main() {
  const [{ now }] = await db.execute<{ now: string }>("select now()::text as now");
  console.log(`Connected (server time ${now})`);

  await db
    .transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({ name: "db-check", isDemo: true }).returning();
      const [job] = await tx
        .insert(schema.jobs)
        .values({
          ownerId: user.id,
          title: "db-check job",
          totalCents: 40000,
          clientTokenHash: randomBytes(32).toString("hex"),
        })
        .returning();
      console.log("  ✔ insert user and job");

      await tx.insert(schema.events).values({ jobId: job.id, type: "webhook", source: "paypal", paypalEventId: "WH-TEST-1" });
      await expectUniqueViolation("a redelivered PayPal webhook is rejected", () =>
        tx.transaction((sp) =>
          sp.insert(schema.events).values({ jobId: job.id, type: "webhook", source: "paypal", paypalEventId: "WH-TEST-1" }),
        ),
      );

      await tx.insert(schema.payments).values({ jobId: job.id, type: "capture", amountCents: 15000, requestId: "vouch-cap-test-0" });
      await expectUniqueViolation("a second payment with the same PayPal-Request-Id is rejected", () =>
        tx.transaction((sp) =>
          sp.insert(schema.payments).values({ jobId: job.id, type: "capture", amountCents: 15000, requestId: "vouch-cap-test-0" }),
        ),
      );

      const [read] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
      if (read.status !== "DRAFT" || read.reviewWindowSeconds !== 86400) throw new Error("Defaults not applied");
      console.log("  ✔ column defaults applied");

      throw new Rollback();
    })
    .catch((err) => {
      if (!(err instanceof Rollback)) throw err;
    });

  console.log("All checks passed; test rows rolled back.");
}

main()
  .catch((err) => {
    console.error("DB check failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
