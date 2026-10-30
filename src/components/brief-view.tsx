import { describeCriterion } from "@/lib/brief/describe";
import { measuredShare } from "@/lib/brief/lint";
import type { Brief } from "@/lib/brief/schema";
import type { Change } from "@/lib/brief/diff";
import { formatCents } from "@/lib/money";
import { Badge, Card } from "./ui";

/** Read-only brief, as both sides see it once it's sent. */
export function BriefView({ brief }: { brief: Brief }) {
  return (
    <div className="space-y-4">
      {brief.summary && (
        <Card className="p-5">
          <p className="leading-relaxed text-pretty">{brief.summary}</p>
        </Card>
      )}
      {brief.milestones.map((m, i) => {
        const totalWeight = m.criteria.reduce((s, c) => s + c.weight, 0);
        return (
          <Card key={m.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft font-mono text-sm font-semibold text-brand">
                  M{i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold">{m.title}</h3>
                  <p className="text-sm text-muted">Due day {m.dueInDays} after funding</p>
                </div>
              </div>
              <span className="tabular font-mono text-lg font-semibold">{formatCents(m.amountCents)}</span>
            </div>
            {m.description && <p className="mt-3 text-sm text-muted">{m.description}</p>}
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {m.criteria.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Badge tone={c.kind === "check" ? "brand" : "info"} className="mt-0.5 shrink-0">
                      {c.kind === "check" ? "Measured" : "AI-judged"}
                    </Badge>
                    <span className="min-w-0">
                      {describeCriterion(c)}
                      {c.required && <span className="ml-2 text-xs font-medium text-held">must pass</span>}
                      {c.kind === "judged" && c.visual && <span className="ml-2 text-xs text-muted">from a screenshot</span>}
                    </span>
                  </div>
                  <span className="tabular shrink-0 font-mono text-muted" title="This criterion's share of the milestone">
                    {formatCents(totalWeight ? Math.floor((m.amountCents * c.weight) / totalWeight) : 0)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{Math.round(measuredShare(m) * 100)}% of this payment depends on measured checks.</p>
          </Card>
        );
      })}
      <Card className="p-5 text-sm">
        <h3 className="font-semibold">Terms</h3>
        <ul className="mt-2 space-y-1.5 text-muted">
          <li>
            After each delivery, the client has <strong className="text-ink">{brief.terms.reviewWindowHours} hours</strong> to approve or dispute.
            If they don&apos;t respond, the verdict executes automatically.
          </li>
          <li>
            The freelancer can resubmit a milestone up to <strong className="text-ink">{brief.terms.maxResubmissions} times</strong> after a partial or
            failed review.
          </li>
          <li>A failed must-pass check releases nothing for that milestone, whatever the AI says.</li>
        </ul>
      </Card>
    </div>
  );
}

export function VersionChanges({ changes, fromVersion }: { changes: Change[]; fromVersion: number }) {
  if (!changes.length) return null;
  const tone = { added: "text-brand", removed: "text-danger", changed: "text-held" } as const;
  const sign = { added: "+", removed: "−", changed: "~" } as const;
  return (
    <Card className="p-5">
      <h3 className="font-semibold">What changed since v{fromVersion}</h3>
      <ul className="mt-3 space-y-1.5 text-sm">
        {changes.map((c, i) => (
          <li key={i} className="flex gap-2">
            <span className={`tabular w-3 shrink-0 font-mono ${tone[c.kind]}`} aria-label={c.kind}>
              {sign[c.kind]}
            </span>
            <span>
              <span className="text-muted">{c.where}: </span>
              {c.text}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
