import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** A random link token (43 url-safe chars) and the sha256 we store and look it up by. */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function key(secret: string, purpose: string) {
  if (secret.length < 32) throw new Error("Secret too short");
  return createHash("sha256").update(`vouch:${purpose}:${secret}`).digest();
}

/** AES-256-GCM. Output: base64url(iv).base64url(tag).base64url(ciphertext). */
export function encrypt(plain: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret, purpose), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

/** Returns null if the value was tampered with or encrypted under another secret/purpose. */
export function decrypt(sealed: string, secret: string, purpose: string): string | null {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p ?? "", "base64url"));
  if (!iv?.length || !tag?.length || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret, purpose), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
