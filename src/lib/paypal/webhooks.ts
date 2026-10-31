import { and, eq, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireFeature } from "@/lib/env";
import { AgreementError, type Job } from "@/lib/jobs/agreement";
import { tickJob } from "@/lib/jobs/tick";
import { statusAfterRelease } from "@/lib/policy/policy";
import { PAYPAL_API_BASE, paypalAccessToken } from "./client";
import { completeFunding } from "./funding";
import { buildVerifyBody, webhookRefs, type WebhookEvent, type WebhookRefs } from "./webhook-event";

/**
 * PayPal webhooks are an extra signal on top of "tick on read" (internal/DECISIONS.md): every
 * event is verified, recorded once in the ledger, and then brings its job up to date through the
 * same idempotent code the pages and the cron use. The only state a webhook changes directly is
 * what PayPal alone knows: a pending capture completing or being denied, and a refund made in
 * PayPal's dashboard.
 */

/**
 * Ask PayPal whether a delivery is genuine. False for a forged or unsigned request; throws when
 * PayPal can't be asked (the route answers 500 so PayPal delivers the event again later).
 */
export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const e = requireFeature("paypalWebhooks");
  const body = buildVerifyBody(headers, e.PAYPAL_WEBHOOK_ID!, rawBody);
  if (!body) return false;
  const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await paypalAccessToken()}` },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PayPal signature check returned HTTP ${res.status}`);
  const result = (await res.json()) as { verification_status?: string };
  return result.verification_status === "SUCCESS";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findJob(refs: WebhookRefs): Promise<Job | undefined> {
  if (refs.customId && UUID.test(refs.customId)) {
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, refs.customId));
    if (job) return job;
  }
  if (refs.orderId) {
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.paypalOrderId, refs.orderId));
    if (job) return job;
  }
  const ids = [refs.captureId, refs.authorizationId].filter((id): id is string => Boolean(id));
  const conditions = [...ids.map((id) => eq(schema.payments.paypalId, id)), ...(refs.invoiceId ? [eq(schema.payments.requestId, refs.invoiceId)] : [])];
  if (!conditions.length) return undefined;
  const [row] = await db
    .select({ job: schema.jobs })
    .from(schema.payments)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.payments.jobId))
    .where(or(...conditions))
    .limit(1);
  return row?.job;
}

async function findCapture(jobId: string, refs: WebhookRefs) {
  const match = [
    ...(refs.captureId ? [eq(schema.payments.paypalId, refs.captureId)] : []),
    ...(refs.invoiceId ? [eq(schema.payments.requestId, refs.invoiceId)] : []),
  ];
  if (!match.length) return undefined;
  const [p] = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.jobId, jobId), eq(schema.payments.type, "capture"), or(...match)));
  return p;
}

/** A capture PayPal first reported as PENDING has completed. */
async function captureCompleted(job: Job, refs: WebhookRefs): Promise<string[]> {
  const p = await findCapture(job.id, refs);
  // "pending" means our own call is still in flight (or crashed); its confirm or the recovery tick records it.
  if (p?.status !== "pending_paypal") return [];
  await db.update(schema.payments).set({ status: "completed", paypalStatus: "COMPLETED" }).where(and(eq(schema.payments.id, p.id), eq(schema.payments.status, "pending_paypal")));
  return ["capture confirmed"];
}

/** A capture PayPal reported as PENDING was denied: the money never moved, so take it back off the released totals. */
async function captureDenied(job: Job, refs: WebhookRefs): Promise<string[]> {
  const p = await findCapture(job.id, refs);
  if (p?.status !== "pending_paypal") return [];
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.payments).where(eq(schema.payments.id, p.id)).for("update");
    if (locked.status !== "pending_paypal") return [];
    const [j] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).for("update");
    if (j.status === "COMPLETED") {
      // The rest of the hold is already voided, so this can't be re-captured automatically.
      console.error("[webhook] capture denied after the job completed", job.id, p.id);
      return ["capture denied after completion: needs a person"];
    }
    await tx.update(schema.payments).set({ status: "failed", paypalStatus: "DENIED" }).where(eq(schema.payments.id, p.id));
    await tx.update(schema.jobs).set({ capturedCents: sql`${schema.jobs.capturedCents} - ${p.amountCents}` }).where(eq(schema.jobs.id, job.id));
    if (p.milestoneId) {
      const [m] = await tx.select().from(schema.milestones).where(eq(schema.milestones.id, p.milestoneId)).for("update");
      const releasedCents = Math.max(0, m.releasedCents - p.amountCents);
      const settled = m.status === "RELEASED" || m.status === "PARTIAL_HELD" || m.status === "HELD";
      await tx
        .update(schema.milestones)
        .set({ releasedCents, ...(settled ? { status: statusAfterRelease(m.amountCents, releasedCents), settledAt: null } : {}) })
        .where(eq(schema.milestones.id, m.id));
    }
    await tx.insert(schema.events).values({
      jobId: job.id,
      milestoneId: p.milestoneId,
      type: "payment.capture_failed",
      source: "paypal",
      payload: { amountCents: p.amountCents, issue: "DENIED" },
    });
    return ["capture denied: released total reduced"];
  });
}

