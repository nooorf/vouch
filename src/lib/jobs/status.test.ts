import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./status";

describe("job status transitions", () => {
  it("allows the negotiation loop", () => {
    expect(canTransition("DRAFT", "PROPOSED")).toBe(true);
    expect(canTransition("PROPOSED", "DRAFT")).toBe(true);
    expect(canTransition("PROPOSED", "AGREED")).toBe(true);
    expect(canTransition("AGREED", "FUNDED")).toBe(true);
  });

  it("refuses skipping agreement or reopening finished jobs", () => {
    expect(canTransition("DRAFT", "AGREED")).toBe(false);
    expect(canTransition("DRAFT", "FUNDED")).toBe(false);
    expect(canTransition("AGREED", "DRAFT")).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(() => assertTransition("FUNDED", "PROPOSED")).toThrow(/FUNDED to PROPOSED/);
  });
});
