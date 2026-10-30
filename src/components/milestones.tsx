import type { schema } from "@/db";
import { formatCents } from "@/lib/money";
import { Badge, Card } from "./ui";

type Milestone = typeof schema.milestones.$inferSelect;

const statusView: Record<Milestone["status"], { label: string; tone: "neutral" | "brand" | "held" | "danger" | "info" }> = {
  PENDING: { label: "Waiting for delivery", tone: "neutral" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  EVALUATING: { label: "Being checked", tone: "info" },
  REVIEW_WINDOW: { label: "In review", tone: "held" },
  DISPUTED: { label: "Disputed", tone: "danger" },
  RELEASED: { label: "Released", tone: "brand" },
  PARTIAL_HELD: { label: "Partly released", tone: "held" },
  HELD: { label: "Held", tone: "held" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

/** Funded milestones with their money and status. */
export function MilestoneList({ milestones }: { milestones: Milestone[] }) {
  if (!milestones.length) return null;
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Milestones</h2>
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {milestones.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                <span className="text-muted">M{m.position}</span> {m.title}
              </p>
              {m.dueAt && (
                <p className="text-xs text-muted">Due {m.dueAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular font-mono text-sm">
                {formatCents(m.releasedCents)} <span className="text-muted">/ {formatCents(m.amountCents)}</span>
              </span>
              <Badge tone={statusView[m.status].tone}>{statusView[m.status].label}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
