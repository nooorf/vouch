import { createHmac, timingSafeEqual } from "node:crypto";

/** What the session cookie carries. Keep it small: everything else is looked up. */
export interface SessionData {
  /** users.id */
  uid: string;
  demo: boolean;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign(payload: string, secret: string) {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

function assertSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set (at least 32 characters)");
}

/** `<base64url json>.<base64url hmac>` */
export function encodeSession(data: SessionData, secret: string | undefined): string {
  assertSecret(secret);
  const payload = b64url(Buffer.from(JSON.stringify(data)));
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns null for anything tampered, malformed or expired. Never throws on bad input. */
export function decodeSession(
  token: string | undefined,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionData | null {
  assertSecret(secret);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionData>;
    if (typeof data.uid !== "string" || typeof data.exp !== "number" || typeof data.demo !== "boolean") return null;
    if (data.exp <= nowSeconds) return null;
    return { uid: data.uid, demo: data.demo, exp: data.exp };
  } catch {
    return null;
  }
}
