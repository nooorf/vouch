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
    return `Released to ${freelancer}${m ? `, M${m.position} ${m.title}` : ""}`;
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{completed ? "Receipt" : "Payments so far"}</h2>
        {completed && <Badge tone="ok">Completed</Badge>}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Held</dt>
          <dd className="amount font-medium">{formatCents(held)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Released</dt>
          <dd className="amount font-medium text-released">{formatCents(released)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Returned</dt>
          <dd className="amount font-medium">{formatCents(returned)}</dd>
        </div>
      </dl>
      <ul className="mt-2 divide-y divide-line text-sm">
        {rows.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-pretty">{label(p)}</p>
              <p className="mt-0.5 truncate text-xs text-faint" title={p.paypalId ?? undefined}>
                {when(p.createdAt)} · PayPal <span className="font-mono">{p.paypalId ?? "pending"}</span>
                {p.status === "pending" || p.status === "pending_paypal" ? " · pending" : ""}
              </p>
            </div>
            <span className={`amount shrink-0 font-medium ${p.type === "capture" ? "text-released" : p.type === "void" ? "text-muted" : ""}`}>
              {p.type === "capture" ? "−" : ""}
              {formatCents(p.amountCents)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
