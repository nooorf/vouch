"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptProposal, reviseProposal } from "@/app/actions/agreement";
import { Button } from "@/components/ui";

export function ProposalActions({ jobId, versionId, hash, versionNo }: { jobId: string; versionId: string; hash: string; versionNo: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-4">
      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await acceptProposal(jobId, versionId, hash);
              if (!res.ok) setError(res.error);
              else router.refresh();
            })
          }
        >
          {pending ? "Saving…" : `Accept v${versionNo}`}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              // On success the action redirects to the editor.
              const res = await reviseProposal(jobId, versionId);
              if (res && !res.ok) setError(res.error);
            })
          }
        >
          Revise it
        </Button>
      </div>
    </div>
  );
}
