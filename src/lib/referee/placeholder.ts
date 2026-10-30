import { fold } from "./page";

/**
 * Text that templates and unfinished sites leave behind. Two kinds:
 * - phrases that are never real content anywhere ("Lorem ipsum", "Your company name here");
 * - template headings that are real words elsewhere ("Project Name" is a heading in a template,
 *   but a legitimate label in a project-management app), so they only count as a whole heading.
 */
export const PLACEHOLDER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\blorem ipsum\b/i, label: "Lorem ipsum" },
  { re: /\bdolor sit amet\b/i, label: "dolor sit amet" },
  { re: /\bconsectetur adipiscing\b/i, label: "consectetur adipiscing" },
  // "Your company name here", "Your title here"; not "pick up your coffee here".
  { re: /\byour (?:(?:company|business|brand|site) )?(?:name|title|text|tagline|heading|logo|company|business) here\b/i, label: "“… here” filler" },
  { re: /\b(insert|add) (your )?(text|content|image|title) here\b/i, label: "“insert … here”" },
];

const TEMPLATE_HEADINGS = ["project name", "company name", "your name", "page title", "section heading", "section title", "section subheading", "sample text", "placeholder text", "headline here"];

/** Distinct placeholder phrases found in the text (and among the headings), with an excerpt for each. */
export function findPlaceholders(text: string, headings: string[] = []): { label: string; excerpt: string }[] {
  const out: { label: string; excerpt: string }[] = [];
  for (const { re, label } of PLACEHOLDER_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const start = Math.max(0, m.index - 20);
    out.push({ label, excerpt: text.slice(start, m.index + m[0].length + 30).replace(/\s+/g, " ").trim() });
  }
  for (const h of headings) {
    const t = fold(h).replace(/[.:!]+$/, "");
    if (TEMPLATE_HEADINGS.includes(t) && !out.some((o) => o.label === `heading “${h.trim()}”`)) out.push({ label: `heading “${h.trim()}”`, excerpt: h.trim() });
  }
  return out;
}

export function looksLikePlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some(({ re }) => re.test(text)) || TEMPLATE_HEADINGS.includes(fold(text).replace(/[.:!]+$/, ""));
}
