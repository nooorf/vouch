import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

/** A fetched page, parsed once and shared by every check. */
export interface Page {
  url: string;
  finalUrl: string;
  status: number;
  ms: number;
  bytes: number;
  truncated: boolean;
  html: string;
  $: CheerioAPI;
  /** Text a visitor can actually see (hidden elements, scripts and styles removed). */
  visibleText: string;
  title: string;
}

const HIDDEN_STYLE = /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d]))/i;

export function isHidden($: CheerioAPI, el: Parameters<CheerioAPI>[0]): boolean {
  const node = $(el);
  return node.is("[hidden]") || node.attr("aria-hidden") === "true" || HIDDEN_STYLE.test(node.attr("style") ?? "");
}

export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Lowercase, strip accents, collapse whitespace: "Café  Hackney" → "cafe hackney". */
export function fold(s: string): string {
  return normalizeText(s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase());
}

export function parsePage(input: Omit<Page, "$" | "visibleText" | "title">): Page {
  const $ = cheerio.load(input.html);
  const visible = cheerio.load(input.html);
  visible("script, style, noscript, template, head").remove();
  visible("*")
    .filter((_, el) => isHidden(visible, el))
    .remove();
  // Block elements end a line of text: without this, "<h3>Huila</h3><p>Red apple</p>" reads "HuilaRed apple".
  visible("br").replaceWith(" ");
  visible("p, div, h1, h2, h3, h4, h5, h6, li, dt, dd, section, article, header, footer, nav, main, aside, blockquote, figcaption, td, th, label, button, option").append(" ");
  return {
    ...input,
    $,
    visibleText: normalizeText(visible("body").text()),
    title: normalizeText($("title").first().text()),
  };
}
