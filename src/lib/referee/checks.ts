import type { CheckId } from "@/lib/brief/checks";
import type { RepoOutcome } from "./github";
import { fold, type Page } from "./page";
import type { PageSpeedOutcome } from "./pagespeed";

/**
 * The measured checks. Each one reads facts (the fetched page, Lighthouse, GitHub) and returns
 * pass, fail or error with a sentence of evidence a person can verify. No AI involved.
 */

export interface CheckOutcome {
  status: "pass" | "fail" | "error";
  evidence: string;
  measured?: Record<string, unknown>;
}

export interface CheckContext {
  /** null when the page itself couldn't be fetched. */
  page: Page | null;
  fetchError?: string;
  /** Fetch a linked stylesheet or page (already SSRF-safe). Returns status and body. */
  fetchUrl: (url: string, method?: "GET" | "HEAD") => Promise<{ status: number; body: string }>;
  pagespeed: () => Promise<PageSpeedOutcome>;
  repo: () => Promise<RepoOutcome | null>;
  /** Allow plain http (local development only). */
  allowHttp?: boolean;
}

const pass = (evidence: string, measured?: Record<string, unknown>): CheckOutcome => ({ status: "pass", evidence, measured });
const fail = (evidence: string, measured?: Record<string, unknown>): CheckOutcome => ({ status: "fail", evidence, measured });
const error = (evidence: string): CheckOutcome => ({ status: "error", evidence });

const quote = (s: string) => `“${s.length > 60 ? `${s.slice(0, 57)}…` : s}”`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------------- page checks ---------------- */

function httpOk(ctx: CheckContext): CheckOutcome {
  const p = ctx.page;
  if (!p) return fail(ctx.fetchError ?? "The page couldn't be loaded.");
  const https = p.finalUrl.startsWith("https://") || (ctx.allowHttp ?? false);
  const measured = { status: p.status, ms: p.ms, https: p.finalUrl.startsWith("https://") };
  if (p.status !== 200) return fail(`The page returned HTTP ${p.status}.`, measured);
  if (!https) return fail("The page isn't served over HTTPS.", measured);
  if (p.ms > 5000) return fail(`The page took ${(p.ms / 1000).toFixed(1)} s to load (limit 5 s).`, measured);
  return pass(`HTTP 200${p.finalUrl.startsWith("https://") ? " over HTTPS" : ""} in ${p.ms} ms.`, measured);
}

function hasH1(page: Page): CheckOutcome {
  const h1s = page.$("h1")
    .map((_, el) => page.$(el).text().trim())
    .get();
  if (h1s.length === 1) return pass(`One main heading: ${quote(h1s[0])}.`, { count: 1 });
  if (h1s.length === 0) return fail("The page has no main heading (h1).", { count: 0 });
  return fail(`The page has ${h1s.length} main headings: ${h1s.slice(0, 3).map(quote).join(", ")}.`, { count: h1s.length });
}

function minSections(page: Page, min: number): CheckOutcome {
  const sections = page.$("section").length;
  const h2 = page.$("h2").length;
  const count = Math.max(sections, h2);
  const measured = { sections, h2, count, min };
  return count >= min ? pass(`${plural(count, "content section")} found (needs ${min}).`, measured) : fail(`Only ${plural(count, "content section")} found (needs ${min}).`, measured);
}

function viewportMeta(page: Page): CheckOutcome {
  const content = page.$('meta[name="viewport"]').attr("content");
  if (!content) return fail("No viewport meta tag, so phones show a zoomed-out desktop page.");
  if (!/width\s*=\s*device-width/i.test(content)) return fail(`Viewport tag doesn't use device width: ${quote(content)}.`);
  return pass(`Viewport tag: ${quote(content)}.`);
}

