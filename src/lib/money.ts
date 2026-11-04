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

/** What went back to the client: on a completed or cancelled job, everything authorized but not captured is voided. */
export function returnedCents(job: { status: string; authorizedCents: number; capturedCents: number }): number {
  return job.status === "COMPLETED" || job.status === "CANCELLED" ? Math.max(0, job.authorizedCents - job.capturedCents) : 0;
}

/** Split total into integer cents by shares, largest remainder first, so parts add up exactly. */
export function splitByShares(totalCents: number, shares: number[]): number[] {
  const clean = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const weights = sum === 0 ? clean.map(() => 1) : clean;
  const wsum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (totalCents * w) / wsum);
  const parts = exact.map(Math.floor);
  let left = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}
