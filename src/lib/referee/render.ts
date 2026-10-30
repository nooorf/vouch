import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import puppeteer, { type Browser, type HTTPRequest, type Page as PuppeteerPage } from "puppeteer-core";
import { env } from "@/lib/env";
import { isBlockedAddress } from "./fetch";

/**
 * Web apps often build their page in the browser: their HTML is an empty shell until JavaScript
 * runs. A renderer loads the delivery in a real browser, so checks and the AI judge see what a
 * visitor sees, and records what only a browser can: JavaScript errors, failed requests (a dead
 * backend), and how the layout behaves on a phone and on a desktop.
 *
 * - "kernel": a cloud browser from Kernel (deployed app; isolated from our network).
 * - "chrome": a local Chrome (development). Every request the page makes goes through our SSRF rules.
 */

export interface ViewportResult {
  width: number;
  /** Page wider than the screen: content spills off the side. */
  horizontalOverflow: boolean;
  scrollWidth: number;
  screenshot: { mimeType: string; data: string } | null;
}

export interface RenderedPage {
  renderer: "kernel" | "chrome";
  finalUrl: string;
  status: number | null;
  /** The DOM after JavaScript ran, serialized. */
  html: string;
  ms: number;
  /** Uncaught exceptions: the app crashed somewhere. */
  pageErrors: string[];
  /** console.error messages (often third-party noise; reported, not failed on). */
  consoleErrors: string[];
  /**
   * Requests that failed, returned 4xx/5xx or never answered: every API call (xhr/fetch, any
   * origin: that's the app's backend), plus the site's own scripts, styles, images and pages.
   */
  failedRequests: { url: string; status: number | null; type: string; reason: string }[];
  /** Requests our SSRF rules refused (local renderer only). */
  blockedRequests: string[];
  mobile: ViewportResult;
  desktop: ViewportResult;
}

export type RenderOutcome = { ok: true; page: RenderedPage } | { ok: false; error: string };

export interface Renderer {
  name: "kernel" | "chrome";
  render(url: string, opts?: { allowLocal?: boolean }): Promise<RenderOutcome>;
}

const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1366, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 VouchReferee/1.0";
const NAV_TIMEOUT_MS = 20_000;
/** Longest we wait, after the network goes quiet, for an app to finish loading its data. */
const SETTLE_MAX_MS = 10_000;

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Analytics and tracking hosts: their failures say nothing about whether the app works. */
const TRACKERS = /(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.(com|net)|segment\.(io|com)|hotjar\.com|plausible\.io|clarity\.ms|mixpanel\.com|sentry\.io|vercel-insights\.com|vitals\.vercel-insights\.com|cloudflareinsights\.com|stats\.wp\.com)$/i;
const isTracker = (u: string) => {
  try {
    return TRACKERS.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

/** Which renderer this server can use, if any. */
export function getRenderer(): Renderer | null {
  const e = env();
  const chrome = e.CHROME_PATH ?? (existsSync(MAC_CHROME) ? MAC_CHROME : null);
  switch (e.RENDERER) {
    case "none":
      return null;
    case "kernel":
      return e.KERNEL_API_KEY ? kernelRenderer(e.KERNEL_API_KEY) : null;
    case "chrome":
      return chrome ? chromeRenderer(chrome) : null;
    case "auto":
      // Kernel when configured; otherwise a local Chrome, but only outside production.
      if (e.KERNEL_API_KEY) return kernelRenderer(e.KERNEL_API_KEY);
      return chrome && e.NODE_ENV !== "production" ? chromeRenderer(chrome) : null;
  }
}

/* ------------------------------------------------------------------ */
/* Shared rendering steps                                               */
/* ------------------------------------------------------------------ */

const sameSite = (a: string, b: string) => {
  try {
    const x = new URL(a).hostname.split(".").slice(-2).join(".");
    const y = new URL(b).hostname.split(".").slice(-2).join(".");
    return x === y;
  } catch {
    return false;
  }
};

async function measure(page: PuppeteerPage, width: number): Promise<ViewportResult> {
  const scrollWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0));
  const shot = await page.screenshot({ type: "jpeg", quality: 60, encoding: "base64" }).catch(() => null);
  return {
    width,
    scrollWidth,
    horizontalOverflow: scrollWidth > width + 2,
    screenshot: shot ? { mimeType: "image/jpeg", data: String(shot) } : null,
  };
}

