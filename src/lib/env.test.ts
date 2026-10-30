import { describe, expect, it } from "vitest";
import { EnvError, featureReport, hasFeature, missingFor, parseEnv } from "./env";

const core = {
  DATABASE_URL_POOLED: "postgresql://u:p@host-pooler/db",
  AUTH_SECRET: "s".repeat(32),
};

describe("parseEnv", () => {
  it("accepts the minimal core config and applies defaults", () => {
    const e = parseEnv(core);
    expect(e.APP_URL).toBe("http://localhost:3000");
    expect(e.PAYPAL_ENV).toBe("sandbox");
    expect(e.GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(e.DEMO_MODE).toBe(false);
  });

  it("treats empty strings as unset", () => {
    const e = parseEnv({ ...core, GEMINI_API_KEY: "", PAYPAL_FREELANCER_EMAIL: "", APP_URL: "" });
    expect(e.GEMINI_API_KEY).toBeUndefined();
    expect(e.APP_URL).toBe("http://localhost:3000");
  });

  it("lists every problem at once", () => {
    try {
      parseEnv({ AUTH_SECRET: "short", PAYPAL_CLIENT_ID: "abcdefghijkl", PAYPAL_FREELANCER_EMAIL: "nope" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const problems = (err as EnvError).problems.join("\n");
      expect(problems).toMatch(/AUTH_SECRET/);
      expect(problems).toMatch(/PAYPAL_FREELANCER_EMAIL/);
      expect(problems).toMatch(/DATABASE_URL_POOLED/);
      expect(problems).toMatch(/both PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET/);
    }
  });

  it("allows the referee's localhost switch only when the app itself runs on localhost", () => {
    expect(parseEnv({ ...core, REFEREE_ALLOW_LOCALHOST: "true" }).REFEREE_ALLOW_LOCALHOST).toBe(true);
    expect(() => parseEnv({ ...core, REFEREE_ALLOW_LOCALHOST: "true", APP_URL: "https://vouch.onrender.com" })).toThrow(/local development only/);
  });

  it("refuses live PayPal", () => {
    expect(() => parseEnv({ ...core, PAYPAL_ENV: "live" })).toThrow(/sandbox/);
  });
});

describe("features", () => {
  it("are off until fully configured", () => {
    const e = parseEnv({ ...core, PAYPAL_CLIENT_ID: "abcdefghijkl", PAYPAL_CLIENT_SECRET: "abcdefghijkl" });
    expect(hasFeature("paypal", e)).toBe(false);
    expect(missingFor("paypal", e)).toEqual(["NEXT_PUBLIC_PAYPAL_CLIENT_ID"]);
    expect(hasFeature("ai", e)).toBe(false);
    expect(featureReport(e)[0]).toMatch(/^○ PayPal payments \(off: set NEXT_PUBLIC_PAYPAL_CLIENT_ID\)/);
  });

  it("turn on when every key is present", () => {
    const e = parseEnv({ ...core, GEMINI_API_KEY: "g".repeat(39) });
    expect(hasFeature("ai", e)).toBe(true);
  });
});