/** A refund made outside Vouch (e.g. in the PayPal dashboard): record it once. */
async function refunded(job: Job, refs: WebhookRefs): Promise<string[]> {
  if (!refs.resourceId || refs.amountCents === null) return [];
  const capture = await findCapture(job.id, refs);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.payments)
      .values({
        jobId: job.id,
        milestoneId: capture?.milestoneId ?? null,
        type: "refund",
        status: "completed",
        amountCents: refs.amountCents!,
        requestId: `paypal-refund-${refs.resourceId}`,
        paypalId: refs.resourceId,
        paypalStatus: refs.status,
      })
      .onConflictDoNothing()
      .returning({ id: schema.payments.id });
    if (!row) return [];
    await tx.update(schema.jobs).set({ refundedCents: sql`${schema.jobs.refundedCents} + ${refs.amountCents!}` }).where(eq(schema.jobs.id, job.id));
    return ["refund recorded"];
  });
}

export interface WebhookResult {
  outcome: "duplicate" | "processed" | "unmatched";
  jobId: string | null;
  actions: string[];
}

/**
 * Handle a verified event. Safe to receive twice: a delivery already in the ledger is skipped,
 * and everything it triggers is idempotent anyway. Unexpected errors propagate so the route
 * answers 500 and PayPal delivers the event again.
 */
export async function handleWebhookEvent(event: WebhookEvent): Promise<WebhookResult> {
  const [seen] = await db.select({ id: schema.events.id, jobId: schema.events.jobId }).from(schema.events).where(eq(schema.events.paypalEventId, event.id));
  if (seen) return { outcome: "duplicate", jobId: seen.jobId, actions: [] };

  const refs = webhookRefs(event);
  const job = await findJob(refs);
  const actions: string[] = [];
  let error: string | undefined;

  if (job) {
    try {
      switch (event.event_type) {
        case "CHECKOUT.ORDER.APPROVED":
          // The client approved in PayPal; finish funding even if their tab closed before our page heard.
          if (job.status === "AGREED" && refs.orderId && job.paypalOrderId === refs.orderId) {
            actions.push(`funding ${await completeFunding(job.id, refs.orderId, "webhook")}`);
          }
          break;
        case "PAYMENT.CAPTURE.COMPLETED":
          actions.push(...(await captureCompleted(job, refs)));
          break;
        case "PAYMENT.CAPTURE.DENIED":
          actions.push(...(await captureDenied(job, refs)));
          break;
        case "PAYMENT.CAPTURE.REFUNDED":
          actions.push(...(await refunded(job, refs)));
          break;
      }
      actions.push(...(await tickJob(job.id)));
    } catch (err) {
      // A business refusal (say, an amount mismatch) won't change on redelivery: record it and move on.
      if (!(err instanceof AgreementError)) throw err;
      error = err.message;
    }
  }

  const capture = job && refs.captureId ? await findCapture(job.id, refs) : undefined;
  await db
    .insert(schema.events)
    .values({
      jobId: job?.id ?? null,
      milestoneId: capture?.milestoneId ?? null,
      type: "paypal.webhook",
      source: "paypal",
      payload: { eventType: event.event_type, resourceId: refs.resourceId, status: refs.status, amountCents: refs.amountCents, actions, ...(error ? { error } : {}) },
      paypalEventId: event.id,
    })
    .onConflictDoNothing();

  return { outcome: job ? "processed" : "unmatched", jobId: job?.id ?? null, actions };
}
