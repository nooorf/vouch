"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideMilestone, disputeMilestone } from "@/app/actions/settlement";
import { Button, Card } from "@/components/ui";

export interface ChoiceView {
  choice: string;
  label: string;
  hint: string;
  primary?: boolean;
}

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
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyChoice, setBusyChoice] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
      setBusyChoice(null);
    });

  return (
    <Card className="border-brand/40 p-5">
      <h3 className="font-semibold">Your decision on M{position}</h3>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {mode === "choose" ? (
        <div className="mt-4 space-y-2">
          {choices.map((c) => (
            <div key={c.choice}>
              <Button
                type="button"
                variant={c.primary ? "primary" : "secondary"}
                className="w-full justify-start"
                disabled={pending}
                onClick={() => {
                  setBusyChoice(c.choice);
                  run(() => decideMilestone(token, milestoneId, c.choice));
                }}
              >
                {pending && busyChoice === c.choice ? "Working with PayPal…" : c.label}
              </Button>
              <p className="mt-1 px-1 text-xs text-muted">{c.hint}</p>
            </div>
          ))}
          {dispute && (
            <div>
              <Button type="button" variant="ghost" className="w-full justify-start" disabled={pending} onClick={() => setMode("dispute")}>
                Dispute this result
              </Button>
              <p className="mt-1 px-1 text-xs text-muted">Nothing is released while the AI checks again with your objection. Then you decide.</p>
            </div>
          )}
        </div>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => disputeMilestone(token, milestoneId, picked, note));
          }}
        >
          <fieldset>
            <legend className="text-sm font-medium">Which results do you disagree with?</legend>
            <div className="mt-2 space-y-1.5">
              {dispute!.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 accent-[var(--brand)]"
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                  />
                  <span>
                    <span className={c.passed ? "text-brand" : "text-danger"}>{c.passed ? "✓" : "✗"}</span> {c.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`note-${milestoneId}`} className="block text-sm font-medium">
            What&apos;s wrong?
          </label>
          <textarea
            id={`note-${milestoneId}`}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="The page names the cafés, but not their opening hours, which we asked for."
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <div className="flex gap-2">
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
