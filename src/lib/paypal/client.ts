import {
  ApiError,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
} from "@paypal/paypal-server-sdk";
import { requireFeature } from "@/lib/env";

let cached: { client: Client; orders: OrdersController; payments: PaymentsController } | null = null;

/**
 * Server-only PayPal controllers, built once per process.
 *
 * Rule: every POST we send carries a PayPal-Request-Id. That is what makes the POST retries
 * below safe: PayPal replays the original result instead of capturing twice.
 */
export function paypal() {
  if (cached) return cached;
  const e = requireFeature("paypal");
  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: e.PAYPAL_CLIENT_ID!,
      oAuthClientSecret: e.PAYPAL_CLIENT_SECRET!,
    },
    // env() refuses PAYPAL_ENV=live: Vouch only runs against the sandbox.
    environment: Environment.Sandbox,
    // The SDK default is 0, which axios treats as "wait forever".
    timeout: 15_000,
    httpClientOptions: {
      // The SDK default is no retries (maximumRetryWaitTime 0 disables them even if
      // maxNumberOfRetries is raised), so both are set.
      retryConfig: {
        maxNumberOfRetries: 2,
        maximumRetryWaitTime: 10,
        retryInterval: 1,
        backoffFactor: 2,
        retryOnTimeout: true,
        httpStatusCodesToRetry: [408, 429, 500, 502, 503, 504],
        httpMethodsToRetry: ["GET", "POST"],
      },
    },
    // No `logging` on purpose: any logging config makes the SDK print every request and response.
    // Failures surface through paypalErrorInfo() and our own logs instead.
  });
  cached = { client, orders: new OrdersController(client), payments: new PaymentsController(client) };
  return cached;
}

/** PayPal's REST base URL for calls the SDK doesn't cover (env() only allows the sandbox). */
export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

let token: { value: string; expiresAt: number } | null = null;

/**
 * An OAuth access token for REST calls the SDK has no operation for (webhook verification).
 * Fetched through the SDK's own auth manager, cached until a minute before it expires.
 */
export async function paypalAccessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value;
  const t = await paypal().client.clientCredentialsAuthManager.fetchToken();
  const expiresAt = t.expiry ? Number(t.expiry) * 1000 - 60_000 : Date.now() + 5 * 60_000;
  token = { value: t.accessToken, expiresAt };
  return t.accessToken;
}

/** PayPal wants decimal strings. We store integer cents everywhere else. */
export function usd(cents: number) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Bad amount: ${cents}`);
  return { currencyCode: "USD", value: (cents / 100).toFixed(2) };
}

export interface PayPalErrorInfo {
  status: number | null;
  /** PayPal's error name, e.g. UNPROCESSABLE_ENTITY. */
  name: string | null;
  /** First detail issue, e.g. AUTHORIZATION_ALREADY_CAPTURED. */
  issue: string | null;
  message: string;
  debugId: string | null;
}

/**
 * Turn any thrown value from a PayPal call into something we can log and show.
 * A bare ApiError leaves `result` undefined and only fills `body`, so we parse `body` ourselves.
 * Network failures are not ApiErrors at all.
 */
export function paypalErrorInfo(err: unknown): PayPalErrorInfo {
  if (err instanceof ApiError) {
    let payload: Record<string, unknown> | undefined =
      (err.result as Record<string, unknown> | undefined) ?? undefined;
    if (!payload && typeof err.body === "string") {
      try {
        payload = JSON.parse(err.body);
      } catch {
        payload = undefined;
      }
    }
    const details = Array.isArray(payload?.details) ? (payload.details as Record<string, unknown>[]) : [];
    return {
      status: err.statusCode,
      name: typeof payload?.name === "string" ? payload.name : null,
      issue: typeof details[0]?.issue === "string" ? (details[0].issue as string) : null,
      message:
        (typeof details[0]?.description === "string" && (details[0].description as string)) ||
        (typeof payload?.message === "string" && payload.message) ||
        `PayPal returned HTTP ${err.statusCode}`,
      debugId: typeof payload?.debug_id === "string" ? payload.debug_id : null,
    };
  }
  return {
    status: null,
    name: null,
    issue: null,
    message: err instanceof Error ? err.message : String(err),
    debugId: null,
  };
}
