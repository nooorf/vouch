"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitDeliveryAction } from "@/app/actions/delivery";
import { Button, Card } from "@/components/ui";

const DEMO_SITES = [
  { key: "good", label: "Good site" },
  { key: "flawed", label: "Flawed site" },
  { key: "fixed", label: "Fixed site" },
  { key: "hostile", label: "Hostile site" },
] as const;

const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function SubmitDelivery({
  jobId,
  milestoneId,
  position,
  title,
  wantsRepo,
  demo,
  resubmission,
}: {
  jobId: string;
  milestoneId: string;
  position: number;
  title: string;
  wantsRepo: boolean;
  demo: boolean;
  resubmission: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-5">
      <h2 className="font-semibold">
        {resubmission ? "Resubmit" : "Submit"} M{position}: {title}
      </h2>
      <p className="mt-1 text-sm text-muted">Give the live link. Vouch checks it against this milestone&apos;s criteria and shows both of you the evidence.</p>

      {demo && (
        <div className="mt-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Demo deliveries</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DEMO_SITES.map((s) => (
              <Button key={s.key} type="button" variant="secondary" size="sm" onClick={() => setUrl(`${window.location.origin}/demo-sites/${s.key}/index.html`)}>
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await submitDeliveryAction(jobId, milestoneId, url, repo);
            if (!res.ok) setError(res.error);
            else router.refresh();
          });
        }}
      >
        <label className="block text-sm font-medium" htmlFor="delivery-url">
          Live URL
        </label>
        <input id="delivery-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.example" className={field} />
        {wantsRepo && (
          <>
            <label className="block text-sm font-medium" htmlFor="delivery-repo">
              GitHub repository <span className="font-normal text-muted">(for the repo checks)</span>
            </label>
            <input id="delivery-repo" type="url" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/you/site" className={field} />
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending || !url}>
          {pending ? "Submitting…" : resubmission ? "Resubmit for checking" : "Submit for checking"}
        </Button>
      </form>
    </Card>
  );
}
