import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import puppeteer, { type Browser, type HTTPRequest, type Page as PuppeteerPage } from "puppeteer-core";
import { getDomain } from "tldts";
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
  /** Width the page was laid out at. Wider than the screen means a desktop layout shrunk to fit. */
  layoutWidth: number;
  /** How far a visitor can scroll sideways (0 when everything fits). */
  sidewaysScroll: number;
  /** Doesn't fit: laid out wider than the screen, or scrolls sideways. */
  horizontalOverflow: boolean;
  /** The elements that stick out past the right edge, outermost first (for evidence). */
  offenders: { what: string; right: number }[];
  screenshot: { mimeType: string; data: string } | null;
}

export interface RenderedPage {
  renderer: "kernel" | "chrome";
  finalUrl: string;
  status: number | null;
  /** The DOM after JavaScript ran, serialized. */
  html: string;
  /** The text the browser actually shows (CSS applied; closed <details> opened first). */
  visibleText: string;
  /**
   * Text in the page that a visitor can't see: hidden by CSS (classes included), shrunk to
   * nothing or placed off screen. Scanned for instructions aimed at the AI judge.
   */
  hiddenText: string[];
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
/** The desktop tab loads a page we've already seen settle, so it gets less time. */
const DESKTOP_SETTLE_MAX_MS = 5_000;

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

/** Same site: same registrable domain (api.shop.co.uk ~ www.shop.co.uk; alice.github.io ≁ bob.github.io). */
const sameSite = (a: string, b: string) => {
  try {
    const [x, y] = [new URL(a).hostname, new URL(b).hostname];
    if (x === y) return true;
    const dx = getDomain(x, { allowPrivateDomains: true });
    return dx !== null && dx === getDomain(y, { allowPrivateDomains: true });
  } catch {
    return false;
  }
};

/**
 * Does the page fit the screen? Measured the way a visitor would notice: the layout is wider than
 * the screen (a desktop page shrunk to fit), or content reaches past the right edge so the page
 * pans sideways. Content a site deliberately clips (overflow-x: hidden, off-canvas menus) doesn't
 * widen the page, so it doesn't count.
 *
 * (Under phone emulation Chrome widens the layout to fit wide content instead of letting script
 * scroll it, so we compare the document's scroll width with the layout width rather than
 * scrolling; window.innerWidth also grows for clipped content, so it isn't used.)
 */
async function measure(page: PuppeteerPage, width: number): Promise<ViewportResult> {
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const layoutWidth = doc.clientWidth;
    const sidewaysScroll = Math.max(0, doc.scrollWidth - layoutWidth);
    // Outermost elements that reach past the right edge: the cause, not every descendant.
    const offenders: { what: string; right: number }[] = [];
    if (sidewaysScroll > 2) {
      for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= layoutWidth + 2) continue;
        const parent = el.parentElement;
        if (parent && parent !== document.body && parent.getBoundingClientRect().right > layoutWidth + 2) continue;
        const tag = el.tagName.toLowerCase();
        const src = el.getAttribute("src")?.split("/").pop()?.split("?")[0];
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
        offenders.push({ what: src && !src.startsWith("data:") ? `${tag} ${src}` : cls ? `${tag}.${cls}` : text ? `${tag} “${text}”` : tag, right: Math.round(r.right) });
        if (offenders.length >= 3) break;
      }
    }
    return { layoutWidth, sidewaysScroll, offenders };
  });
  const shot = await page.screenshot({ type: "jpeg", quality: 60, encoding: "base64" }).catch(() => null);
  return {
    width,
    ...m,
    horizontalOverflow: m.layoutWidth > width + 2 || m.sidewaysScroll > 2,
    screenshot: shot ? { mimeType: "image/jpeg", data: String(shot) } : null,
  };
}

/** What a visitor can read, and what's in the page but hidden from them. */
async function readText(page: PuppeteerPage): Promise<{ visibleText: string; hiddenText: string[] }> {
  return page.evaluate(() => {
    // Native "click to open" sections are content a visitor can reach.
    document.querySelectorAll("details:not([open])").forEach((d) => d.setAttribute("open", ""));
    const visibleText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
    const hiddenText: string[] = [];
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "PATH"]);
    const pageWidth = document.documentElement.scrollWidth;
    for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
      if (skip.has(el.tagName.toUpperCase())) continue;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (own.length < 12) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const invisible =
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ||
        r.width <= 1 ||
        r.height <= 1 ||
        r.right <= 0 ||
        r.bottom <= -window.scrollY ||
        r.left >= pageWidth ||
        parseFloat(style.fontSize) < 2;
      if (invisible) hiddenText.push(own.slice(0, 400));
      if (hiddenText.length >= 200) break;
    }
    return { visibleText, hiddenText };
  });
}

type Guard = ((req: HTTPRequest) => Promise<boolean>) | null;

/** A tab whose every request passes our SSRF rules (local renderer). */
async function openTab(browser: Browser, guard: Guard, blocked: string[]): Promise<PuppeteerPage> {
  const page = await browser.newPage();
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
  return page;
}

/**
 * Navigate, then wait like a person deciding the page has finished loading: data-driven apps show
 * "Loading…" first, so wait until the visible text stops changing and no API call is pending.
 */
