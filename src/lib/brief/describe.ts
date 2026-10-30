import { CHECKS } from "./checks";
import type { Criterion } from "./schema";

const list = (items: unknown) =>
  Array.isArray(items) && items.length ? (items as string[]).map((s) => `“${s}”`).join(", ") : "(none set)";

/** One plain-English line for a criterion, as the client and the evaluation card show it. */
export function describeCriterion(c: Criterion): string {
  if (c.kind === "judged") return c.rubric;
  const p = c.params as Record<string, unknown>;
  switch (c.checkId) {
    case "http_ok":
      return "The page loads over HTTPS in under 5 seconds";
    case "has_h1":
      return "The page has a main heading";
    case "min_sections":
      return `The page has at least ${p.min} content sections`;
    case "viewport_meta":
      return "The page is set up for phone screens (viewport tag)";
    case "responsive_css":
      return "Styles adapt to screen size (media queries or fluid units)";
    case "img_alt_ratio":
      return `At least ${Math.round(Number(p.minRatio) * 100)}% of images have alt text`;
    case "has_form":
      return `A form with the fields ${list(p.fields)}`;
    case "has_text":
      return `The page mentions ${list(p.phrases)}`;
    case "no_placeholder_text":
      return "No leftover placeholder text (Lorem ipsum and the like)";
    case "links_ok":
      return "Internal links work (up to 10 checked)";
    case "no_js_errors":
      return "The app runs without JavaScript errors in a real browser";
    case "no_failed_requests":
      return "Every API call answers and the site's files load";
    case "no_horizontal_scroll":
      return "Nothing spills off the side on a phone";
    case "page_weight":
      return `The HTML is under ${p.maxKb} KB`;
    case "lighthouse_a11y":
      return `Google Lighthouse accessibility score of ${p.min} or more (mobile)`;
    case "lighthouse_perf":
      return `Google Lighthouse performance score of ${p.min} or more (mobile)`;
    case "lighthouse_seo":
      return `Google Lighthouse SEO score of ${p.min} or more`;
    case "repo_readme":
      return "The GitHub repo has a README with real content";
    case "repo_fresh_commits":
      return "The GitHub repo has new commits made after funding";
    case "ci_passing":
      return "The latest GitHub Actions run passed";
    default:
      return CHECKS[c.checkId as keyof typeof CHECKS]?.label ?? c.checkId;
  }
}
