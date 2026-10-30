import { formatCents, splitMoney } from "@/lib/money";

/**
 * The money bar: released (paid to the freelancer), held (authorized in PayPal, waiting on
 * proof) and not yet funded. Every job page shows one.
 */
export function MoneyBar({
  totalCents,
  authorizedCents,
  releasedCents,
  size = "md",
}: {
  totalCents: number;
  authorizedCents: number;
  releasedCents: number;
  size?: "md" | "lg";
}) {
  const s = splitMoney({ totalCents, authorizedCents, releasedCents });
  const pct = (c: number) => (s.totalCents === 0 ? 0 : (c / s.totalCents) * 100);
  const segments = [
    { key: "released", label: "Released", cents: s.releasedCents, className: "bg-released" },
    { key: "held", label: "Held in PayPal", cents: s.heldCents, className: "held-stripes" },
    { key: "unfunded", label: "Not funded", cents: s.unfundedCents, className: "bg-unfunded" },
  ];

  return (
    <div>
      <div
        role="img"
        aria-label={`${formatCents(s.releasedCents)} released, ${formatCents(s.heldCents)} held, ${formatCents(s.unfundedCents)} not funded, of ${formatCents(s.totalCents)}`}
        className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-surface-2 ${size === "lg" ? "h-4" : "h-2.5"}`}
      >
        {segments
          .filter((seg) => seg.cents > 0)
          .map((seg) => (
            <div key={seg.key} className={`${seg.className} h-full transition-[width] duration-700`} style={{ width: `${pct(seg.cents)}%` }} />
          ))}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {segments.map((seg) => (
          <div key={seg.key} className="min-w-0">
            <dt className="flex items-start gap-1.5 leading-tight text-muted">
              <span className={`mt-[3px] size-2.5 shrink-0 rounded-full ${seg.className}`} aria-hidden="true" />
              <span>{seg.label}</span>
            </dt>
            <dd className="tabular mt-0.5 font-mono text-base font-medium text-ink">{formatCents(seg.cents)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
