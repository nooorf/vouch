"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptBrief, previewProposal, proposeChanges, requestChanges } from "@/app/actions/agreement";
import { VersionChanges } from "@/components/brief-view";
import { Button, Callout, Card, fieldClass } from "@/components/ui";
import type { ProposalPreview } from "@/lib/jobs/agreement";
import { formatCents } from "@/lib/money";

interface Props {
  token: string;
  versionId: string;
  hash: string;
  totalCents: number;
  versionNo: number;
  freelancerName: string;
}

const field = fieldClass;

export function ClientActions({ token, versionId, hash, totalCents, versionNo, freelancerName }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "changes" | "preview">("idle");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<ProposalPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [drafting, startDrafting] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });

  const draft = () =>
    startDrafting(async () => {
      setError(null);
      const res = await previewProposal(token, versionId, note);
      if (!res.ok) setError(res.error);
      else {
        setPreview(res.preview);
        setMode("preview");
      }
    });

  const busy = pending || drafting;

  return (
    <Card className="border-brand/30 p-5 shadow-raised sm:p-6">
      <p className="flex items-center gap-2 text-xs font-medium text-brand">
        <span className="size-2 rounded-full bg-brand" aria-hidden="true" />
        Your response to v{versionNo}
      </p>
      <p className="amount mt-2 text-4xl font-semibold">{formatCents(totalCents)}</p>

      {error && (
        <Callout tone="danger" role="alert" className="mt-4">
          {error}
        </Callout>
      )}

      {mode === "idle" && (
        <>
          <p className="mt-2 text-sm text-pretty text-muted">
            Accepting doesn&apos;t charge you. Next you fund the job with PayPal: the money is held, not sent, and released milestone by milestone
            as deliveries pass these criteria.
          </p>
          <div className="mt-5 grid gap-2">
            <Button type="button" size="lg" disabled={busy} onClick={() => run(() => acceptBrief(token, versionId, hash))}>
              {pending ? "Saving…" : "Accept this brief"}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setMode("changes")}>
              Request changes
            </Button>
          </div>
        </>
      )}

      {mode === "changes" && (
        <div className="mt-5 space-y-3">
          <label htmlFor="note" className="text-sm font-medium">
            What should change?
          </label>
          <textarea
            id="note"
            rows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="Make the first milestone $210, and check that the page lists our three café locations."
            className={field}
          />
          {drafting ? (
            <p className="text-sm text-muted" aria-live="polite">
              <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-held-fill" aria-hidden="true" />
              Turning your request into concrete changes…
            </p>
          ) : (
            <div className="grid gap-2">
              <Button type="button" disabled={busy || note.trim().length < 10} onClick={draft}>
                Draft the changes with AI
              </Button>
              <Button type="button" variant="secondary" disabled={busy || note.trim().length < 10} onClick={() => run(() => requestChanges(token, versionId, note))}>
                {pending ? "Sending…" : "Send as a note instead"}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      {mode === "preview" && preview && (
        <div className="mt-5 space-y-4">
          {preview.summary && <p className="text-sm">{preview.summary}</p>}
          {preview.changes.length > 0 ? (
            <VersionChanges changes={preview.changes} fromVersion={versionNo} />
          ) : (
            <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">The AI couldn&apos;t turn this into changes. Try rewording it, or send it as a note.</p>
          )}
          {preview.unclear && (
            <p className="rounded-xl bg-held-soft px-4 py-3 text-sm text-held">
              <strong>Not included:</strong> {preview.unclear}
            </p>
          )}
          {preview.rejected.length > 0 && <p className="text-xs text-muted">{preview.rejected.length} suggested edit(s) didn&apos;t fit the brief&apos;s rules and were left out.</p>}
          <p className="text-sm text-muted">
            New total <span className="amount font-semibold text-ink">{formatCents(preview.totalCents)}</span>. Vouch worked out this list from the actual
            edits, so it&apos;s exactly what would change.
          </p>
          <div className="grid gap-2">
            {preview.changes.length > 0 && (
              <Button type="button" disabled={busy} onClick={() => run(() => proposeChanges(token, versionId, note, preview.hash))}>
                {pending ? "Proposing…" : `Propose v${preview.nextVersion} to ${freelancerName}`}
              </Button>
            )}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setMode("changes")}>
              Edit my request
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => run(() => requestChanges(token, versionId, note))}>
              Send as a note instead
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
