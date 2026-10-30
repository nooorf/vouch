import { CHECKS } from "@/lib/brief/checks";
import type { Criterion } from "@/lib/brief/schema";
import { env } from "@/lib/env";
import type { CheckContext, CheckOutcome } from "./checks";
import { runCheck } from "./checks";
import { FetchBlockedError, safeFetch, type FetchOptions } from "./fetch";
import { readRepo, type RepoOutcome } from "./github";
import { parsePage, type Page } from "./page";
import { runPageSpeed, type PageSpeedOutcome } from "./pagespeed";
import { getRenderer, type RenderedPage } from "./render";
import { findSuspicious, type Finding } from "./suspicious";

export interface MeasuredResult extends CheckOutcome {
  criterionId: string;
  checkId: string;
  label: string;
}

export interface RefereeReport {
  url: string;
  page: { finalUrl: string; status: number; ms: number; bytes: number; title: string } | null;
  fetchError: string | null;
  checks: MeasuredResult[];
  suspicious: { flagged: boolean; findings: Finding[] };
  pagespeed: { ok: true; scores: Extract<PageSpeedOutcome, { ok: true }>["scores"] } | { ok: false; error: string } | null;
  /** How the page behaved in a real browser (no screenshots or HTML, so it's small enough to store). */
  rendered: {
    renderer: RenderedPage["renderer"];
    ms: number;
    pageErrors: string[];
    consoleErrors: number;
    failedRequests: RenderedPage["failedRequests"];
    mobileOverflow: boolean;
    desktopOverflow: boolean;
    /** Visible text grew this much once JavaScript ran: big growth means a client-rendered app. */
    textBefore: number;
    textAfter: number;
  } | null;
  renderError: string | null;
  /** Screenshot of the page on a phone (real browser, else Lighthouse), for the AI judge. */
  screenshot: { mimeType: string; data: string } | null;
  /** The visible text the AI judge reads, clipped. */
  pageText: string;
  ms: number;
}

export interface RunInput {
  url: string;
  repoUrl?: string | null;
  criteria: Criterion[];
  /** Commits after this moment count as fresh work. */
  fundedAt?: Date | null;
  /** Run PageSpeed even if no criterion needs it (to get a screenshot for visual judging). */
  wantScreenshot?: boolean;
}

