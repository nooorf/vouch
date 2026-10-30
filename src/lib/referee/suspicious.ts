import type { Page } from "./page";
import { isHidden, normalizeText } from "./page";

/**
 * Looks for content aimed at an AI grader: instructions hidden in comments, hidden elements,
 * alt text or metadata, or visible text that addresses "the AI". Any hit sends the delivery to a
 * human (NEEDS_HUMAN), and the AI judge never sees the page as anything but data.
 */

export interface Finding {
  where: "comment" | "hidden element" | "visible text" | "attribute";
  excerpt: string;
}

const DIRECTIVES = [
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|all|earlier|your)\b[^.]{0,30}\b(instructions?|rules?|prompts?|criteria|guidelines)\b/i,
  /\b(ai|llm|language model|grader|judge|evaluator|reviewer|assistant|model|gpt|gemini|claude)\b[^.]{0,80}\b(approve|pass(ed)?|mark|score|rate|award|release|full (payment|marks|score)|confidence)\b/i,
  /\bsystem (prompt|note|message|instruction)\b/i,
  /\byou are (now )?(an? |the )?(ai|assistant|grader|judge|evaluator)\b/i,
  /\b(mark|treat|consider)\b[^.]{0,30}\b(every|all|each)\b[^.]{0,20}\b(criteri(a|on)|checks?)\b[^.]{0,20}\b(pass|passed|met|satisfied)\b/i,
];

/**
 * Extra patterns for content nobody is meant to see (comments, hidden elements, attributes).
 * Hidden text has no honest reason to talk about payments or criteria, so these can be stricter.
 */
const HIDDEN_ONLY = [
  /\b(approve|release|pay)\b[^.]{0,30}\b(full|entire|whole|complete)?\s*(payment|funds|money|milestone)\b/i,
  /\b(meets|satisfies|passes)\b[^.]{0,30}\b(every|all|each)\b[^.]{0,30}\b(acceptance )?(criteri(a|on)|requirements?|checks?)\b/i,
  /\b(ai|llm|grader|judge|evaluator|reviewer|assistant)\b\s*:/i,
];

const looksLikeDirective = (text: string, hidden = false) =>
  DIRECTIVES.some((re) => re.test(text)) || (hidden && HIDDEN_ONLY.some((re) => re.test(text)));
const clip = (s: string) => (s.length > 220 ? `${s.slice(0, 217)}…` : s);

export function findSuspicious(page: Page): { flagged: boolean; findings: Finding[] } {
  const { $, html } = page;
  const findings: Finding[] = [];

  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) {
    const text = normalizeText(m[1]);
    if (text && looksLikeDirective(text, true)) findings.push({ where: "comment", excerpt: clip(text) });
  }

  $("body *").each((_, el) => {
    if (!isHidden($, el)) return;
    const text = normalizeText($(el).text());
    if (text && looksLikeDirective(text, true)) findings.push({ where: "hidden element", excerpt: clip(text) });
  });

  $("[alt], [title], [aria-label], meta[content]").each((_, el) => {
    for (const attr of ["alt", "title", "aria-label", "content"]) {
      const v = $(el).attr(attr);
      if (v && looksLikeDirective(v, true)) findings.push({ where: "attribute", excerpt: clip(`${attr}="${normalizeText(v)}"`) });
    }
  });

  // Visible text, sentence by sentence, so one long page doesn't match across unrelated words.
  for (const sentence of page.visibleText.split(/(?<=[.!?])\s+/)) {
    if (looksLikeDirective(sentence)) findings.push({ where: "visible text", excerpt: clip(sentence) });
  }

  // The same directive can show up via several routes; keep one of each.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = f.excerpt.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { flagged: unique.length > 0, findings: unique };
}
