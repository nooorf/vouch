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
  /** Authorized but never captured, and released back to the client (voided). */
  returnedCents: number;
  /** Agreed but not (yet) authorized by the client. */
  unfundedCents: number;
  totalCents: number;
}

/** Split a job total into the money-bar segments. Clamps so segments always add up. */
export function splitMoney(p: { totalCents: number; authorizedCents: number; releasedCents: number; returnedCents?: number }): MoneySplit {
  const total = Math.max(0, p.totalCents);
  const released = Math.min(Math.max(0, p.releasedCents), total);
  const authorized = Math.min(Math.max(p.authorizedCents, released), total);
  const returned = Math.min(Math.max(0, p.returnedCents ?? 0), authorized - released);
  return {
    releasedCents: released,
    heldCents: authorized - released - returned,
    returnedCents: returned,
    unfundedCents: total - authorized,
    totalCents: total,
  };
}

/** What went back to the client: on a completed job, everything authorized but not captured was voided. */
export function returnedCents(job: { status: string; authorizedCents: number; capturedCents: number }): number {
  return job.status === "COMPLETED" ? Math.max(0, job.authorizedCents - job.capturedCents) : 0;
}
