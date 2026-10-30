import { describe, expect, it } from "vitest";
import { demoBrief } from "./demo";
import { briefHash } from "./hash";
import { Brief } from "./schema";

describe("Brief schema", () => {
  it("accepts the demo brief", () => {
    expect(Brief.safeParse(demoBrief).success).toBe(true);
  });

  it("rejects milestones that do not add up to the total", () => {
    const bad = { ...demoBrief, totalCents: 39999 };
    expect(Brief.safeParse(bad).success).toBe(false);
  });

  it("rejects checks outside the library and bad check params", () => {
    const m = demoBrief.milestones[0];
    const unknownCheck = { ...demoBrief, milestones: [{ ...m, criteria: [{ ...m.criteria[0], checkId: "looks_good" }] }, ...demoBrief.milestones.slice(1)] };
    expect(Brief.safeParse(unknownCheck).success).toBe(false);
    const badParams = { ...demoBrief, milestones: [{ ...m, criteria: [{ kind: "check", id: "x", checkId: "min_sections", params: { min: "four" }, weight: 2 }] }, ...demoBrief.milestones.slice(1)] };
    expect(Brief.safeParse(badParams).success).toBe(false);
  });
});

describe("briefHash", () => {
  it("does not depend on key order", () => {
    const { terms, ...rest } = demoBrief;
    const reordered = { terms, ...rest };
    expect(briefHash(reordered)).toBe(briefHash(demoBrief));
  });

  it("changes when any amount changes", () => {
    const changed = structuredClone(demoBrief);
    changed.milestones[2].amountCents = 10001;
    changed.totalCents = 40001;
    expect(briefHash(changed)).not.toBe(briefHash(demoBrief));
  });
});
