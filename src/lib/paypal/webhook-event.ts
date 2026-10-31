import { z } from "zod";

/**
 * Pure helpers for PayPal webhooks: reading an event and building the signature check request.
 * Kept free of database and network code so they can be unit-tested.
 */

/** The events Vouch subscribes to (register exactly these in the PayPal developer dashboard). */
export const WEBHOOK_EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
] as const;

const EventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z.record(z.string(), z.unknown()),
});

export type WebhookEvent = z.infer<typeof EventSchema>;

/** Parse a webhook body. Returns null for anything that isn't a PayPal event. */
export function parseWebhookEvent(raw: string): WebhookEvent | null {
  try {
    const parsed = EventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The ids and amounts an event points at, whatever kind of resource it carries. */
export interface WebhookRefs {
  resourceId: string | null;
  status: string | null;
  amountCents: number | null;
  /** Vouch puts the job id in purchase_units[].custom_id; PayPal copies it to authorizations and captures. */
  customId: string | null;
  orderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  /** Vouch sets a capture's invoice_id to its PayPal-Request-Id. */
  invoiceId: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function cents(amount: unknown): number | null {
  const value = Number(obj(amount)?.value);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** A refund names its capture only through its "up" link (…/v2/payments/captures/{id}). */
function captureFromLinks(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const l = obj(link);
    const match = l?.rel === "up" && typeof l.href === "string" ? l.href.match(/\/captures\/([^/?#]+)/) : null;
    if (match) return match[1];
  }
  return null;
}

export function webhookRefs(event: WebhookEvent): WebhookRefs {
  const r = event.resource;
  const type = event.event_type;
  const related = obj(obj(r.supplementary_data)?.related_ids);
  const unit = Array.isArray(r.purchase_units) ? obj(r.purchase_units[0]) : undefined;
  const isOrder = type.startsWith("CHECKOUT.ORDER.");
  const isAuthorization = type.startsWith("PAYMENT.AUTHORIZATION.");
  const isRefund = type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED";
  const isCapture = type.startsWith("PAYMENT.CAPTURE.") && !isRefund;

  return {
    resourceId: str(r.id),
    status: str(r.status),
    amountCents: cents(r.amount ?? unit?.amount),
    customId: str(r.custom_id) ?? str(unit?.custom_id),
    orderId: isOrder ? str(r.id) : str(related?.order_id),
    authorizationId: isAuthorization ? str(r.id) : str(related?.authorization_id),
    captureId: isCapture ? str(r.id) : isRefund ? captureFromLinks(r.links) : null,
    invoiceId: str(r.invoice_id),
  };
}

/** The transmission headers PayPal signs every delivery with. */
export const SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * Body for POST /v1/notifications/verify-webhook-signature, or null if a signature header is missing.
 * The event goes in as the exact bytes PayPal sent: re-serializing parsed JSON can change it
 * (number formats, escaping) and make a genuine event fail the check.
 */
export function buildVerifyBody(headers: Headers, webhookId: string, rawBody: string): string | null {
  const fields: Record<string, string> = {};
  for (const [field, header] of Object.entries(SIGNATURE_HEADERS)) {
    const value = headers.get(header);
    if (!value) return null;
    fields[field] = value;
  }
  const head = JSON.stringify({ ...fields, webhook_id: webhookId });
  return `${head.slice(0, -1)},"webhook_event":${rawBody.trim()}}`;
}
