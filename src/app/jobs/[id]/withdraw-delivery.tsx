"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { withdrawDeliveryAction } from "@/app/actions/delivery";
import { Button, Card } from "@/components/ui";

/** Take back the delivery under review, to submit again without waiting for its review window. */
export function WithdrawDelivery({ jobId, milestoneId, position, tryNo, triesLeft }: { jobId: string; milestoneId: string; position: number; tryNo: number; triesLeft: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const withdraw = () =>
    startTransition(async () => {
      setError(null);
      const res = await withdrawDeliveryAction(jobId, milestoneId);
      if (!res.ok) setError(res.error);
      else {
        setConfirming(false);
        router.refresh();
      }
    });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">Submitted the wrong thing?</h3>
          <p className="mt-1 text-sm text-muted">
            Withdraw M{position}&apos;s delivery to submit again now instead of waiting for the client&apos;s review. It still counts as try {tryNo}.
          </p>
        </div>
        {!confirming && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            Withdraw delivery
          </Button>
        )}
      </div>
      {confirming && (
        <div className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-sm">
          <p>
            {triesLeft > 0
              ? `You'll have ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left for M${position}. Nothing is released for this delivery, and the client sees it was withdrawn.`
              : `This was your last try for M${position}. After withdrawing, the client decides whether you get another, accepts the work as is, skips it, or ends the project.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={withdraw}>
              {pending ? "Withdrawing…" : "Yes, withdraw it"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
