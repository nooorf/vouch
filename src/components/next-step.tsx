import type { ReactNode } from "react";
import { Countdown } from "./countdown";

export interface Step {
  /** Who acts: the viewer ("you"), or someone else they're waiting on. */
  who: "you" | "waiting" | "done";
  title: ReactNode;
  body?: ReactNode;
  /** Jump link to where the action lives on this page (or another page). */
  href?: string;
  cta?: string;
  /** A deadline that matters for this step. */
  endsAt?: string | null;
}

/**
 * The one thing that happens next, always at the top of a job page. Like a signing flow's
 * "Next" arrow: it names the step, who owns it, any deadline, and jumps straight to it.
 */
export function NextStep({ step }: { step: Step }) {
  const tone =
    step.who === "you"
      ? { ring: "border-brand/30 bg-brand-soft/60", dot: "bg-brand", label: "Your next step", labelClass: "text-brand" }
      : step.who === "waiting"
        ? { ring: "border-line bg-surface", dot: "bg-held-fill animate-pulse motion-reduce:animate-none", label: "Waiting on the other side", labelClass: "text-muted" }
        : { ring: "border-line bg-surface", dot: "bg-released-fill", label: "All settled", labelClass: "text-released" };
  return (
    <section aria-label="Next step" className={`flex flex-col gap-4 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${tone.ring}`}>
      <div className="min-w-0">
        <p className={`flex items-center gap-2 text-xs font-medium ${tone.labelClass}`}>
          <span className={`size-2 rounded-full ${tone.dot}`} aria-hidden="true" />
          {tone.label}
          {step.endsAt && (
            <span className="text-muted">
              · <Countdown endsAt={step.endsAt} /> left
            </span>
          )}
        </p>
        <p className="mt-1 text-[15px] font-semibold text-pretty">{step.title}</p>
        {step.body && <p className="mt-0.5 text-sm text-pretty text-muted">{step.body}</p>}
      </div>
      {step.href && step.cta && (
        <a
          href={step.href}
          className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-full px-5 text-sm font-medium transition-colors sm:self-auto ${
            step.who === "you" ? "bg-brand text-brand-ink hover:bg-brand-hover" : "border border-line-strong bg-surface text-ink hover:bg-surface-2"
          }`}
        >
          {step.cta}
          {step.href.startsWith("#") && <span aria-hidden="true">↓</span>}
        </a>
      )}
    </section>
  );
}