async function loadAndSettle(page: PuppeteerPage, url: string, maxSettleMs: number, pendingApi?: Map<HTTPRequest, number>) {
  const res = await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS }).catch(async (err) => {
    // Busy apps never go network-idle; take what has rendered.
    if (String(err).includes("Timeout")) return null;
    throw err;
  });
  const settleUntil = Date.now() + maxSettleMs;
  let lastLength = -1;
  let stableTicks = 0;
  while (Date.now() < settleUntil) {
    await new Promise((r) => setTimeout(r, 500));
    const length = await page.evaluate(() => document.body?.innerText.length ?? 0).catch(() => lastLength);
    stableTicks = length === lastLength ? stableTicks + 1 : 0;
    lastLength = length;
    if (stableTicks >= 2 && (pendingApi?.size ?? 0) === 0) break;
  }
  return res;
}

/**
 * Load the page on a phone and record everything (errors, requests, layout, screenshot), then load
 * it again in a separate desktop tab for the desktop layout and the content. Two tabs, because
 * switching one tab between phone and desktop emulation reloads the page.
 */
async function renderWith(browser: Browser, renderer: "kernel" | "chrome", url: string, guard: Guard): Promise<RenderedPage> {
  const pageErrors = new Set<string>();
  const consoleErrors = new Set<string>();
  const failed: RenderedPage["failedRequests"] = [];
  const blocked: string[] = [];
  const pendingApi = new Map<HTTPRequest, number>();
  const isApi = (t: string) => t === "xhr" || t === "fetch";
  const counts = (req: HTTPRequest) =>
    !isTracker(req.url()) && (isApi(req.resourceType()) || (sameSite(req.url(), url) && ["script", "stylesheet", "image", "document"].includes(req.resourceType())));

  const phone = await openTab(browser, guard, blocked);
  let desktopTab: PuppeteerPage | null = null;
  try {
    phone.on("pageerror", (err) => pageErrors.add(String((err as Error)?.message ?? err).slice(0, 200)));
    phone.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.add(msg.text().slice(0, 200));
    });
    phone.on("request", (req) => {
      if (isApi(req.resourceType())) pendingApi.set(req, Date.now());
    });
    phone.on("requestfinished", (req) => pendingApi.delete(req));
    phone.on("requestfailed", (req) => {
      pendingApi.delete(req);
      // Cancelled by the page or browser itself (navigation, beacons): not a server failure.
      if (req.failure()?.errorText === "net::ERR_ABORTED") return;
      if (!counts(req) || blocked.includes(req.url())) return;
      failed.push({ url: req.url().slice(0, 200), status: null, type: req.resourceType(), reason: req.failure()?.errorText ?? "failed" });
    });
    phone.on("response", (res) => {
      const req = res.request();
      if (res.status() >= 400 && counts(req) && res.url() !== url) {
        failed.push({ url: res.url().slice(0, 200), status: res.status(), type: req.resourceType(), reason: `HTTP ${res.status()}` });
      }
    });

    await phone.setUserAgent(MOBILE_UA);
    await phone.setViewport(MOBILE);
    const started = Date.now();
    const res = await loadAndSettle(phone, url, SETTLE_MAX_MS, pendingApi);
    const ms = Date.now() - started;
    // API calls still waiting now never answered while a visitor watched the page load.
    for (const [req, since] of pendingApi) {
      if (isTracker(req.url())) continue;
      failed.push({ url: req.url().slice(0, 200), status: null, type: req.resourceType(), reason: `no response after ${Math.round((Date.now() - since) / 1000)} s` });
    }
    const mobile = await measure(phone, MOBILE.width);
    const finalUrl = phone.url();
    let html = await phone.content();
    let text = await readText(phone);

    // Desktop: its own tab. Sites show the most here (no collapsed phone menus), so when it loads,
    // its DOM and text are what the checks and the judge read.
    let desktop: ViewportResult = { ...mobile, width: DESKTOP.width, layoutWidth: 0, sidewaysScroll: 0, horizontalOverflow: false, offenders: [], screenshot: null };
    try {
      desktopTab = await openTab(browser, guard, blocked);
      await desktopTab.setViewport(DESKTOP);
      await loadAndSettle(desktopTab, finalUrl, DESKTOP_SETTLE_MAX_MS);
      desktop = await measure(desktopTab, DESKTOP.width);
      const desktopText = await readText(desktopTab);
      if (desktopText.visibleText.length >= text.visibleText.length * 0.8) {
        text = desktopText;
        html = await desktopTab.content();
      }
    } catch {
      // The phone load already succeeded; a failed desktop load only loses the desktop layout.
    }

    return {
      renderer,
      finalUrl,
      status: res?.status() ?? null,
      html,
      visibleText: text.visibleText,
      hiddenText: text.hiddenText,
      ms,
      pageErrors: [...pageErrors].slice(0, 10),
      consoleErrors: [...consoleErrors].slice(0, 10),
      failedRequests: dedupe(failed).slice(0, 15),
      blockedRequests: [...new Set(blocked)].slice(0, 15),
      mobile,
      desktop,
    };
  } finally {
    await phone.close().catch(() => undefined);
    await desktopTab?.close().catch(() => undefined);
  }
}

const dedupe = (list: RenderedPage["failedRequests"]) => list.filter((f, i) => list.findIndex((g) => g.url === f.url && g.reason === f.reason) === i);

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

export function chromeRenderer(executablePath: string): Renderer {
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
          body: JSON.stringify({ headless: true, timeout_seconds: 120 }),
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
