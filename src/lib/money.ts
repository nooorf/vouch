const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** $150 for whole dollars, $66.66 otherwise. Input is integer cents. */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Cents must be an integer, got ${cents}`);
  return cents % 100 === 0 ? whole.format(cents / 100) : exact.format(cents / 100);
}

export interface MoneySplit {
  releasedCents: number;
  heldCents: number;
  /** Agreed but not (yet) authorized by the client. */
  unfundedCents: number;
  totalCents: number;
}

/** Split a job total into the three money-bar segments. Clamps so segments always add up. */
export function splitMoney(p: { totalCents: number; authorizedCents: number; releasedCents: number }): MoneySplit {
  const total = Math.max(0, p.totalCents);
  const released = Math.min(Math.max(0, p.releasedCents), total);
  const authorized = Math.min(Math.max(p.authorizedCents, released), total);
  return {
    releasedCents: released,
    heldCents: authorized - released,
    unfundedCents: total - authorized,
    totalCents: total,
  };
}
