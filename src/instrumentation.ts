import type { Instrumentation } from "next";

/** Runs once when the server starts: fail fast on bad config, and log which features are on. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return; // builds don't need secrets
  const { env, featureReport, EnvError } = await import("@/lib/env");
  try {
    env();
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(`[vouch] ${err.message}`);
      // Refuse to serve with broken core config in production; keep dev running so the error is visible.
      if (process.env.NODE_ENV === "production") throw err;
      return;
    }
    throw err;
  }
  console.log(`[vouch] features\n  ${featureReport().join("\n  ")}`);
}

/** One structured line per server error, easy to search in Render's logs. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(
    JSON.stringify({
      level: "error",
      msg: e.message,
      digest: e.digest,
      path: request.path,
      method: request.method,
      route: context.routePath,
      kind: context.routerKind,
      stack: e.stack?.split("\n").slice(0, 6).join("\n"),
    }),
  );
};
