import { describe, expect, it } from "vitest";
import { buildVerifyBody, parseWebhookEvent, webhookRefs, type WebhookEvent } from "./webhook-event";

const JOB = "5b0c7e2a-3f4d-4b6e-9a1c-2d3e4f5a6b7c";

const event = (event_type: string, resource: Record<string, unknown>): WebhookEvent => ({ id: "WH-1", event_type, resource });

describe("parseWebhookEvent", () => {
  it("accepts a PayPal event and rejects anything else", () => {
    expect(parseWebhookEvent(JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "C1" } }))?.id).toBe("WH-1");
    expect(parseWebhookEvent("not json")).toBeNull();
    expect(parseWebhookEvent(JSON.stringify({ id: "WH-1" }))).toBeNull();
    expect(parseWebhookEvent(JSON.stringify({ id: "WH-1", event_type: "X", resource: [] }))).toBeNull();
  });
});

describe("webhookRefs", () => {
  it("reads an approved order", () => {
    const refs = webhookRefs(
      event("CHECKOUT.ORDER.APPROVED", {
        id: "ORDER-1",
        status: "APPROVED",
        purchase_units: [{ custom_id: JOB, amount: { currency_code: "USD", value: "400.00" } }],
      }),
    );
    expect(refs).toMatchObject({ orderId: "ORDER-1", customId: JOB, amountCents: 40000, authorizationId: null, captureId: null });
  });

  it("reads an authorization and its order", () => {
    const refs = webhookRefs(
      event("PAYMENT.AUTHORIZATION.CREATED", {
        id: "AUTH-1",
        status: "CREATED",
        custom_id: JOB,
        amount: { currency_code: "USD", value: "400.00" },
        supplementary_data: { related_ids: { order_id: "ORDER-1" } },
      }),
    );
    expect(refs).toMatchObject({ authorizationId: "AUTH-1", orderId: "ORDER-1", customId: JOB, amountCents: 40000, captureId: null });
  });

  it("reads a capture with its invoice id (our request id) and related ids", () => {
    const refs = webhookRefs(
      event("PAYMENT.CAPTURE.COMPLETED", {
        id: "CAP-1",
        status: "COMPLETED",
        invoice_id: "vouch-cap-m1-0",
        amount: { currency_code: "USD", value: "90.50" },
        supplementary_data: { related_ids: { order_id: "ORDER-1", authorization_id: "AUTH-1" } },
      }),
    );
    expect(refs).toMatchObject({ captureId: "CAP-1", authorizationId: "AUTH-1", orderId: "ORDER-1", invoiceId: "vouch-cap-m1-0", amountCents: 9050 });
  });

  it("finds a refund's capture through its up link", () => {
    const refs = webhookRefs(
      event("PAYMENT.CAPTURE.REFUNDED", {
        id: "REF-1",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "10.00" },
        links: [
          { rel: "self", href: "https://api.sandbox.paypal.com/v2/payments/refunds/REF-1" },
          { rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP-1" },
        ],
      }),
    );
    expect(refs).toMatchObject({ resourceId: "REF-1", captureId: "CAP-1", amountCents: 1000 });
  });

  it("copes with missing fields", () => {
    expect(webhookRefs(event("PAYMENT.CAPTURE.DENIED", {}))).toEqual({
      resourceId: null,
      status: null,
      amountCents: null,
      customId: null,
      orderId: null,
      authorizationId: null,
      captureId: null,
      invoiceId: null,
    });
  });
});

describe("buildVerifyBody", () => {
  const headers = new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "T-1",
    "paypal-transmission-sig": "SIG",
    "paypal-transmission-time": "2026-10-31T10:00:00Z",
  });

  it("embeds the event exactly as PayPal sent it", () => {
    // 400.10 would come back as 400.1 if re-serialized; the original bytes must reach PayPal.
    const raw = '{"id":"WH-1","event_type":"X","resource":{"amount":{"value":400.10}}}';
    const body = buildVerifyBody(headers, "WEBHOOK-1", raw)!;
    expect(body).toContain('"webhook_event":{"id":"WH-1","event_type":"X","resource":{"amount":{"value":400.10}}}');
    expect(JSON.parse(body)).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      transmission_id: "T-1",
      transmission_sig: "SIG",
      transmission_time: "2026-10-31T10:00:00Z",
      webhook_id: "WEBHOOK-1",
      webhook_event: { id: "WH-1" },
    });
  });

  it("refuses an unsigned request", () => {
    const missing = new Headers(headers);
    missing.delete("paypal-transmission-sig");
    expect(buildVerifyBody(missing, "WEBHOOK-1", "{}")).toBeNull();
  });
});
