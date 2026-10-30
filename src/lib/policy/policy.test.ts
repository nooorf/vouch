import { describe, expect, it } from "vitest";
import {
  statusAfterRelease,
  targetForChoice,
  assertCaptureAllowed,
  captureRequestId,
  evaluate,
  resolveWindow,
  type CriterionResult,
} from "./policy";

const check = (id: string, passed: boolean, weight = 2, required = false): CriterionResult => ({
  id, label: id, kind: "check", weight, required, passed, evidence: "", fixHint: `fix ${id}`,
});
const judged = (
  id: string, passed: boolean, confidence = 0.9, weight = 2, required = false, evidenceVerified = true,
): CriterionResult => ({
  id, label: id, kind: "judged", weight, required, passed, confidence, evidenceVerified, evidence: "quote",
});

const base = { milestoneAmountCents: 15000, alreadyReleasedCents: 0, suspicious: false };

describe("evaluate: thresholds", () => {
  it("PASS releases the full amount at 9/10 or more", () => {
    const ev = evaluate({ ...base, results: [check("a", true, 9), check("b", false, 1)] });
    expect(ev.verdict).toBe("PASS");
    expect(ev.releaseNowCents).toBe(15000);
    expect(ev.heldCents).toBe(0);
  });

  it("demo M2: Site B passes 6/10 weight, releases $90 of $150 and holds $60", () => {
    const ev = evaluate({
      ...base,
      results: [
        check("viewport_meta", false, 2),
        check("img_alt_ratio", false, 2),
        check("responsive_css", true, 2),
        check("lighthouse_a11y", true, 2),
        judged("layout_fits_mobile", true, 0.85, 2),
      ],
    });
    expect(ev.verdict).toBe("PARTIAL");
    expect(ev.releaseNowCents).toBe(9000);
    expect(ev.heldCents).toBe(6000);
    expect(ev.fixList).toEqual(["fix viewport_meta", "fix img_alt_ratio"]);
  });

  it("FAIL below 5/10 releases nothing", () => {
    const ev = evaluate({ ...base, results: [check("a", true, 4), check("b", false, 6)] });
    expect(ev.verdict).toBe("FAIL");
    expect(ev.releaseNowCents).toBe(0);
    expect(ev.heldCents).toBe(15000);
  });

  it("rounds partial shares down to the cent with integer math", () => {
    // 2/3 of $100.00 = 6666.67 cents -> 6666
    const ev = evaluate({
      ...base, milestoneAmountCents: 10000,
      results: [check("a", true, 1), check("b", true, 1), check("c", false, 1)],
    });
    expect(ev.verdict).toBe("PARTIAL");
    expect(ev.releaseNowCents).toBe(6666);
    expect(ev.heldCents).toBe(3334);
  });
});

describe("evaluate: guardrails", () => {
  it("a failed required check means FAIL even if the AI loves it", () => {
    const ev = evaluate({
      ...base,
      results: [check("http_ok", false, 1, true), judged("copy", true, 0.99, 9)],
    });
    expect(ev.verdict).toBe("FAIL");
    expect(ev.releaseNowCents).toBe(0);
    expect(ev.reasons[0]).toMatch(/Required check failed/);
  });

  it("suspicious content goes to a human and silence releases nothing", () => {
    const ev = evaluate({ ...base, suspicious: true, results: [check("a", true, 5), judged("b", true, 0.99, 5)] });
    expect(ev.verdict).toBe("NEEDS_HUMAN");
    expect(ev.releaseNowCents).toBe(0);
    expect(ev.silenceReleaseCents).toBe(0);
  });

  it("low AI confidence goes to a human; silence releases only the measured share", () => {
    const ev = evaluate({ ...base, results: [check("a", true, 6), judged("b", true, 0.4, 4)] });
    expect(ev.verdict).toBe("NEEDS_HUMAN");
    expect(ev.releaseNowCents).toBe(0);
    expect(ev.silenceReleaseCents).toBe(9000); // 6/10 of $150
  });

  it("an evidence quote not found on the page is treated as unverified", () => {
    const ev = evaluate({ ...base, results: [check("a", true, 5), judged("b", true, 0.95, 5, false, false)] });
    expect(ev.verdict).toBe("NEEDS_HUMAN");
    expect(ev.reasons[0]).toMatch(/not found on the page/);
  });

  it("a check that couldn't be measured goes to a human, never counts as a pass", () => {
    const ev = evaluate({
      ...base,
      results: [check("a", true, 6), { ...check("lighthouse", false, 4, true), unmeasured: true }],
    });
    expect(ev.verdict).toBe("NEEDS_HUMAN");
    expect(ev.reasons).toEqual(['Couldn\'t measure "lighthouse"']);
    expect(ev.silenceReleaseCents).toBe(9000); // only the 6/10 backed by a passing check
  });

  it("a confidently failed required judged criterion is FAIL", () => {
    const ev = evaluate({ ...base, results: [check("a", true, 8), judged("b", false, 0.9, 2, true)] });
    expect(ev.verdict).toBe("FAIL");
  });

  it("rejects bad inputs", () => {
    expect(() => evaluate({ ...base, results: [] })).toThrow();
    expect(() => evaluate({ ...base, results: [check("a", true, 0)] })).toThrow();
    expect(() => evaluate({ ...base, milestoneAmountCents: 10.5, results: [check("a", true)] })).toThrow();
    expect(() => evaluate({ ...base, alreadyReleasedCents: 20000, results: [check("a", true)] })).toThrow();
  });
});

