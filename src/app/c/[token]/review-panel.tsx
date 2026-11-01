"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideMilestone, disputeMilestone } from "@/app/actions/settlement";
import { Button, Callout, Card, fieldClass } from "@/components/ui";

export interface ChoiceView {
  choice: string;
  label: string;
  hint: string;
  primary?: boolean;
}

/**
 * The client's decision on a milestone. With one option it's a single, clearly-labelled button.
 * With several, the client picks one, sees exactly what it does, then confirms: money moves only
 * on that second, deliberate click.
 */
export function ReviewPanel({
  token,
  milestoneId,
  position,
  choices,
  dispute,
}: {
  token: string;
  milestoneId: string;
  position: number;
  choices: ChoiceView[];
  /** Criteria the client can dispute, when a dispute is still possible. */
  dispute: { id: string; label: string; passed: boolean }[] | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"choose" | "dispute">("choose");
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });

  const chosen = choices.find((c) => c.choice === selected);

  return (
    <Card id={`decide-${position}`} className="scroll-mt-24 border-brand/30 p-5 shadow-raised sm:p-6">
      <p className="flex items-center gap-2 text-xs font-medium text-brand">
        <span className="size-2 rounded-full bg-brand" aria-hidden="true" />
        Your decision
      </p>
      <h3 className="mt-1 text-lg font-semibold">
        {mode === "choose" ? `What should happen with M${position}?` : `Dispute M${position}'s result`}
      </h3>
      {error && (
        <Callout tone="danger" role="alert" className="mt-4">
          {error}
        </Callout>
      )}

      {mode === "choose" ? (
        <div className="mt-4">
          {choices.length === 1 ? (
            <div>
              <p className="text-sm text-pretty text-muted">{choices[0].hint}</p>
              <Button
                type="button"
                size="lg"
                className="mt-4 w-full"
                disabled={pending}
                onClick={() => run(() => decideMilestone(token, milestoneId, choices[0].choice))}
              >
                {pending ? "Working with PayPal…" : choices[0].label}
              </Button>
            </div>
          ) : (
            <fieldset disabled={pending}>
              <legend className="sr-only">Choose what happens with M{position}</legend>
              <div className="space-y-2">
                {choices.map((c) => {
                  const on = selected === c.choice;
                  return (
                    <label
                      key={c.choice}
                      className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 transition-colors ${
                        on ? "border-brand bg-brand-soft/50" : "border-line hover:border-line-strong hover:bg-surface-2/60"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`choice-${milestoneId}`}
                        value={c.choice}
                        checked={on}
                        onChange={() => setSelected(c.choice)}
                        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-pretty">
                          {c.label}
                          {c.primary && <span className="ml-2 text-xs font-normal text-muted">suggested</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-pretty text-muted">{c.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm" aria-live="polite">
                {chosen ? (
                  <p className="text-pretty">
                    <span className="text-muted">You chose: </span>
                    <span className="font-medium">{chosen.label}</span>. This is final once confirmed.
                  </p>
                ) : (
                  <p className="text-muted">Pick one option above. Nothing happens until you confirm.</p>
                )}
              </div>
              <Button type="button" size="lg" className="mt-3 w-full" disabled={!chosen || pending} onClick={() => chosen && run(() => decideMilestone(token, milestoneId, chosen.choice))}>
                {pending ? "Working with PayPal…" : "Confirm decision"}
              </Button>
            </fieldset>
          )}
          {dispute && (
            <div className="mt-4 border-t border-line pt-4">
              <Button type="button" variant="secondary" className="w-full" disabled={pending} onClick={() => setMode("dispute")}>
                Dispute this result
              </Button>
              <p className="mt-2 text-center text-xs text-pretty text-muted">Nothing is released while the AI checks again with your objection. Then you decide.</p>
            </div>
          )}
        </div>
      ) : (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => disputeMilestone(token, milestoneId, picked, note));
          }}
        >
          <fieldset>
            <legend className="text-sm font-medium">Which results do you disagree with?</legend>
            <div className="mt-2 space-y-1.5">
              {dispute!.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--brand)]"
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                  />
                  <span className="text-pretty">
                    <span className={c.passed ? "text-released" : "text-danger"}>{c.passed ? "✓" : "✗"}</span> {c.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`note-${milestoneId}`} className="block text-sm font-medium">
              What&apos;s wrong?
            </label>
            <textarea
              id={`note-${milestoneId}`}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="The page names the cafés, but not their opening hours, which we asked for."
              className={`${fieldClass} mt-1.5`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || !picked.length || note.trim().length < 10}>
              {pending ? "Sending…" : "Dispute and re-check"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("choose")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