async function responsiveCss(page: Page, ctx: CheckContext): Promise<CheckOutcome> {
  const sources: { name: string; css: string }[] = [];
  page.$("style").each((_, el) => {
    sources.push({ name: "inline styles", css: page.$(el).text() });
  });
  const links = page.$('link[rel~="stylesheet"][href]')
    .map((_, el) => page.$(el).attr("href")!)
    .get()
    .slice(0, 5);
  for (const href of links) {
    try {
      const url = new URL(href, page.finalUrl).toString();
      const res = await ctx.fetchUrl(url);
      if (res.status === 200) sources.push({ name: new URL(url).pathname.split("/").pop() || url, css: res.body });
    } catch {
      // An unreachable stylesheet just doesn't count.
    }
  }
  for (const s of sources) {
    const queries = s.css.match(/@media[^{]*\((?:max|min)-width/gi)?.length ?? 0;
    if (queries > 0) return pass(`${plural(queries, "screen-size media query", "screen-size media queries")} in ${s.name}.`, { mediaQueries: queries });
  }
  for (const s of sources) {
    const layout = /display\s*:\s*(flex|grid)/i.test(s.css);
    const fluid = /(\d(\.\d+)?(vw|fr)\b|clamp\(|minmax\(|auto-fit|auto-fill)/i.test(s.css);
    if (layout && fluid) return pass(`Fluid layout (flex/grid with relative sizes) in ${s.name}.`);
  }
  for (const s of sources) {
    // A single column capped in relative units shrinks with the screen (e.g. max-width: 26em; margin: auto).
    const capped = s.css.match(/max-width\s*:\s*\d+(\.\d+)?(em|rem|ch|%|vw)\b/i);
    if (capped) return pass(`Fluid single-column layout (${capped[0].replace(/\s+/g, " ")}) in ${s.name}.`);
  }
  return fail(sources.length ? "No media queries or fluid layout found in the styles." : "No styles found on the page.");
}

function imgAltRatio(page: Page, minRatio: number): CheckOutcome {
  const imgs = page.$("img");
  const total = imgs.length;
  if (total === 0) return pass("The page has no images.", { total: 0 });
  const withAlt = imgs.filter((_, el) => page.$(el).attr("alt") !== undefined).length;
  const ratio = withAlt / total;
  const missing = imgs
    .filter((_, el) => page.$(el).attr("alt") === undefined)
    .map((_, el) => page.$(el).attr("src") ?? "?")
    .get()
    .slice(0, 3);
  const measured = { total, withAlt, ratio };
  const line = `${withAlt} of ${plural(total, "image")} have alt text (${Math.round(ratio * 100)}%, needs ${Math.round(minRatio * 100)}%)`;
  return ratio >= minRatio ? pass(`${line}.`, measured) : fail(`${line}. Missing on ${missing.map((m) => quote(m.split("/").pop()!)).join(", ")}.`, measured);
}

function hasForm(page: Page, fields: string[]): CheckOutcome {
  const forms = page.$("form");
  if (forms.length === 0) return fail("The page has no form.");
  let best: { found: string[]; missing: string[] } | null = null;
  forms.each((_, form) => {
    const controls = page.$(form).find("input, textarea, select");
    const haystack = controls
      .map((_, c) => {
        const el = page.$(c);
        const id = el.attr("id");
        const label = id ? page.$(`label[for="${id}"]`).text() : "";
        return fold([el.attr("name"), id, el.attr("type"), el.attr("placeholder"), el.attr("aria-label"), el.attr("autocomplete"), label].filter(Boolean).join(" "));
      })
      .get()
      .join(" | ");
    const found = fields.filter((f) => haystack.includes(fold(f)));
    const missing = fields.filter((f) => !found.includes(f));
    if (!best || found.length > best.found.length) best = { found, missing };
  });
  const b = best!;
  if (b.missing.length === 0) return pass(`A form with ${b.found.map(quote).join(", ")}.`, b);
  return fail(`The form is missing ${b.missing.map(quote).join(", ")}${b.found.length ? ` (found ${b.found.map(quote).join(", ")})` : ""}.`, b);
}

function hasText(page: Page, phrases: string[]): CheckOutcome {
  if (!phrases.length) return error("No phrases were set for this check.");
  const text = fold(page.visibleText);
  const missing = phrases.filter((p) => !text.includes(fold(p)));
  if (missing.length === 0) return pass(`The page mentions ${phrases.map(quote).join(", ")}.`, { missing: [] });
  return fail(`Missing from the visible text: ${missing.map(quote).join(", ")}.`, { missing });
}

async function linksOk(page: Page, ctx: CheckContext): Promise<CheckOutcome> {
  const base = new URL(page.finalUrl);
  const urls = new Set<string>();
  page.$("a[href]").each((_, el) => {
    const href = page.$(el).attr("href")!.trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    try {
      const u = new URL(href, base);
      if (u.host !== base.host || !/^https?:$/.test(u.protocol)) return;
      u.hash = "";
      if (u.toString() !== base.toString()) urls.add(u.toString());
    } catch {
      // ignore malformed hrefs
    }
  });
  const list = [...urls].slice(0, 10);
  if (list.length === 0) return pass("No other internal pages are linked.", { checked: 0 });
  const broken: string[] = [];
  for (const u of list) {
    try {
      let res = await ctx.fetchUrl(u, "HEAD");
      if (res.status === 405 || res.status === 501) res = await ctx.fetchUrl(u, "GET");
      if (res.status >= 400) broken.push(`${new URL(u).pathname} (${res.status})`);
    } catch {
      broken.push(`${new URL(u).pathname} (unreachable)`);
    }
  }
  const measured = { checked: list.length, broken };
  const ok = list.length - broken.length;
  return broken.length === 0 ? pass(list.length === 1 ? "The internal link works." : `All ${list.length} internal links work.`, measured) : fail(`${ok} of ${plural(list.length, "internal link")} work. Broken: ${broken.slice(0, 3).join(", ")}.`, measured);
}

function pageWeight(page: Page, maxKb: number): CheckOutcome {
  const kb = Math.ceil(page.bytes / 1024);
  return kb <= maxKb ? pass(`The HTML is ${kb} KB (limit ${maxKb} KB).`, { kb }) : fail(`The HTML is ${kb} KB, over the ${maxKb} KB limit.`, { kb });
}

/* ---------------- Lighthouse ---------------- */

async function lighthouse(ctx: CheckContext, category: "accessibility" | "performance" | "seo", min: number): Promise<CheckOutcome> {
  const r = await ctx.pagespeed();
  if (!r.ok) return error(`Lighthouse couldn't run: ${r.error.replace(/\.$/, "")}.`);
  const score = r.scores[category];
  if (score === null) return error(`Lighthouse didn't report a ${category} score.`);
  const name = category === "seo" ? "SEO" : category;
  const issues = category === "accessibility" && r.a11yIssues.length ? ` Top issues: ${r.a11yIssues.slice(0, 3).join("; ")}.` : "";
  return score >= min ? pass(`Lighthouse ${name} score ${score} (needs ${min}).`, { score }) : fail(`Lighthouse ${name} score ${score}, below ${min}.${issues}`, { score });
}

/* ---------------- GitHub ---------------- */

async function repoCheck(ctx: CheckContext, id: "repo_readme" | "repo_fresh_commits" | "ci_passing"): Promise<CheckOutcome> {
  const r = await ctx.repo();
  if (!r) return fail("No GitHub repository was submitted.");
  if (!r.ok) return error(r.error);
  if (id === "repo_readme") {
    if (!r.readme) return fail(`${r.fullName} has no README.`);
    return r.readme.words >= 50 ? pass(`README has ${r.readme.words} words.`, r.readme) : fail(`README has only ${r.readme.words} words (needs 50).`, r.readme);
  }
  if (id === "repo_fresh_commits") {
    return r.commitsSince > 0
      ? pass(`${plural(r.commitsSince, "commit")} since the job was funded.`, { commits: r.commitsSince })
      : fail("No commits since the job was funded.", { commits: 0 });
  }
  if (!r.latestRun) return fail(`No GitHub Actions runs on ${r.defaultBranch}.`);
  if (r.latestRun.status !== "completed") return error(`The latest run (${r.latestRun.name}) is still ${r.latestRun.status}.`);
  return r.latestRun.conclusion === "success"
    ? pass(`Latest run “${r.latestRun.name}” on ${r.defaultBranch} passed.`, r.latestRun)
    : fail(`Latest run “${r.latestRun.name}” on ${r.defaultBranch} ended: ${r.latestRun.conclusion}.`, r.latestRun);
}

/* ---------------- dispatcher ---------------- */

export async function runCheck(checkId: CheckId, params: Record<string, unknown>, ctx: CheckContext): Promise<CheckOutcome> {
  if (checkId === "http_ok") return httpOk(ctx);
  if (checkId === "lighthouse_a11y") return lighthouse(ctx, "accessibility", Number(params.min));
  if (checkId === "lighthouse_perf") return lighthouse(ctx, "performance", Number(params.min));
  if (checkId === "lighthouse_seo") return lighthouse(ctx, "seo", Number(params.min));
  if (checkId === "repo_readme" || checkId === "repo_fresh_commits" || checkId === "ci_passing") return repoCheck(ctx, checkId);

  const page = ctx.page;
  if (!page) return fail(`Not checked: ${(ctx.fetchError ?? "the page couldn't be loaded").replace(/\.$/, "")}.`);
  switch (checkId) {
    case "has_h1":
      return hasH1(page);
    case "min_sections":
      return minSections(page, Number(params.min));
    case "viewport_meta":
      return viewportMeta(page);
    case "responsive_css":
      return responsiveCss(page, ctx);
    case "img_alt_ratio":
      return imgAltRatio(page, Number(params.minRatio ?? 0.9));
    case "has_form":
      return hasForm(page, (params.fields as string[]) ?? []);
    case "has_text":
      return hasText(page, (params.phrases as string[]) ?? []);
    case "links_ok":
      return linksOk(page, ctx);
    case "page_weight":
      return pageWeight(page, Number(params.maxKb));
  }
}
