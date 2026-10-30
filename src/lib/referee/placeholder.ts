/** Text that templates and unfinished sites leave behind. Never real content. */
export const PLACEHOLDER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\blorem ipsum\b/i, label: "Lorem ipsum" },
  { re: /\bdolor sit amet\b/i, label: "dolor sit amet" },
  { re: /\bconsectetur adipiscing\b/i, label: "consectetur adipiscing" },
  // "Your company name here", "Your title here"; not "pick up your coffee here".
  { re: /\byour (?:(?:company|business|brand|site) )?(?:name|title|text|tagline|heading|logo|company|business) here\b/i, label: "“… here” filler" },
  { re: /\b(insert|add) (your )?(text|content|image|title) here\b/i, label: "“insert … here”" },
  { re: /\bplaceholder text\b/i, label: "“placeholder text”" },
  { re: /\bsample (text|content)\b/i, label: "“sample text”" },
  { re: /\bproject name\b/i, label: "“Project Name”" },
];

/** Distinct placeholder phrases found in a piece of text, with a short excerpt for each. */
export function findPlaceholders(text: string): { label: string; excerpt: string }[] {
  const out: { label: string; excerpt: string }[] = [];
  for (const { re, label } of PLACEHOLDER_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const start = Math.max(0, m.index - 20);
    out.push({ label, excerpt: text.slice(start, m.index + m[0].length + 30).replace(/\s+/g, " ").trim() });
  }
  return out;
}

export function looksLikePlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some(({ re }) => re.test(text));
}
