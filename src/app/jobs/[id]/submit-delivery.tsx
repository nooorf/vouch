"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitDeliveryAction } from "@/app/actions/delivery";
import { Button, Card, fieldClass } from "@/components/ui";

const DEMO_SITES = [
  { key: "good", label: "Good site" },
  { key: "flawed", label: "Flawed site" },
  { key: "fixed", label: "Fixed site" },
  { key: "hostile", label: "Hostile site" },
] as const;

const field = fieldClass;

export function SubmitDelivery({
  jobId,
  milestoneId,
  position,
  title,
  wantsRepo,
  demo,
  demoRepo,
  resubmission,
  tryNo,
  tries,
}: {
  jobId: string;
  milestoneId: string;
  position: number;
  title: string;
  wantsRepo: boolean;
  demo: boolean;
  /** Filled in with a demo site when the brief checks the code. */
  demoRepo?: string;
  resubmission: boolean;
  /** Which try this delivery will be, and how many this milestone allows right now. */
  tryNo: number;
  tries: number;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="border-brand/30 p-5 shadow-raised sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-medium text-brand">
          <span className="size-2 rounded-full bg-brand" aria-hidden="true" />
          Your delivery
        </p>
        <p className={`text-xs font-medium ${tryNo >= tries ? "text-held" : "text-muted"}`}>
          Try {tryNo} of {tries}
          {tryNo >= tries ? ": your last one. After it, the client decides whether you get another." : "."}
        </p>
      </div>
      <h2 className="mt-1 text-lg font-semibold">
        {resubmission ? "Resubmit" : "Submit"} M{position}: {title}
      </h2>
      <p className="mt-1 text-sm text-pretty text-muted">Give the live link. Vouch checks it against this milestone&apos;s criteria and shows both of you the evidence.</p>

      {demo && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted">
            Demo deliveries: pick one to fill in the link{wantsRepo && demoRepo ? " and the demo repository" : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DEMO_SITES.map((s) => (
              <Button
                key={s.key}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setUrl(`${window.location.origin}/demo-sites/${s.key}/index.html`);
                  if (wantsRepo && demoRepo) setRepo(demoRepo);
                }}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <form
        className="mt-5 space-y-3"
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
              GitHub repository <span className="font-normal text-muted">(public; the brief checks the code)</span>
            </label>
            <input id="delivery-repo" type="url" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/you/site" className={field} />
          </>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending || !url}>
          {pending ? "Submitting…" : resubmission ? "Resubmit for checking" : "Submit for checking"}
        </Button>
      </form>
    </Card>
  );
}
