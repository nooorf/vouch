import type { schema } from "@/db";
import { formatCents } from "@/lib/money";
import { Badge, Card } from "./ui";

type Payment = typeof schema.payments.$inferSelect;
type Milestone = typeof schema.milestones.$inferSelect;

const when = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/** Every PayPal transaction on the job, with PayPal's own ids. */
export function Receipt({ payments, milestones, completed, freelancer }: { payments: Payment[]; milestones: Milestone[]; completed: boolean; freelancer: string }) {
  const rows = payments.filter((p) => p.status !== "failed" && p.type !== "reauthorize").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (!rows.length) return null;
  const held = rows.filter((p) => p.type === "authorize").reduce((s, p) => s + p.amountCents, 0);
  const released = rows.filter((p) => p.type === "capture").reduce((s, p) => s + p.amountCents, 0);
  const returned = rows.filter((p) => p.type === "void").reduce((s, p) => s + p.amountCents, 0);
  const label = (p: Payment) => {
    if (p.type === "authorize") return "Held by PayPal (authorization)";
    if (p.type === "void") return "Unused hold released back to the client";
    const m = milestones.find((x) => x.id === p.milestoneId);
    return `Released to ${freelancer}${m ? ` · M${m.position} ${m.title}` : ""}`;
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{completed ? "Receipt" : "Payments so far"}</h2>
        {completed && <Badge tone="brand">Completed</Badge>}
      </div>
      <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
        {rows.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p>{label(p)}</p>
              <p className="truncate font-mono text-xs text-muted" title={p.paypalId ?? undefined}>
                {when(p.createdAt)} · PayPal {p.paypalId ?? "pending"}
                {p.status === "pending" || p.status === "pending_paypal" ? " · pending" : ""}
              </p>
            </div>
            <span className={`tabular shrink-0 font-mono ${p.type === "capture" ? "text-brand" : p.type === "void" ? "text-muted" : ""}`}>
              {p.type === "capture" ? "−" : ""}
              {formatCents(p.amountCents)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm">
        <div>
          <dt className="text-muted">Held</dt>
          <dd className="tabular font-mono font-medium">{formatCents(held)}</dd>
        </div>
        <div>
          <dt className="text-muted">Released</dt>
          <dd className="tabular font-mono font-medium text-brand">{formatCents(released)}</dd>
        </div>
        <div>
          <dt className="text-muted">Returned</dt>
          <dd className="tabular font-mono font-medium">{formatCents(returned)}</dd>
        </div>
      </dl>
    </Card>
  );
}
