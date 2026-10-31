import { after } from "next/server";
import { hasFeature } from "@/lib/env";
import { drainTasks } from "@/lib/jobs/runner";
import { parseWebhookEvent } from "@/lib/paypal/webhook-event";
import { handleWebhookEvent, verifyWebhookSignature } from "@/lib/paypal/webhooks";

/**
 * PayPal webhook receiver. Register https://<app>/api/paypal/webhook in the PayPal developer
 * dashboard and put its Webhook ID in PAYPAL_WEBHOOK_ID.
 * Status codes matter: PayPal redelivers on any non-2xx, so only failures worth retrying get a 5xx.
 */
export async function POST(request: Request) {
  if (!hasFeature("paypalWebhooks")) {
    return Response.json({ error: "webhooks are not configured (set PAYPAL_WEBHOOK_ID)" }, { status: 503 });
  }

  const raw = await request.text();
  const event = parseWebhookEvent(raw);
  if (!event) return Response.json({ error: "not a PayPal webhook event" }, { status: 400 });

  let genuine: boolean;
  try {
    genuine = await verifyWebhookSignature(request.headers, raw);
  } catch (err) {
    console.error("[webhook] signature check unavailable", event.id, err instanceof Error ? err.message : err);
    return Response.json({ error: "couldn't verify the signature right now" }, { status: 500 });
  }
  if (!genuine) {
    console.warn("[webhook] rejected: signature check failed", event.id, event.event_type);
    return Response.json({ error: "signature check failed" }, { status: 400 });
  }

  try {
    const result = await handleWebhookEvent(event);
    const jobId = result.jobId;
    if (jobId && result.outcome === "processed") {
      // Run any settlement the event queued, after PayPal has its answer.
      after(() => drainTasks({ jobId }).catch((e) => console.error("[webhook] drain", e)));
    }
    return Response.json(result);
  } catch (err) {
    console.error("[webhook] handling failed", event.id, event.event_type, err);
    return Response.json({ error: "handling failed" }, { status: 500 });
  }
}
