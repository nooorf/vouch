"use client";

import Link from "next/link";
import { useState } from "react";
import { STEPS } from "@/lib/jobs/status";
import { Button } from "./ui";

/** `reached`: index of the last step reached. Reached steps get a ✓; the next one is what we're waiting on. */
export function JobTimeline({ current: reached }: { current: number }) {
  const finished = reached === STEPS.length - 1;
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs sm:text-[13px]">
      {STEPS.map((s, i) => {
        const state = reached < 0 ? "off" : i <= reached ? "done" : i === reached + 1 && !finished ? "now" : "todo";
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span className="flex items-center gap-1.5" aria-current={state === "now" ? "step" : undefined}>
              {state === "done" ? (
                <span className="flex size-4 items-center justify-center rounded-full bg-released-fill text-[9px] font-bold text-white" aria-hidden="true">
                  ✓
                </span>
              ) : state === "now" ? (
                <span className="size-4 rounded-full border-[5px] border-brand bg-surface" aria-hidden="true" />
              ) : (
                <span className="size-4 rounded-full border border-line-strong bg-surface" aria-hidden="true" />
              )}
              <span className={state === "now" ? "font-semibold text-ink" : state === "done" ? "text-ink" : "text-faint"}>{s.label}</span>
            </span>
            {i < STEPS.length - 1 && <span className={`h-px w-4 sm:w-6 ${i < reached ? "bg-released-fill/60" : "bg-line-strong"}`} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1 rounded-full border border-line-strong bg-surface-2 p-1 pl-4">
      <input
        readOnly
        value={url}
        aria-label="Client link"
        onFocus={(e) => e.target.select()}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-muted outline-none"
      />
      <Button
        type="button"
        variant={copied ? "secondary" : "primary"}
        size="sm"
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
  const item = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${on ? "bg-surface text-ink shadow-[0_1px_3px_rgb(16_24_40/0.12)]" : "text-muted hover:text-ink"}`;
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface-2 p-1" role="group" aria-label="Demo view: switch sides">
      <span className="hidden pr-1 pl-3 text-xs text-muted sm:inline">Viewing as</span>
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
