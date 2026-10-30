"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptBrief, requestChanges } from "@/app/actions/agreement";
import { Button, Card } from "@/components/ui";
import { formatCents } from "@/lib/money";

export function ClientActions({ token, versionId, hash, totalCents, versionNo }: { token: string; versionId: string; hash: string; totalCents: number; versionNo: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "changes">("idle");
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

  return (
    <Card className="p-5">
      <p className="text-sm text-muted">Brief v{versionNo} · total</p>
      <p className="tabular mt-1 font-mono text-3xl font-semibold">{formatCents(totalCents)}</p>
      <p className="mt-3 text-sm text-muted">
        Accepting doesn&apos;t charge you. Next you fund the job with PayPal: the money is held, not sent, and released milestone by milestone
        as deliveries pass these criteria.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {mode === "idle" ? (
        <div className="mt-5 grid gap-2">
          <Button type="button" size="lg" disabled={pending} onClick={() => run(() => acceptBrief(token, versionId, hash))}>
            {pending ? "Saving…" : "Accept this brief"}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setMode("changes")}>
            Request changes
          </Button>
        </div>
      ) : (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => requestChanges(token, versionId, note));
          }}
        >
          <label htmlFor="note" className="text-sm font-medium">
            What should change?
          </label>
          <textarea
            id="note"
            rows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Please add a section for our café locations, and move the contact form into the first milestone."
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || note.trim().length < 10}>
              {pending ? "Sending…" : "Send request"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
