import { describeCriterion } from "@/lib/brief/describe";
import { measuredShare } from "@/lib/brief/lint";
import type { Brief } from "@/lib/brief/schema";
import type { Change } from "@/lib/brief/diff";
import { CLIENT_EXTRA_TRIES, DECISION_DAYS } from "@/lib/jobs/tries";
import { formatCents, splitByShares } from "@/lib/money";
import { Card } from "./ui";

/** Read-only brief, as both sides see it once it's sent. */
export function BriefView({ brief, agreed }: { brief: Brief; /** Both sides accepted this version. */ agreed: boolean }) {
  return (
    <section className="space-y-4" aria-labelledby="brief-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-2">
        <h2 id="brief-heading" className="text-lg font-semibold">
          {agreed ? "The agreed brief" : "The brief"}
        </h2>
        <span className="text-xs text-muted">{agreed ? "What every delivery is checked against" : "Once both sides accept it, deliveries are checked against exactly this"}</span>
      </div>
      {brief.summary && <p className="max-w-[68ch] leading-relaxed text-pretty text-muted">{brief.summary}</p>}
      {brief.milestones.map((m, i) => {
        const rowCents = splitByShares(m.amountCents, m.criteria.map((c) => c.weight));
        return (
          <Card key={m.id} className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted">{i + 1}</span>
                <div className="min-w-0">
                  <h3 className="font-semibold">{m.title}</h3>
                  <p className="text-sm text-muted">Due day {m.dueInDays} after funding</p>
                </div>
              </div>
              <span className="amount text-xl font-semibold">{formatCents(m.amountCents)}</span>
            </div>
            {m.description && <p className="mt-3 max-w-[68ch] text-sm text-pretty text-muted">{m.description}</p>}
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {m.criteria.map((c, ci) => (
                <li key={c.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-pretty">
                      {describeCriterion(c)}
                      {c.required && <span className="ml-2 rounded-full bg-held-soft px-2 py-0.5 text-[11px] font-medium text-held">must pass</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-faint">
                      {c.kind === "check" ? "Measured automatically" : "Judged by AI, with quoted evidence"}
                      {c.kind === "judged" && c.source === "code" ? ", from the code" : c.kind === "judged" && c.visual ? ", from a screenshot" : ""}
                    </p>
                  </div>
                  <span className="amount shrink-0 text-muted" title="This criterion's share of the milestone">
                    {formatCents(rowCents[ci])}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{Math.round(measuredShare(m) * 100)}% of this payment depends on measured checks.</p>
          </Card>
        );
      })}
      <Card className="p-5 text-sm sm:p-6">
        <h3 className="font-semibold">Terms</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-pretty text-muted marker:text-faint">
          <li>
            After each delivery, the client has <strong className="text-ink">{brief.terms.reviewWindowHours} hours</strong> to approve or dispute.
            If they don&apos;t respond, the verdict executes automatically.
          </li>
          <li>
            The freelancer has <strong className="text-ink">{1 + brief.terms.maxResubmissions} {brief.terms.maxResubmissions === 0 ? "try" : "tries"}</strong>{" "}
            per milestone; withdrawing a delivery counts as one. After that, the client can give up to {CLIENT_EXTRA_TRIES} more, accept the work as is, skip
            the milestone, or end the project. If they don&apos;t decide within {DECISION_DAYS} days, the project ends and the unpaid money goes back to them.
          </li>
          <li>The next milestone starts only once this one is paid, or the client chooses to move on.</li>
          <li>A failed must-pass check releases nothing for that milestone, whatever the AI says.</li>
        </ul>
      </Card>
    </section>
  );
}

export function VersionChanges({ changes, fromVersion }: { changes: Change[]; fromVersion: number }) {
  if (!changes.length) return null;
  const tone = { added: "bg-released-soft text-released", removed: "bg-danger-soft text-danger", changed: "bg-held-soft text-held" } as const;
  const sign = { added: "+", removed: "−", changed: "~" } as const;
  return (
    <Card className="p-5 sm:p-6">
      <h3 className="font-semibold">What changed since v{fromVersion}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {changes.map((c, i) => (
          <li key={i} className="flex gap-2.5">
            <span className={`tabular flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${tone[c.kind]}`} aria-label={c.kind}>
              {sign[c.kind]}
            </span>
            <span className="text-pretty">
              <span className="text-muted">{c.where}: </span>
              {c.text}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
