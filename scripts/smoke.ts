/**
 * Day 1 PayPal sandbox smoke test. Proves the money moves Vouch depends on.
 *
 *   npm run smoke              # funds go to your sandbox Business (platform) account
 *   npm run smoke -- --payee   # funds go straight to PAYPAL_FREELANCER_EMAIL instead
 *
 * No terminal input needed: the script waits until the order is approved in the browser.
 *
 * Steps: authorize $10 -> capture $6 (not final) -> retry that capture with the same
 * request id (must return the same capture) -> try a reauthorize (information only)
 * -> capture $3 (not final) -> void the remaining $1 -> refund $1 of the first capture.
 */
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { paypal, paypalErrorInfo, usd } from "../src/lib/paypal/client";

const usePayee = process.argv.includes("--payee");
const runId = Date.now().toString(36);
const results: { step: string; ok: boolean; detail: string }[] = [];

async function step<T>(name: string, fn: () => Promise<T>, opts: { required?: boolean } = {}) {
  const required = opts.required ?? true;
  try {
    const value = await fn();
    results.push({ step: name, ok: true, detail: "" });
    console.log(`  ✔ ${name}`);
    return value;
  } catch (err) {
    const e = paypalErrorInfo(err);
    const detail = [e.status && `HTTP ${e.status}`, e.issue ?? e.name, e.message, e.debugId && `debug_id ${e.debugId}`]
      .filter(Boolean)
      .join(" | ");
    results.push({ step: name, ok: false, detail });
    console.log(`  ✘ ${name}\n    ${detail}`);
    if (required) {
      printSummary();
      process.exit(1);
    }
    return undefined;
  }
}

function printSummary() {
  console.log("\nSummary");
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.step}`);
  const failedCapture = results.find((r) => !r.ok && r.step.startsWith("Capture $3"));
  if (failedCapture) {
    console.log("\nSecond capture was rejected: switch to Fallback A in the plan (one order per milestone).");
  }
}

async function main() {
  const { orders, payments } = paypal();
  const payeeEmail = process.env.PAYPAL_FREELANCER_EMAIL;
  if (usePayee && !payeeEmail) throw new Error("--payee needs PAYPAL_FREELANCER_EMAIL");
  console.log(`Smoke run ${runId} (${usePayee ? `payee = ${payeeEmail}` : "platform is payee"})\n`);

  const order = await step("Create order, intent AUTHORIZE, $10", async () => {
    const res = await orders.createOrder({
      paypalRequestId: `smoke-${runId}-create`,
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [
          {
            referenceId: "job-smoke",
            customId: `smoke-${runId}`,
            amount: usd(1000),
            ...(usePayee ? { payee: { emailAddress: payeeEmail } } : {}),
          },
        ],
        paymentSource: {
          paypal: {
            experienceContext: {
              brandName: "Vouch (sandbox)",
              returnUrl: "https://example.com/approved",
              cancelUrl: "https://example.com/cancelled",
            },
          },
        },
      },
    });
    return res.result;
  });

  const approveUrl = order?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  console.log(`\n  APPROVE: open this link, log in as a sandbox Personal buyer and approve:\n  ${approveUrl}\n`);
  console.log("  Waiting for approval (the page you land on afterwards won't load; that's fine)...");

  await step("Buyer approves in the browser", async () => {
    const deadline = Date.now() + 15 * 60_000;
    for (;;) {
      const { result } = await orders.getOrder({ id: order!.id! });
      if (result.status === "APPROVED") return;
      if (Date.now() > deadline) throw new Error(`Not approved within 15 minutes (status ${result.status})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  });

  const authorized = await step("Authorize order", async () => {
    const res = await orders.authorizeOrder({
      id: order!.id!,
      paypalRequestId: `smoke-${runId}-authorize`,
      prefer: "return=representation",
    });
    return res.result;
  });
  const authorizationId = authorized?.purchaseUnits?.[0]?.payments?.authorizations?.[0]?.id;
  if (!authorizationId) throw new Error("No authorization id in response");
  console.log(`    authorization ${authorizationId}`);

  const capture = (requestId: string, cents: number, finalCapture: boolean) =>
    payments
      .captureAuthorizedPayment({
        authorizationId,
        paypalRequestId: requestId,
        prefer: "return=representation",
        body: { amount: usd(cents), finalCapture, invoiceId: `${requestId}` },
      })
      .then((r) => r.result);

  const first = await step("Capture $6 (final_capture=false)", () =>
    capture(`smoke-${runId}-m1-a1`, 600, false),
  );
  console.log(`    capture ${first?.id} status ${first?.status}`);

  await step("Retry same capture with same PayPal-Request-Id returns the same capture", async () => {
    const again = await capture(`smoke-${runId}-m1-a1`, 600, false);
    if (again.id !== first?.id) throw new Error(`Got a new capture ${again.id}: double charge risk`);
  });

  await step(
    "Reauthorize (expected to fail inside the 3-day honor period; information only)",
    () => payments.reauthorizePayment({ authorizationId, body: { amount: usd(400) } }),
    { required: false },
  );

  const second = await step("Capture $3 (final_capture=false), second capture on one authorization", () =>
    capture(`smoke-${runId}-m2-a1`, 300, false),
  );
  console.log(`    capture ${second?.id} status ${second?.status}`);

  await step("Void the remaining $1 after partial captures", () =>
    payments.voidPayment({ authorizationId, paypalRequestId: `smoke-${runId}-void` }),
  );

  await step("Refund $1 of the first capture", () =>
    payments.refundCapturedPayment({
      captureId: first!.id!,
      paypalRequestId: `smoke-${runId}-refund`,
      body: { amount: usd(100), noteToPayer: "Vouch smoke test refund" },
    }),
  );

  const final = await payments.getAuthorizedPayment({ authorizationId });
  console.log(`    final authorization status: ${final.result.status}`);
  printSummary();
}

main().catch((err) => {
  const e = paypalErrorInfo(err);
  console.error(e.status ? `HTTP ${e.status} ${e.issue ?? e.name ?? ""} ${e.message}` : e.message);
  process.exit(1);
});