/** Network-level failures (DNS, resets) can be ours: try up to 3 times before giving up. */
async function fetchWithRetry(url: string, opts: FetchOptions) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await safeFetch(url, opts);
    } catch (err) {
      if (!(err instanceof FetchBlockedError) || err.kind !== "network" || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

const once = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
};

/** Measure a delivery against its criteria. Judged criteria are left for the AI judge. */
export async function runReferee(input: RunInput): Promise<RefereeReport> {
  const started = Date.now();
  const allowLocal = env().REFEREE_ALLOW_LOCALHOST;
  const fetchOpts: FetchOptions = allowLocal ? { allowAddress: (ip) => ip === "127.0.0.1" || ip === "::1", allowAnyPort: true } : {};

  let page: Page | null = null;
  let fetchError: string | null = null;
  let unreachable = false;
  try {
    let res = await fetchWithRetry(input.url, fetchOpts);
    // One slow sample can be a network blip: measure once more and keep the faster load.
    if (res.ms > 5000) {
      const again = await safeFetch(input.url, fetchOpts).catch(() => null);
      if (again && again.ms < res.ms) res = again;
    }
    page = parsePage({ url: input.url, finalUrl: res.finalUrl, status: res.status, ms: res.ms, bytes: res.bytes, truncated: res.truncated, html: res.body });
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
    unreachable = err instanceof FetchBlockedError && err.kind === "network";
  }

  // Load it in a real browser too, so web apps that build their page with JavaScript are judged
  // on what a visitor sees. The static fetch above still decides status, load time and size.
  const renderer = getRenderer();
  let rendered: RenderedPage | null = null;
  let renderError: string | null = null;
  if (!page) {
    renderError = "the page couldn't be loaded";
  } else if (page.status >= 400) {
    renderError = `the page returned HTTP ${page.status}`;
  } else if (!renderer) {
    renderError = "no browser is available on this server";
  } else {
    const r = await renderer.render(page.finalUrl, { allowLocal });
    if (r.ok) rendered = r.page;
    else renderError = r.error;
  }
  const staticPage = page;
  if (page && rendered) {
    page = parsePage({ url: input.url, finalUrl: page.finalUrl, status: page.status, ms: page.ms, bytes: page.bytes, truncated: page.truncated, html: rendered.html });
  }

  const checks = input.criteria.filter((c) => c.kind === "check");
  // Lighthouse for its scores, or for a screenshot when we couldn't take our own.
  const needsLighthouse = checks.some((c) => CHECKS[c.checkId].group === "lighthouse") || (input.wantScreenshot && !rendered);
  const pagespeed = once(() => runPageSpeed(page?.finalUrl ?? input.url));
  const repo = once<RepoOutcome | null>(() => (input.repoUrl ? readRepo(input.repoUrl, input.fundedAt ?? null) : Promise.resolve(null)));

  const ctx: CheckContext = {
    page,
    fetchError: fetchError ?? undefined,
    unreachable,
    rendered,
    renderError: renderError ?? undefined,
    allowHttp: allowLocal,
    fetchUrl: async (url, method = "GET") => {
      const r = await safeFetch(url, { ...fetchOpts, method, maxBytes: 512 * 1024, timeoutMs: 8000 });
      return { status: r.status, body: r.body };
    },
    pagespeed,
    repo,
  };

  // Start the slow external call early so it overlaps with the page checks.
  const ps = page && needsLighthouse ? pagespeed() : null;

  const results = await Promise.all(
    checks.map(async (c): Promise<MeasuredResult> => {
      let outcome: CheckOutcome;
      try {
        outcome = await runCheck(c.checkId, c.params, ctx);
      } catch (err) {
        outcome = { status: "error", evidence: `The check crashed: ${err instanceof Error ? err.message : String(err)}` };
      }
      return { criterionId: c.id, checkId: c.checkId, label: CHECKS[c.checkId].label, ...outcome };
    }),
  );

  const psResult = ps ? await ps : null;
  // Scan both the HTML as sent and the page after JavaScript ran: instructions can be injected either way.
  const scans = [staticPage, rendered ? page : null].filter((p): p is Page => Boolean(p)).map(findSuspicious);
  const findings = scans.flatMap((s) => s.findings).filter((f, i, all) => all.findIndex((g) => g.excerpt.slice(0, 80) === f.excerpt.slice(0, 80)) === i);
  return {
    url: input.url,
    page: page ? { finalUrl: page.finalUrl, status: page.status, ms: page.ms, bytes: page.bytes, title: page.title } : null,
    fetchError,
    checks: results,
    suspicious: { flagged: findings.length > 0, findings },
    pagespeed: psResult ? (psResult.ok ? { ok: true, scores: psResult.scores } : { ok: false, error: psResult.error }) : null,
    rendered: rendered
      ? {
          renderer: rendered.renderer,
          ms: rendered.ms,
          pageErrors: rendered.pageErrors,
          consoleErrors: rendered.consoleErrors.length,
          failedRequests: rendered.failedRequests,
          mobileOverflow: rendered.mobile.horizontalOverflow,
          desktopOverflow: rendered.desktop.horizontalOverflow,
          textBefore: staticPage?.visibleText.length ?? 0,
          textAfter: page?.visibleText.length ?? 0,
        }
      : null,
    renderError,
    // Our own phone screenshot when we rendered the page, otherwise Lighthouse's.
    screenshot: rendered?.mobile.screenshot ?? (psResult?.ok ? psResult.screenshot : null),
    pageText: page ? page.visibleText.slice(0, 8000) : "",
    ms: Date.now() - started,
  };
}
