/**
 * PayPal holds an authorization for 29 days; captures after that fail and the money goes back to
 * the client on PayPal's side, out of sync with what both parties see. So Vouch finishes first:
 * a final notice around day 25, and a day before the hold ends everything still open is settled
 * by the agreed rules (open reviews by the silence rule, undelivered work closed).
 *
 * Pure functions, no database: tested in hold-rules.test.ts.
 */

const DAY = 86_400_000;
/** Final notice to both sides, about day 25 of 29. */
export const FINAL_NOTICE_DAYS = 4;
/** Settle everything this long before PayPal's hold ends, leaving room for retries. */
export const SETTLE_MARGIN_HOURS = 24;

export type HoldPhase = "none" | "normal" | "notice" | "settle";

export function holdTimeline(authExpiresAt: Date | null) {
  if (!authExpiresAt) return null;
  return {
    expiresAt: authExpiresAt,
    noticeAt: new Date(authExpiresAt.getTime() - FINAL_NOTICE_DAYS * DAY),
    settleBy: new Date(authExpiresAt.getTime() - SETTLE_MARGIN_HOURS * 3_600_000),
  };
}

export function holdPhase(authExpiresAt: Date | null, now: Date): HoldPhase {
  const t = holdTimeline(authExpiresAt);
  if (!t) return "none";
  if (now >= t.settleBy) return "settle";
  if (now >= t.noticeAt) return "notice";
  return "normal";
}

/** A review or decision window never runs past the settle-by time (and never ends before now). */
export function clampWindowEnd(end: Date, authExpiresAt: Date | null, now: Date): Date {
  const t = holdTimeline(authExpiresAt);
  if (!t || end <= t.settleBy) return end;
  return t.settleBy > now ? t.settleBy : now;
}
