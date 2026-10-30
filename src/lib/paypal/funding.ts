import {
  AuthorizationStatus,
  CheckoutPaymentIntent,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
  type Order,
} from "@paypal/paypal-server-sdk";
import { eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { AgreementError, type Job } from "@/lib/jobs/agreement";
import { assertTransition } from "@/lib/jobs/status";
import { formatCents } from "@/lib/money";
import { paypal, paypalErrorInfo, usd } from "./client";

const DAY = 86_400_000;
/** Captures are only guaranteed for the first 3 days of an authorization. */
export const HONOR_PERIOD_DAYS = 3;
/** An authorization can be captured for 29 days. */
export const AUTH_VALID_DAYS = 29;

export type FundingResult = "funded" | "pending" | "already";

/** PayPal order for the agreed total. The amount comes from the database, never from the browser. */
export async function createFundingOrder(job: Job): Promise<string> {
  if (job.status !== "AGREED") throw new AgreementError(job.status === "FUNDED" ? "This job is already funded." : "This job isn't ready to be funded.");
  if (job.fundingExpiresAt && job.fundingExpiresAt < new Date()) throw new AgreementError("This agreement expired before it was funded.");

  let order: Order;
  try {
    ({ result: order } = await paypal().orders.createOrder({
      // A new order per checkout attempt; an abandoned order costs nothing.
      paypalRequestId: `vouch-order-${job.id}-${Date.now()}`,
      prefer: "return=minimal",
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [
          {
            referenceId: job.id,
            customId: job.id,
            description: `Vouch: ${job.title}`.slice(0, 127),
            softDescriptor: "VOUCH",
            amount: usd(job.totalCents),
          },
        ],
        paymentSource: {
          paypal: {
            experienceContext: {
              brandName: "Vouch",
              shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
              userAction: PaypalExperienceUserAction.PayNow,
            },
          },
        },
      },
    }));
  } catch (err) {
    const e = paypalErrorInfo(err);
    console.error("[funding] create order failed", e);
    throw new AgreementError("PayPal couldn't start the checkout. Please try again.");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.jobs).set({ paypalOrderId: order.id! }).where(eq(schema.jobs.id, job.id));
    await tx.insert(schema.events).values({
      jobId: job.id,
      type: "payment.order_created",
      source: "client",
      payload: { orderId: order.id, amountCents: job.totalCents },
    });
  });
  return order.id!;
}

/** Authorize an approved order (or read the authorization if it already exists). */
async function authorize(orderId: string): Promise<Order> {
  const { orders } = paypal();
  try {
    const { result } = await orders.authorizeOrder({
      id: orderId,
      paypalRequestId: `vouch-auth-${orderId}`,
      prefer: "return=representation",
    });
    return result;
  } catch (err) {
    const e = paypalErrorInfo(err);
    // Authorized earlier (e.g. by a retry): read the order instead.
    if (e.issue === "ORDER_ALREADY_AUTHORIZED" || e.issue === "ORDER_ALREADY_CAPTURED") {
      return (await orders.getOrder({ id: orderId })).result;
    }
    if (e.issue === "ORDER_NOT_APPROVED" || e.issue === "PAYER_ACTION_REQUIRED") {
      throw new AgreementError("The payment wasn't approved in PayPal yet.");
    }
    if (e.issue === "INSTRUMENT_DECLINED") {
      throw new AgreementError("PayPal declined that payment method. Try again with a different one.");
    }
    console.error("[funding] authorize failed", e);
    throw new AgreementError("PayPal couldn't hold the payment. Nothing was charged. Please try again.");
  }
}

async function createMilestones(tx: Tx, job: Job, fundedAt: Date) {
  const [version] = await tx.select().from(schema.briefVersions).where(eq(schema.briefVersions.id, job.agreedVersionId!));
  if (!version) throw new Error(`Agreed version missing for job ${job.id}`);
  await tx
    .insert(schema.milestones)
    .values(
      version.content.milestones.map((m, i) => ({
        jobId: job.id,
        position: i + 1,
        briefKey: m.id,
        title: m.title,
        description: m.description,
        amountCents: m.amountCents,
        criteria: m.criteria,
        dueAt: new Date(fundedAt.getTime() + m.dueInDays * DAY),
      })),
    )
    .onConflictDoNothing();
}

/**
 * After the client approves in PayPal: authorize the order, check it holds exactly the agreed
 * total, and mark the job FUNDED. Safe to call more than once (button, page reload, cron).
 */
export async function completeFunding(jobId: string, orderId: string, source: "client" | "system"): Promise<FundingResult> {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) throw new AgreementError("Job not found.");
  if (job.paypalOrderId !== orderId) throw new AgreementError("That payment doesn't belong to this job.");
  if (job.status === "FUNDED" || job.status === "IN_PROGRESS" || job.status === "COMPLETED") return "already";

  const order = await authorize(orderId);
  const unit = order.purchaseUnits?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  if (unit?.customId !== job.id || !auth?.id) throw new AgreementError("PayPal returned a payment we can't match to this job.");

  const heldCents = Math.round(Number(auth.amount?.value ?? "0") * 100);
  if (auth.amount?.currencyCode !== "USD" || heldCents !== job.totalCents) {
    // Never keep a hold for the wrong amount.
    await paypal().payments.voidPayment({ authorizationId: auth.id, paypalRequestId: `vouch-void-mismatch-${auth.id}` }).catch(() => undefined);
    throw new AgreementError(`PayPal held ${formatCents(heldCents)} instead of ${formatCents(job.totalCents)}. Nothing was charged; please try again.`);
  }

  if (auth.status === AuthorizationStatus.Denied || auth.status === AuthorizationStatus.Voided) {
    throw new AgreementError("PayPal declined the payment. Nothing was charged.");
  }
  const pending = auth.status === AuthorizationStatus.Pending;

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).for("update");
    if (locked.status !== "AGREED") return "already" as const;

    const requestId = `vouch-auth-${orderId}`;
    await tx
      .insert(schema.payments)
      .values({
        jobId,
        type: "authorize",
        status: pending ? "pending_paypal" : "completed",
        amountCents: heldCents,
        requestId,
        paypalId: auth.id,
        paypalStatus: auth.status,
      })
      .onConflictDoUpdate({ target: schema.payments.requestId, set: { status: pending ? "pending_paypal" : "completed", paypalStatus: auth.status } });

    if (pending) {
      await tx.update(schema.jobs).set({ paypalAuthorizationId: auth.id }).where(eq(schema.jobs.id, jobId));
      await tx.insert(schema.events).values({ jobId, type: "payment.authorization_pending", source: "paypal", payload: { authorizationId: auth.id } });
      return "pending" as const;
    }

    assertTransition(locked.status, "FUNDED");
    const now = new Date();
    const expires = auth.expirationTime ? new Date(auth.expirationTime) : new Date(now.getTime() + AUTH_VALID_DAYS * DAY);
    await tx
      .update(schema.jobs)
      .set({
        status: "FUNDED",
        paypalAuthorizationId: auth.id,
        authorizedCents: heldCents,
        authorizedAt: now,
        honorExpiresAt: new Date(now.getTime() + HONOR_PERIOD_DAYS * DAY),
        authExpiresAt: expires,
      })
      .where(eq(schema.jobs.id, jobId));
    await createMilestones(tx, locked, now);
    await tx.insert(schema.events).values({
      jobId,
      type: "payment.authorized",
      source: "paypal",
      payload: { authorizationId: auth.id, amountCents: heldCents, orderId, via: source, expiresAt: expires.toISOString() },
    });
    return "funded" as const;
  });
}
