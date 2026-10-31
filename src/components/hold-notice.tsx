import { holdPhase, holdTimeline } from "@/lib/jobs/hold-rules";
import { Badge, Card } from "./ui";

const when = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/** Shown to both sides once PayPal's hold is near its end (about day 25 of 29). */
export function HoldNotice({ job }: { job: { status: string; authExpiresAt: Date | null } }) {
  if (job.status !== "FUNDED" && job.status !== "IN_PROGRESS") return null;
  const phase = holdPhase(job.authExpiresAt, new Date());
  if (phase !== "notice" && phase !== "settle") return null;
  const t = holdTimeline(job.authExpiresAt)!;
  return (
    <Card className="border-held/40 p-5">
      <Badge tone="held">{phase === "settle" ? "Settling before PayPal's hold ends" : "PayPal's hold ends soon"}</Badge>
      <p className="mt-3 text-sm text-pretty">
        PayPal holds a payment for 29 days; this one ends {when(t.expiresAt)}.{" "}
        {phase === "settle" ? "Vouch is settling the job now" : `Anything still open on ${when(t.settleBy)} is settled automatically`} by the agreed rules: open reviews
        close as if the client stayed silent, and work not delivered by then is closed, with its money going back to the client.
      </p>
    </Card>
  );
}
