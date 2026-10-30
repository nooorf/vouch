import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "./token";

const secret = "x".repeat(32);
const now = 1_800_000_000;
const data = { uid: "user-1", demo: true, exp: now + 60 };

describe("session token", () => {
  it("round-trips", () => {
    expect(decodeSession(encodeSession(data, secret), secret, now)).toEqual(data);
  });

  it("rejects a token signed with another secret", () => {
    expect(decodeSession(encodeSession(data, "y".repeat(32)), secret, now)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [, sig] = encodeSession(data, secret).split(".");
    const forged = Buffer.from(JSON.stringify({ ...data, uid: "someone-else" })).toString("base64url");
    expect(decodeSession(`${forged}.${sig}`, secret, now)).toBeNull();
  });

  it("rejects expired, malformed and missing tokens", () => {
    expect(decodeSession(encodeSession(data, secret), secret, now + 61)).toBeNull();
    expect(decodeSession("garbage", secret, now)).toBeNull();
    expect(decodeSession("a.b.c", secret, now)).toBeNull();
    expect(decodeSession(undefined, secret, now)).toBeNull();
  });

  it("refuses to work without a strong secret", () => {
    expect(() => encodeSession(data, "short")).toThrow();
    expect(() => decodeSession("a.b", undefined)).toThrow();
  });
});