/** Load the page on a phone, record everything, then resize to desktop. */
async function renderWith(browser: Browser, renderer: "kernel" | "chrome", url: string, guard: ((req: HTTPRequest) => Promise<boolean>) | null): Promise<RenderedPage> {
  const page = await browser.newPage();
  const pageErrors = new Set<string>();
  const consoleErrors = new Set<string>();
  const failed: RenderedPage["failedRequests"] = [];
  const blocked: string[] = [];
  const pendingApi = new Map<HTTPRequest, number>();
  const isApi = (t: string) => t === "xhr" || t === "fetch";
  const counts = (req: HTTPRequest) =>
    !isTracker(req.url()) && (isApi(req.resourceType()) || (sameSite(req.url(), url) && ["script", "stylesheet", "image", "document"].includes(req.resourceType())));
  try {
    page.on("pageerror", (err) => pageErrors.add(String((err as Error)?.message ?? err).slice(0, 200)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.add(msg.text().slice(0, 200));
    });
    page.on("request", (req) => {
      if (isApi(req.resourceType())) pendingApi.set(req, Date.now());
    });
    page.on("requestfinished", (req) => pendingApi.delete(req));
    page.on("requestfailed", (req) => {
      pendingApi.delete(req);
      // Cancelled by the page or browser itself (navigation, beacons): not a server failure.
      if (req.failure()?.errorText === "net::ERR_ABORTED") return;
      if (!counts(req) || blocked.includes(req.url())) return;
      failed.push({ url: req.url().slice(0, 200), status: null, type: req.resourceType(), reason: req.failure()?.errorText ?? "failed" });
    });
    page.on("response", (res) => {
      const req = res.request();
      if (res.status() >= 400 && counts(req) && res.url() !== url) {
        failed.push({ url: res.url().slice(0, 200), status: res.status(), type: req.resourceType(), reason: `HTTP ${res.status()}` });
      }
    });
    if (guard) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        guard(req)
          .then((ok) => {
            if (ok) return req.continue();
            blocked.push(req.url());
            return req.abort("blockedbyclient");
          })
          .catch(() => req.abort("failed").catch(() => undefined));
      });
    }

    await page.setUserAgent(MOBILE_UA);
    await page.setViewport(MOBILE);
    const started = Date.now();
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS }).catch(async (err) => {
      // Busy apps never go network-idle; take what has rendered.
      if (String(err).includes("Timeout")) return null;
      throw err;
    });
    // Data-driven apps show "Loading…" first. Wait until the visible text stops changing and no API
    // call is pending (like a person deciding the page has finished loading), up to a limit.
    const settleUntil = Date.now() + SETTLE_MAX_MS;
    let lastLength = -1;
    let stableTicks = 0;
    while (Date.now() < settleUntil) {
      await new Promise((r) => setTimeout(r, 500));
      const length = await page.evaluate(() => document.body?.innerText.length ?? 0).catch(() => lastLength);
      stableTicks = length === lastLength ? stableTicks + 1 : 0;
      lastLength = length;
      if (stableTicks >= 2 && pendingApi.size === 0) break;
    }
    const ms = Date.now() - started;
    // API calls still waiting now never answered while a visitor watched the page load.
    for (const [req, since] of pendingApi) {
      if (isTracker(req.url())) continue;
      failed.push({ url: req.url().slice(0, 200), status: null, type: req.resourceType(), reason: `no response after ${Math.round((Date.now() - since) / 1000)} s` });
    }
    const mobile = await measure(page, MOBILE.width);

    await page.setViewport(DESKTOP);
    await new Promise((r) => setTimeout(r, 600));
    const desktop = await measure(page, DESKTOP.width);

    return {
      renderer,
      finalUrl: page.url(),
      status: res?.status() ?? null,
      html: await page.content(),
      ms,
      pageErrors: [...pageErrors].slice(0, 10),
      consoleErrors: [...consoleErrors].slice(0, 10),
      failedRequests: failed.slice(0, 15),
      blockedRequests: blocked.slice(0, 15),
      mobile,
      desktop,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* Local Chrome (development)                                          */
/* ------------------------------------------------------------------ */

/** Allow only http(s)/data/blob requests to public addresses (the same rules as our fetcher). */
function ssrfGuard(allowLocal: boolean) {
  const cache = new Map<string, boolean>();
  return async (req: HTTPRequest) => {
    const u = new URL(req.url());
    if (u.protocol === "data:" || u.protocol === "blob:") return true;
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (cache.has(host)) return cache.get(host)!;
    let ok: boolean;
    try {
      const addrs = isIP(host) ? [{ address: host }] : await dnsLookup(host, { all: true });
      ok = addrs.every((a) => !isBlockedAddress(a.address) || (allowLocal && (a.address === "127.0.0.1" || a.address === "::1")));
    } catch {
      // Our lookup failed (often a DNS hiccup): that's not a reason to block. Let the browser try,
      // so a real failure is recorded as one instead of being hidden as "blocked".
      ok = true;
    }
    cache.set(host, ok);
    return ok;
  };
}

function chromeRenderer(executablePath: string): Renderer {
  return {
    name: "chrome",
    async render(url, opts = {}) {
      let browser: Browser | null = null;
      try {
        // QUIC (HTTP/3) fails on some networks (ERR_QUIC_PROTOCOL_ERROR); plain HTTPS works everywhere.
        browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-first-run", "--disable-extensions", "--disable-background-networking", "--disable-quic"] });
        try {
          return { ok: true, page: await renderWith(browser, "chrome", url, ssrfGuard(Boolean(opts.allowLocal))) };
        } catch (err) {
          // One retry for network-level failures (ours or theirs), like the static fetch.
          if (!/net::ERR_/.test(String(err))) throw err;
          await new Promise((r) => setTimeout(r, 1500));
          return { ok: true, page: await renderWith(browser, "chrome", url, ssrfGuard(Boolean(opts.allowLocal))) };
        }
      } catch (err) {
        return { ok: false, error: `The browser couldn't load the page: ${String((err as Error)?.message ?? err).slice(0, 160)}` };
      } finally {
        await browser?.close().catch(() => undefined);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Kernel cloud browsers (deployed)                                    */
/* ------------------------------------------------------------------ */

const KERNEL_API = "https://api.onkernel.com";

function kernelRenderer(apiKey: string): Renderer {
  return {
    name: "kernel",
    async render(url) {
      let sessionId: string | null = null;
      let browser: Browser | null = null;
      try {
        const res = await fetch(`${KERNEL_API}/browsers`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          // Kernel stops an idle browser after timeout_seconds, even if our cleanup below never runs.
          body: JSON.stringify({ headless: true, timeout_seconds: 60 }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await res.json()) as { cdp_ws_url?: string; session_id?: string; message?: string };
        if (!res.ok || !body.cdp_ws_url) return { ok: false, error: `Kernel couldn't start a browser: ${body.message ?? `HTTP ${res.status}`}` };
        sessionId = body.session_id ?? null;
        browser = await puppeteer.connect({ browserWSEndpoint: body.cdp_ws_url });
        // Kernel's browsers run on Kernel's isolated network, not ours.
        return { ok: true, page: await renderWith(browser, "kernel", url, null) };
      } catch (err) {
        return { ok: false, error: `The cloud browser couldn't load the page: ${String((err as Error)?.message ?? err).slice(0, 160)}` };
      } finally {
        await browser?.disconnect().catch(() => undefined);
        if (sessionId) {
          await fetch(`${KERNEL_API}/browsers/${sessionId}`, { method: "DELETE", headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
        }
      }
    },
  };
}
