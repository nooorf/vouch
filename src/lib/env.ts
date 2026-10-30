import { z } from "zod";

/**
 * Every environment variable the server reads, validated in one place.
 * Core settings must be valid; integrations (PayPal, AI, email…) are optional features that
 * switch on when fully configured. Use `env()` for values and `requireFeature()` before using
 * an integration, so a missing key fails with a clear message instead of halfway through.
 */

// Empty strings in .env files mean "not set".
const opt = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
const flag = z.preprocess((v) => v === "true" || v === "1", z.boolean());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    APP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().default("http://localhost:3000")),
    DEMO_MODE: flag,

    DATABASE_URL: opt(z.string().startsWith("postgres", "DATABASE_URL must be a postgres:// connection string")),
    DATABASE_URL_POOLED: opt(z.string().startsWith("postgres", "DATABASE_URL_POOLED must be a postgres:// connection string")),
    AUTH_SECRET: opt(z.string().min(32, "AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)")),

    PAYPAL_ENV: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["sandbox", "live"]).default("sandbox")),
    PAYPAL_CLIENT_ID: opt(z.string().min(10)),
    PAYPAL_CLIENT_SECRET: opt(z.string().min(10)),
    NEXT_PUBLIC_PAYPAL_CLIENT_ID: opt(z.string().min(10)),
    PAYPAL_WEBHOOK_ID: opt(z.string().min(5)),
    PAYPAL_FREELANCER_EMAIL: opt(z.email("PAYPAL_FREELANCER_EMAIL must be an email")),
    /** Sandbox buyer shown on demo client pages so judges can pay (sandbox only, not a secret). */
    DEMO_BUYER_EMAIL: opt(z.email("DEMO_BUYER_EMAIL must be an email")),
    DEMO_BUYER_PASSWORD: opt(z.string().min(1)),

    LLM_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["gemini"]).default("gemini")),
    GEMINI_API_KEY: opt(z.string().min(20)),
    GEMINI_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("gemini-3.8-flash")),
    GEMINI_FALLBACK_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("gemini-flash-lite-latest")),

    GITHUB_TOKEN: opt(z.string().min(10)),
    PAGESPEED_API_KEY: opt(z.string().min(10)),
    RESEND_API_KEY: opt(z.string().startsWith("re_", "RESEND_API_KEY starts with re_")),
    EMAIL_FROM: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("onboarding@resend.dev")),
    CRON_SECRET: opt(z.string().min(16)),
    /** Review window for demo jobs, so judges can watch the silence rule release money. */
    DEMO_REVIEW_WINDOW_SECONDS: z.preprocess((v) => (v === "" || v === undefined ? undefined : Number(v)), z.number().int().min(10).max(86_400).default(120)),
    /** Local development only: let the referee fetch http://localhost (e.g. the demo sites). */
    REFEREE_ALLOW_LOCALHOST: flag,
  })
  .superRefine((e, ctx) => {
    if (!e.DATABASE_URL_POOLED && !e.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL_POOLED"], message: "Set DATABASE_URL_POOLED (or DATABASE_URL) to your Neon connection string" });
    }
    if (!e.AUTH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "Set AUTH_SECRET (openssl rand -base64 32)" });
    }
    if (Boolean(e.PAYPAL_CLIENT_ID) !== Boolean(e.PAYPAL_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["PAYPAL_CLIENT_SECRET"], message: "Set both PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET, or neither" });
    }
    if (e.PAYPAL_CLIENT_ID && e.NEXT_PUBLIC_PAYPAL_CLIENT_ID && e.PAYPAL_CLIENT_ID !== e.NEXT_PUBLIC_PAYPAL_CLIENT_ID) {
      ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_PAYPAL_CLIENT_ID"], message: "NEXT_PUBLIC_PAYPAL_CLIENT_ID must equal PAYPAL_CLIENT_ID" });
    }
    // Only on a machine whose own app URL is local: a deployed server (public APP_URL) refuses it.
    if (e.REFEREE_ALLOW_LOCALHOST && !["localhost", "127.0.0.1"].includes(new URL(e.APP_URL).hostname)) {
      ctx.addIssue({ code: "custom", path: ["REFEREE_ALLOW_LOCALHOST"], message: "REFEREE_ALLOW_LOCALHOST is for local development only (APP_URL must be localhost)" });
    }
    if (e.PAYPAL_ENV === "live") {
      ctx.addIssue({ code: "custom", path: ["PAYPAL_ENV"], message: "Vouch only runs against the PayPal sandbox" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`));
  }
  return parsed.data;
}

let cached: Env | null = null;
/** Validated server environment, parsed once. Throws EnvError with every problem listed. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/* ------------------------------------------------------------------ */
/* Optional integrations                                                */
/* ------------------------------------------------------------------ */

export const FEATURES = {
  paypal: { label: "PayPal payments", needs: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "NEXT_PUBLIC_PAYPAL_CLIENT_ID"] },
  paypalWebhooks: { label: "PayPal webhooks", needs: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"] },
  ai: { label: "AI (Gemini)", needs: ["GEMINI_API_KEY"] },
  githubChecks: { label: "GitHub repo checks", needs: ["GITHUB_TOKEN"] },
  pagespeed: { label: "Lighthouse via PageSpeed (the keyless quota is shared and often used up)", needs: ["PAGESPEED_API_KEY"] },
  email: { label: "Email (Resend)", needs: ["RESEND_API_KEY"] },
  cron: { label: "External cron endpoint", needs: ["CRON_SECRET"] },
} as const satisfies Record<string, { label: string; needs: (keyof Env)[] }>;

export type Feature = keyof typeof FEATURES;

export function missingFor(feature: Feature, e: Env = env()): string[] {
  return FEATURES[feature].needs.filter((k) => !e[k]);
}

export function hasFeature(feature: Feature, e: Env = env()): boolean {
  return missingFor(feature, e).length === 0;
}

export class FeatureUnavailableError extends Error {
  constructor(readonly feature: Feature, readonly missing: string[]) {
    super(`${FEATURES[feature].label} is not configured. Set ${missing.join(", ")}.`);
    this.name = "FeatureUnavailableError";
  }
}

/** Call before using an integration. Returns the validated env for convenience. */
export function requireFeature(feature: Feature): Env {
  const e = env();
  const missing = missingFor(feature, e);
  if (missing.length) throw new FeatureUnavailableError(feature, missing);
  return e;
}

/** One line per feature, for startup logs and `npm run env:check`. */
export function featureReport(e: Env = env()): string[] {
  return (Object.keys(FEATURES) as Feature[]).map((f) => {
    const missing = missingFor(f, e);
    return `${missing.length ? "○" : "●"} ${FEATURES[f].label}${missing.length ? ` (off: set ${missing.join(", ")})` : ""}`;
  });
}
