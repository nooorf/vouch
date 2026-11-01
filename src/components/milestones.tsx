import type { schema } from "@/db";
import { formatCents } from "@/lib/money";
import { Badge, Card } from "./ui";

type Milestone = typeof schema.milestones.$inferSelect;

const statusView: Record<Milestone["status"], { label: string; tone: "neutral" | "ok" | "held" | "danger" | "info" }> = {
  PENDING: { label: "Waiting for delivery", tone: "neutral" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  EVALUATING: { label: "Being checked", tone: "info" },
  REVIEW_WINDOW: { label: "In review", tone: "held" },
  DISPUTED: { label: "Disputed", tone: "danger" },
  RELEASED: { label: "Released", tone: "ok" },
  PARTIAL_HELD: { label: "Partly released", tone: "held" },
  HELD: { label: "Held", tone: "held" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

/** Funded milestones with their money and status. */
export function MilestoneList({ milestones }: { milestones: Milestone[] }) {
  if (!milestones.length) return null;
  return (
    <Card className="px-5 py-2 sm:px-6">
      <h2 className="sr-only">Milestones</h2>
      <ul className="divide-y divide-line">
        {milestones.map((m) => {
          const pct = m.amountCents ? Math.min(100, (m.releasedCents / m.amountCents) * 100) : 0;
          return (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted">
                  {m.position}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{m.title}</p>
                  {m.dueAt && <p className="text-xs text-muted">Due {m.dueAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}</p>}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden w-20 sm:block" aria-hidden="true">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-released-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="amount text-sm">
                  {formatCents(m.releasedCents)} <span className="text-faint">/ {formatCents(m.amountCents)}</span>
                </span>
                <Badge tone={statusView[m.status].tone} dot>
                  {statusView[m.status].label}
                </Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
