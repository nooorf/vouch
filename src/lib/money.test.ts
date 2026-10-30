import { describe, expect, it } from "vitest";
import { formatCents, returnedCents, splitMoney } from "./money";

describe("formatCents", () => {
  it("drops .00 for whole dollars and keeps cents otherwise", () => {
    expect(formatCents(15000)).toBe("$150");
    expect(formatCents(6666)).toBe("$66.66");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(0)).toBe("$0");
  });

  it("rejects fractional cents", () => {
    expect(() => formatCents(10.5)).toThrow();
  });
});

describe("splitMoney", () => {
  it("splits a partly released job", () => {
    expect(splitMoney({ totalCents: 40000, authorizedCents: 40000, releasedCents: 24000 })).toEqual({
      releasedCents: 24000, heldCents: 16000, returnedCents: 0, unfundedCents: 0, totalCents: 40000,
    });
  });

  it("shows an unfunded job as all unfunded", () => {
    expect(splitMoney({ totalCents: 40000, authorizedCents: 0, releasedCents: 0 })).toMatchObject({
      heldCents: 0, unfundedCents: 40000,
    });
  });

  it("shows a voided remainder as returned, not held", () => {
    expect(splitMoney({ totalCents: 45000, authorizedCents: 45000, releasedCents: 21000, returnedCents: 24000 })).toEqual({
      releasedCents: 21000, heldCents: 0, returnedCents: 24000, unfundedCents: 0, totalCents: 45000,
    });
    expect(returnedCents({ status: "COMPLETED", authorizedCents: 45000, capturedCents: 21000 })).toBe(24000);
    expect(returnedCents({ status: "IN_PROGRESS", authorizedCents: 45000, capturedCents: 21000 })).toBe(0);
  });

  it("always adds up, even with inconsistent input", () => {
    const s = splitMoney({ totalCents: 40000, authorizedCents: 10000, releasedCents: 50000 });
    expect(s.releasedCents + s.heldCents + s.unfundedCents).toBe(40000);
    expect(s.releasedCents).toBe(40000);
  });
});
