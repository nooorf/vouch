"use client";

import Link from "next/link";
import { useState } from "react";
import { STEPS } from "@/lib/jobs/status";
import { Button } from "./ui";

/** `reached`: index of the last step reached. Reached steps get a ✓; the next one is what we're waiting on. */
export function JobTimeline({ current: reached }: { current: number }) {
  const finished = reached === STEPS.length - 1;
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 text-xs sm:text-sm">
      {STEPS.map((s, i) => {
        const state = reached < 0 ? "off" : i <= reached ? "done" : i === reached + 1 && !finished ? "now" : "todo";
        return (
          <li key={s.key} className="flex items-center gap-1">
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
                state === "done" ? "bg-brand-soft text-brand" : state === "now" ? "bg-ink text-bg" : "bg-surface-2 text-muted"
              }`}
              aria-current={state === "now" ? "step" : undefined}
            >
              {state === "done" && <span aria-hidden="true">✓</span>}
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-muted/50" aria-hidden="true">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={url}
        aria-label="Client link"
        onFocus={(e) => e.target.select()}
        className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-muted"
      />
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Demo only: hop between the freelancer's job page and the client's link. */
export function ViewSwitcher({ active, freelancerHref, clientHref }: { active: "freelancer" | "client"; freelancerHref: string; clientHref: string | null }) {
  const item = (on: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${on ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`;
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-1" role="group" aria-label="Demo view">
      <span className="pl-2 text-xs font-medium uppercase tracking-wide text-muted">Demo view</span>
      <Link href={freelancerHref} className={item(active === "freelancer")} aria-current={active === "freelancer" ? "page" : undefined}>
        Freelancer
      </Link>
      {clientHref ? (
        <Link href={clientHref} className={item(active === "client")} aria-current={active === "client" ? "page" : undefined}>
          Client
        </Link>
      ) : (
        <span className={`${item(false)} cursor-not-allowed opacity-50`} title="Send the brief to create the client link">
          Client
        </span>
      )}
    </div>
  );
}