describe("evaluate: resubmissions", () => {
  it("releases only the difference after an earlier partial release", () => {
    const ev = evaluate({ ...base, alreadyReleasedCents: 9000, results: [check("a", true, 10)] });
    expect(ev.verdict).toBe("PASS");
    expect(ev.releaseNowCents).toBe(6000);
    expect(ev.heldCents).toBe(0);
  });

  it("never claws back money if a resubmission scores worse", () => {
    const ev = evaluate({ ...base, alreadyReleasedCents: 9000, results: [check("a", false, 10)] });
    expect(ev.verdict).toBe("FAIL");
    expect(ev.releaseNowCents).toBe(0);
    expect(ev.earnedCents).toBe(9000);
    expect(ev.heldCents).toBe(6000);
  });
});

describe("resolveWindow", () => {
  const partial = evaluate({ ...base, results: [check("a", true, 6), check("b", false, 4)] });
  const human = evaluate({ ...base, results: [check("a", true, 6), judged("b", true, 0.3, 4)] });
  const w = { milestoneAmountCents: 15000, alreadyReleasedCents: 0, alreadyExtended: false, alreadyReevaluated: false };

  it("silence executes the verdict", () => {
    expect(resolveWindow({ ...w, evaluation: partial, clientAction: { type: "none" } }))
      .toMatchObject({ action: "capture", amountCents: 9000 });
  });

  it("approve releases everything left, even over a PARTIAL verdict", () => {
    expect(resolveWindow({ ...w, evaluation: partial, clientAction: { type: "approve" } }))
      .toMatchObject({ action: "capture", amountCents: 15000 });
  });

  it("NEEDS_HUMAN: first silence extends, second releases the measured share", () => {
    expect(resolveWindow({ ...w, evaluation: human, clientAction: { type: "none" } }).action).toBe("extend");
    expect(resolveWindow({ ...w, alreadyExtended: true, evaluation: human, clientAction: { type: "none" } }))
      .toMatchObject({ action: "capture", amountCents: 9000 });
  });

  it("dispute triggers one re-evaluation, then waits for the client", () => {
    const d = { type: "dispute" as const, criterionIds: ["a"] };
    expect(resolveWindow({ ...w, evaluation: partial, clientAction: d }).action).toBe("reevaluate");
    expect(resolveWindow({ ...w, alreadyReevaluated: true, evaluation: partial, clientAction: d }).action).toBe("hold");
    expect(() => resolveWindow({ ...w, evaluation: partial, clientAction: { type: "dispute", criterionIds: [] } })).toThrow();
  });

  it("client decision captures only the difference and is capped at the milestone", () => {
    expect(resolveWindow({ ...w, alreadyReleasedCents: 9000, evaluation: partial, clientAction: { type: "decide", releaseTotalCents: 99999 } }))
      .toMatchObject({ action: "capture", amountCents: 6000 });
    expect(resolveWindow({ ...w, alreadyReleasedCents: 9000, evaluation: partial, clientAction: { type: "decide", releaseTotalCents: 5000 } }).action)
      .toBe("hold");
  });
});

describe("statusAfterRelease and targetForChoice", () => {
  it("names the milestone state from its released total", () => {
    expect(statusAfterRelease(21000, 21000)).toBe("RELEASED");
    expect(statusAfterRelease(21000, 18000)).toBe("PARTIAL_HELD");
    expect(statusAfterRelease(21000, 0)).toBe("HELD");
  });

  it("turns a client choice into a released total, never clawing back or overpaying", () => {
    const p = { amountCents: 21000, releasedCents: 6000, earnedCents: 18000, silenceReleaseCents: 4000 };
    expect(targetForChoice("release_all", p)).toBe(21000);
    expect(targetForChoice("release_earned", p)).toBe(18000);
    expect(targetForChoice("release_measured", p)).toBe(10000);
    expect(targetForChoice("hold", p)).toBe(6000);
    expect(targetForChoice("close", p)).toBe(6000);
    expect(targetForChoice("release_earned", { ...p, earnedCents: 1000 })).toBe(6000);
    expect(targetForChoice("release_measured", { ...p, silenceReleaseCents: 99999 })).toBe(21000);
  });
});

describe("capture guards", () => {
  it("never captures above the authorized total", () => {
    expect(() => assertCaptureAllowed({ authorizedCents: 40000, capturedCents: 30000, captureCents: 10000 })).not.toThrow();
    expect(() => assertCaptureAllowed({ authorizedCents: 40000, capturedCents: 30000, captureCents: 10001 })).toThrow();
    expect(() => assertCaptureAllowed({ authorizedCents: 40000, capturedCents: 0, captureCents: 0 })).toThrow();
  });

  it("request ids are deterministic", () => {
    expect(captureRequestId("m1", 0)).toBe(captureRequestId("m1", 0));
    expect(captureRequestId("m1", 0)).not.toBe(captureRequestId("m1", 1));
  });
});
