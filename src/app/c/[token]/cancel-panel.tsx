"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clientCancelAction, demoSkipToDeadlineAction, extendDeadlineAction, requestCancelAction, withdrawCancelRequestAction } from "@/app/actions/cancel";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { Badge, Button, Card, fieldClass } from "@/components/ui";

export interface ClientCancelView {
  deadline: "none" | "on_time" | "grace" | "overdue";
  position: number | null;
  dueAt: string | null;
  graceEndsAt: string | null;
  /** Why nothing can be cancelled right now (a delivery is being checked or reviewed). */
  blocker: string | null;
  requestNote: string | null;
  refund: string;
  extensionDays: readonly number[];
  demo: boolean;
}

const field = fieldClass;
const day = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

export function ClientCancelPanel({ token, freelancer, view }: { token: string; freelancer: string; view: ClientCancelView }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "ask" | "confirm">("idle");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        setMode("idle");
        router.refresh();
      }
    });

  const m = view.position ? `M${view.position}` : "This milestone";
  const errorBox = error && (
    <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      {error}
    </p>
  );
  const extend = view.extensionDays.length > 0 && (
    <div className="mt-4">
      <p className="text-sm font-medium">Give {freelancer} more time</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {view.extensionDays.map((d) => (
          <Button key={d} type="button" size="sm" variant="secondary" disabled={pending} onClick={() => run(() => extendDeadlineAction(token, d))}>
            +{d} {d === 1 ? "day" : "days"}
          </Button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">Later milestones move by the same amount.</p>
    </div>
  );

  if (view.deadline === "overdue" && !view.blocker) {
    return (
      <Card className="border-danger/30 p-5 sm:p-6">
        <Badge tone="danger" dot>{m} is overdue</Badge>
        <p className="mt-3 text-sm">
          The deadline was {view.dueAt && day(view.dueAt)} and the grace period has ended with nothing delivered. You can cancel the job or give more time.
        </p>
        {errorBox}
        {mode === "confirm" ? (
          <div className="mt-4 grid gap-2">
            <p className="text-sm">
              Cancelling ends the job. Money already released stays with {freelancer}; PayPal releases the remaining {view.refund} hold back to you.
            </p>
            <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => clientCancelAction(token))}>
              {pending ? "Working with PayPal…" : `Cancel and get ${view.refund} back`}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setMode("idle")}>
              Keep the job
            </Button>
          </div>
        ) : (
          <Button type="button" variant="danger" className="mt-4 w-full" disabled={pending} onClick={() => setMode("confirm")}>
            Cancel the job ({view.refund} back to you)
          </Button>
        )}
        {extend}
      </Card>
    );
  }

  if (view.deadline === "grace" && !view.blocker) {
    return (
      <Card className="border-held-fill/50 p-5 sm:p-6">
        <Badge tone="held" dot>{m}&apos;s deadline passed</Badge>
        <p className="mt-3 text-sm">
          {freelancer} has <Countdown endsAt={view.graceEndsAt!} /> left to deliver. If nothing arrives by then, you can cancel and get {view.refund} back.
        </p>
        <AutoRefresh seconds={4} from={view.graceEndsAt!} />
        {errorBox}
        {extend}
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <h3 className="font-semibold">Cancelling</h3>
      {view.blocker ? (
        <p className="mt-2 text-sm text-muted">{view.blocker}</p>
      ) : view.requestNote ? (
        <>
          <p className="mt-2 text-sm">You asked {freelancer} to cancel. Nothing changes unless they accept.</p>
          <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm text-muted">{view.requestNote}</blockquote>
          {errorBox}
          <Button type="button" variant="ghost" className="mt-3" disabled={pending} onClick={() => run(() => withdrawCancelRequestAction(token))}>
            Withdraw the request
          </Button>
        </>
      ) : mode === "ask" ? (
        <div className="mt-3 space-y-3">
          <label htmlFor="cancel-note" className="text-sm font-medium">
            Why do you want to cancel?
          </label>
          <textarea id="cancel-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} className={field} />
          {errorBox}
          <div className="grid gap-2">
            <Button type="button" variant="secondary" disabled={pending || note.trim().length < 10} onClick={() => run(() => requestCancelAction(token, note))}>
              {pending ? "Sending…" : `Ask ${freelancer} to cancel`}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setMode("idle")}>
              Never mind
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            {view.dueAt ? `${m} is due ${day(view.dueAt)}. ` : ""}Before a deadline, a job ends only if {freelancer} agrees. If a deadline passes with nothing delivered, you can
            cancel after a grace period.
          </p>
          {errorBox}
          <Button type="button" variant="ghost" className="mt-3" disabled={pending} onClick={() => setMode("ask")}>
            Ask to cancel
          </Button>
        </>
      )}
      {view.demo && view.deadline === "on_time" && !view.blocker && (
        <div className="mt-4 border-t border-line pt-3">
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => run(() => demoSkipToDeadlineAction(token))}>
            Demo: skip to {m}&apos;s deadline
          </Button>
          <p className="mt-1 text-xs text-muted">Demo jobs only. Moves the deadline to now so you can watch the grace period run out.</p>
        </div>
      )}
    </Card>
  );
}
