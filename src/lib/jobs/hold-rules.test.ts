import { describe, expect, it } from "vitest";
import { clampWindowEnd, holdPhase, holdTimeline } from "./hold-rules";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const EXPIRES = new Date("2026-11-29T12:00:00Z");
const at = (msBeforeExpiry: number) => new Date(EXPIRES.getTime() - msBeforeExpiry);

describe("holdPhase", () => {
  it("is normal until the final notice, about day 25", () => {
    expect(holdPhase(EXPIRES, at(10 * DAY))).toBe("normal");
    expect(holdPhase(EXPIRES, at(4 * DAY + 1))).toBe("normal");
    expect(holdPhase(EXPIRES, at(4 * DAY))).toBe("notice");
  });

  it("settles a day before PayPal's hold ends, and after", () => {
    expect(holdPhase(EXPIRES, at(DAY + 1))).toBe("notice");
    expect(holdPhase(EXPIRES, at(DAY))).toBe("settle");
    expect(holdPhase(EXPIRES, at(-HOUR))).toBe("settle");
  });

  it("has nothing to do without a hold", () => {
    expect(holdPhase(null, at(0))).toBe("none");
    expect(holdTimeline(null)).toBeNull();
  });
});

describe("clampWindowEnd", () => {
  it("leaves windows that end in time alone", () => {
    const end = at(3 * DAY);
    expect(clampWindowEnd(end, EXPIRES, at(4 * DAY))).toEqual(end);
    expect(clampWindowEnd(end, null, at(4 * DAY))).toEqual(end);
  });

  it("cuts a window that would run past the settle-by time", () => {
    // A 7-day NEEDS_HUMAN extension opened on day 24.
    expect(clampWindowEnd(at(-2 * DAY), EXPIRES, at(5 * DAY))).toEqual(at(DAY));
  });

  it("past the settle-by time, a window ends now", () => {
    const now = at(12 * HOUR);
    expect(clampWindowEnd(new Date(now.getTime() + DAY), EXPIRES, now)).toEqual(now);
  });
});
