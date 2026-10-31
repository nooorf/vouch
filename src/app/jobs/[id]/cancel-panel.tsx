"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { answerCancelRequestAction, cancelJobAction } from "@/app/actions/cancel";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { Badge, Button, Card } from "@/components/ui";

export interface FreelancerCancelView {
  deadline: "none" | "on_time" | "grace" | "overdue";
  position: number | null;
  graceEndsAt: string | null;
  blocker: string | null;
  requestNote: string | null;
  refund: string;
}

const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function FreelancerCancelPanel({ jobId, view }: { jobId: string; view: FreelancerCancelView }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        setConfirming(false);
        router.refresh();
      }
    });

  const m = view.position ? `M${view.position}` : "This milestone";
  const errorBox = error && (
    <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );

  return (
    <div className="space-y-4">
      {view.deadline === "grace" && (
        <Card className="border-held/40 p-5">
          <Badge tone="held">{m}&apos;s deadline passed</Badge>
          <p className="mt-3 text-sm">
            Deliver within <Countdown endsAt={view.graceEndsAt!} />. After that the client can cancel and get the remaining {view.refund} back, or give you more time.
          </p>
          <AutoRefresh seconds={4} from={view.graceEndsAt!} />
        </Card>
      )}
      {view.deadline === "overdue" && (
        <Card className="border-danger/40 p-5">
          <Badge tone="danger">{m} is overdue</Badge>
          <p className="mt-3 text-sm">The grace period has ended. The client can now cancel or extend the deadline. Delivering now still counts if they haven&apos;t cancelled.</p>
        </Card>
      )}

      {view.requestNote && (
        <Card className="border-held/40 p-5">
          <Badge tone="held">The client asked to cancel</Badge>
          <blockquote className="mt-3 border-l-2 border-held/50 pl-3 text-sm text-pretty">{view.requestNote}</blockquote>
          <p className="mt-3 text-sm text-muted">Nothing changes unless you accept. Money already released stays yours.</p>
          {errorBox}
          {view.blocker ? (
            <p className="mt-3 text-sm text-muted">{view.blocker}</p>
          ) : (
            <div className="mt-4 grid gap-2">
              <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => answerCancelRequestAction(jobId, true))}>
                {pending ? "Working…" : `Accept: cancel and return ${view.refund}`}
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => answerCancelRequestAction(jobId, false))}>
                Decline and keep working
              </Button>
            </div>
          )}
        </Card>
      )}

      {!view.requestNote && (
        <Card className="p-5">
          <h2 className="font-semibold">Can&apos;t finish?</h2>
          {view.blocker ? (
            <p className="mt-2 text-sm text-muted">{view.blocker}</p>
          ) : confirming ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm">
                Cancelling ends the job. What&apos;s already released stays yours; the remaining {view.refund} hold goes back to the client.
              </p>
              <label htmlFor="cancel-reason" className="text-sm font-medium">
                Note to the client <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={pending} className={field} />
              {errorBox}
              <div className="grid gap-2">
                <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => cancelJobAction(jobId, reason))}>
                  {pending ? "Working with PayPal…" : `Cancel and return ${view.refund}`}
                </Button>
                <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                  Keep the job
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">You can cancel at any time. You keep what&apos;s been released; the rest goes back to the client.</p>
              <Button type="button" variant="ghost" className="mt-3" onClick={() => setConfirming(true)}>
                Cancel this job
              </Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
