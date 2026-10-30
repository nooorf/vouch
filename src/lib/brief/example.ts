/**
 * The "Use the coffee roastery example" job. Shared by the New job form and
 * scripts/warm-ai-cache.ts, so the demo's AI draft is served from cache: same text, same answer.
 */
export const EXAMPLE_JOB = {
  description:
    "One-page marketing website for Ember & Oak, a small specialty coffee roastery. It needs their story, where their single-origin beans come from, a wholesale section for cafes, and a contact form (name, email, message). It must work well on phones and be accessible. I'll host it on GitHub Pages from a public repo.",
  priceUsd: "400",
  deadlineDays: "14",
  clientName: "Ember & Oak Coffee Roasters",
  clientEmail: "",
} as const;
