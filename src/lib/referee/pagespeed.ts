import { env } from "@/lib/env";

/**
 * Google PageSpeed Insights runs Lighthouse on Google's servers: credible, third-party scores
 * for accessibility, performance and SEO on a mobile device, plus a screenshot of the rendered
 * page that the AI judge can look at. Works without an API key at a lower rate limit.
 */

export interface PageSpeedResult {
  ok: true;
  scores: { accessibility: number | null; performance: number | null; seo: number | null };
  /** Top failing accessibility audits, for evidence. */
  a11yIssues: string[];
  screenshot: { mimeType: string; data: string } | null;
  finalUrl: string;
}
export type PageSpeedOutcome = PageSpeedResult | { ok: false; error: string };

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

interface LhAudit {
  title?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  details?: { data?: string };
}

export async function runPageSpeed(url: string, timeoutMs = 90_000): Promise<PageSpeedOutcome> {
  const params = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of ["accessibility", "performance", "seo"]) params.append("category", c);
  const key = env().PAGESPEED_API_KEY;
  if (key) params.set("key", key);

  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json()) as {
      error?: { message?: string };
      lighthouseResult?: {
        finalUrl?: string;
        categories?: Record<string, { score: number | null; auditRefs?: { id: string; weight: number }[] }>;
        audits?: Record<string, LhAudit>;
        runtimeError?: { message?: string };
      };
    };
    if (!res.ok || body.error) {
      const msg = body.error?.message ?? `PageSpeed returned HTTP ${res.status}`;
      if (/quota/i.test(msg)) return { ok: false, error: `PageSpeed's daily quota is used up${key ? "" : " (set PAGESPEED_API_KEY for a quota of your own)"}` };
      return { ok: false, error: msg.slice(0, 200) };
    }
    const lh = body.lighthouseResult;
    if (!lh || lh.runtimeError) return { ok: false, error: lh?.runtimeError?.message ?? "Lighthouse couldn't load the page" };

    const score = (c: string) => (typeof lh.categories?.[c]?.score === "number" ? Math.round(lh.categories[c].score! * 100) : null);
    const audits = lh.audits ?? {};
    const a11yIssues = (lh.categories?.accessibility?.auditRefs ?? [])
      .filter((ref) => ref.weight > 0 && audits[ref.id]?.score === 0 && audits[ref.id]?.scoreDisplayMode === "binary")
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5)
      .map((ref) => audits[ref.id].title ?? ref.id);
    const shot = audits["final-screenshot"]?.details?.data;
    const m = shot?.match(/^data:(image\/\w+);base64,(.+)$/);

    return {
      ok: true,
      scores: { accessibility: score("accessibility"), performance: score("performance"), seo: score("seo") },
      a11yIssues,
      screenshot: m ? { mimeType: m[1], data: m[2] } : null,
      finalUrl: lh.finalUrl ?? url,
    };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, error: timedOut ? "PageSpeed took too long" : `PageSpeed request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
