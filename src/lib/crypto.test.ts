import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hashToken, LINK_TOKEN_RE, newLinkToken } from "./crypto";

const secret = "k".repeat(32);

describe("link tokens", () => {
  it("are url-safe, unique, and looked up by hash", () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(a.token).toMatch(LINK_TOKEN_RE);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});

describe("encrypt / decrypt", () => {
  it("round-trips", () => {
    expect(decrypt(encrypt("hello", secret, "link"), secret, "link")).toBe("hello");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same", secret, "link")).not.toBe(encrypt("same", secret, "link"));
  });

  it("rejects tampering, the wrong secret and the wrong purpose", () => {
    const sealed = encrypt("hello", secret, "link");
    const [iv, tag, data] = sealed.split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(decrypt(`${iv}.${tag}.${flipped.toString("base64url")}`, secret, "link")).toBeNull();
    expect(decrypt(sealed, "z".repeat(32), "link")).toBeNull();
    expect(decrypt(sealed, secret, "other")).toBeNull();
    expect(decrypt("garbage", secret, "link")).toBeNull();
  });
});
