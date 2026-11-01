import { formatCents, splitMoney } from "@/lib/money";

/**
 * The money bar: released (paid to the freelancer), held (authorized in PayPal, waiting on
 * proof) and not yet funded. Every job page shows one.
 */
export function MoneyBar({
  totalCents,
  authorizedCents,
  releasedCents,
  returnedCents = 0,
  size = "md",
}: {
  totalCents: number;
  authorizedCents: number;
  releasedCents: number;
  /** Voided back to the client when the job completed. */
  returnedCents?: number;
  size?: "sm" | "md" | "lg";
}) {
  const s = splitMoney({ totalCents, authorizedCents, releasedCents, returnedCents });
  const pct = (c: number) => (s.totalCents === 0 ? 0 : (c / s.totalCents) * 100);
  const segments = [
    { key: "released", label: "Released", cents: s.releasedCents, className: "bg-released-fill" },
    { key: "held", label: "Held in PayPal", cents: s.heldCents, className: "held-stripes" },
    s.returnedCents > 0
      ? { key: "returned", label: "Returned to client", cents: s.returnedCents, className: "bg-unfunded" }
      : { key: "unfunded", label: "Not funded", cents: s.unfundedCents, className: "bg-unfunded" },
  ];
  // A completed job holds nothing: show what was released and what went back.
  if (s.returnedCents > 0 && s.heldCents === 0) segments.splice(1, 1);

  return (
    <div>
      <div
        role="img"
        aria-label={`${formatCents(s.releasedCents)} released, ${formatCents(s.heldCents)} held, ${s.returnedCents ? `${formatCents(s.returnedCents)} returned` : `${formatCents(s.unfundedCents)} not funded`}, of ${formatCents(s.totalCents)}`}
        className={`flex w-full gap-[3px] overflow-hidden rounded-full bg-surface-2 ${size === "lg" ? "h-3" : size === "sm" ? "h-1.5" : "h-2"}`}
      >
        {segments
          .filter((seg) => seg.cents > 0)
          .map((seg) => (
            <div key={seg.key} className={`${seg.className} h-full rounded-full transition-[width] duration-700`} style={{ width: `${pct(seg.cents)}%` }} />
          ))}
      </div>
      {size !== "sm" && (
        <dl className={`mt-4 grid gap-3 ${segments.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {segments.map((seg) => (
            <div key={seg.key} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs leading-tight text-muted">
                <span className={`size-2 shrink-0 rounded-full ${seg.className}`} aria-hidden="true" />
                <span className="truncate">{seg.label}</span>
              </dt>
              <dd className={`amount mt-1 font-medium text-ink ${size === "lg" ? "text-lg" : "text-base"}`}>{formatCents(seg.cents)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
