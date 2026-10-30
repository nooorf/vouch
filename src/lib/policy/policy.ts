/**
 * Vouch policy engine. Pure functions only: no I/O, no clock, no LLM.
 * The AI fills in judged criterion results; this code alone decides money.
 *
 * Money is integer cents. Weights are small integers, so every split is exact.
 */

export type Verdict = "PASS" | "PARTIAL" | "FAIL" | "NEEDS_HUMAN";

export interface CriterionResult {
  id: string;
  label: string;
  kind: "check" | "judged";
  /** Integer 1..10. */
  weight: number;
  required: boolean;
  passed: boolean;
  /** Judged criteria only, 0..1. */
  confidence?: number;
  /**
   * Judged criteria only: did the evidence quote the model gave actually appear in the
   * fetched page text? A made-up quote counts as unverified.
   */
  evidenceVerified?: boolean;
  evidence: string;
  /**
   * Measured checks only: the check couldn't be measured (e.g. Lighthouse unavailable).
   * Counts as not passed, and sends the delivery to a person instead of deciding without it.
   */
  unmeasured?: boolean;
  /** Shown to the freelancer when this criterion fails. */
  fixHint?: string;
}

export interface PolicyConfig {
  /** Fraction (as passed/total weight) at or above this releases the full amount. */
  passRatio: [number, number];
  /** Fraction at or above this (and below pass) releases the earned share. */
  partialRatio: [number, number];
  /** Judged results below this confidence go to a human. */
  minConfidence: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  passRatio: [9, 10],
  partialRatio: [5, 10],
  minConfidence: 0.6,
};

export interface EvaluateInput {
  milestoneAmountCents: number;
  /** Already captured for this milestone by earlier attempts. Never clawed back. */
  alreadyReleasedCents: number;
  results: CriterionResult[];
  /** True when the suspicious_content check flagged the submission. */
  suspicious: boolean;
  config?: PolicyConfig;
}

export interface Evaluation {
  verdict: Verdict;
  /** What this attempt has earned in total for the milestone. */
  earnedCents: number;
  /** What to capture if the verdict executes: earned minus already released, never negative. */
  releaseNowCents: number;
  /** Amount still held for the milestone after releaseNow. */
  heldCents: number;
  /**
   * NEEDS_HUMAN only: what is released if the client stays silent through the extended window.
   * Backed by deterministic checks alone. Zero when the submission looked like an attack.
   */
  silenceReleaseCents: number;
  passedWeight: number;
  totalWeight: number;
  reasons: string[];
  fixList: string[];
}

function assertCents(name: string, v: number) {
  if (!Number.isInteger(v) || v < 0) throw new Error(`${name} must be non-negative integer cents, got ${v}`);
}

function atLeast(num: number, den: number, [rn, rd]: [number, number]) {
  // num/den >= rn/rd, in integers
  return num * rd >= rn * den;
}

/** floor(amount * num / den) without floats. */
function share(amountCents: number, num: number, den: number) {
  if (den === 0) return 0;
  return Math.floor((amountCents * num) / den);
}

export function evaluate(input: EvaluateInput): Evaluation {
  const config = input.config ?? DEFAULT_POLICY;
  const { milestoneAmountCents: amount, alreadyReleasedCents: released, results } = input;
  assertCents("milestoneAmountCents", amount);
  assertCents("alreadyReleasedCents", released);
  if (released > amount) throw new Error("alreadyReleasedCents exceeds milestone amount");
  if (results.length === 0) throw new Error("A milestone needs at least one criterion");
  for (const r of results) {
    if (!Number.isInteger(r.weight) || r.weight < 1 || r.weight > 10) {
      throw new Error(`Criterion ${r.id} weight must be an integer 1..10`);
    }
  }

  const reasons: string[] = [];
  const fixList = results.filter((r) => !r.passed).map((r) => r.fixHint ?? `Fix: ${r.label}`);

  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  const passedWeight = results.filter((r) => r.passed).reduce((s, r) => s + r.weight, 0);
  const checks = results.filter((r) => r.kind === "check");
  const passedCheckWeight = checks.filter((r) => r.passed).reduce((s, r) => s + r.weight, 0);

  const unmeasured = checks.filter((r) => r.unmeasured);
  const requiredCheckFailed = checks.some((r) => r.required && !r.passed && !r.unmeasured);
  const uncertainJudged = results.filter(
    (r) =>
      r.kind === "judged" &&
      ((r.confidence ?? 0) < config.minConfidence || r.evidenceVerified === false),
  );
  const requiredJudgedFailedConfidently = results.some(
    (r) => r.kind === "judged" && r.required && !r.passed && !uncertainJudged.includes(r),
  );

  // Deterministic floor: the share backed by measured checks only.
  const floorCents = requiredCheckFailed ? 0 : share(amount, passedCheckWeight, totalWeight);

  const finish = (verdict: Verdict, earnedCents: number, silenceReleaseCents = 0): Evaluation => {
    const earned = Math.max(earnedCents, released); // monotonic: money already released stays released
    const releaseNowCents = verdict === "NEEDS_HUMAN" ? 0 : earned - released;
    return {
      verdict,
      earnedCents: earned,
      releaseNowCents,
      heldCents: amount - released - releaseNowCents,
      silenceReleaseCents: verdict === "NEEDS_HUMAN" ? Math.max(0, silenceReleaseCents - released) : 0,
      passedWeight,
      totalWeight,
      reasons,
      fixList,
    };
  };

  // 1. A required measured check failed: nothing more is earned, whatever the AI said.
  if (requiredCheckFailed) {
    for (const r of checks.filter((c) => c.required && !c.passed)) {
      reasons.push(`Required check failed: ${r.label}`);
    }
    if (input.suspicious) reasons.push("Submission also flagged as suspicious");
    return finish("FAIL", 0);
  }

  // 2. Possible attempt to manipulate the grader: a human decides, silence releases nothing.
  if (input.suspicious) {
    reasons.push("Submission contains content aimed at the AI grader; a human must decide");
    return finish("NEEDS_HUMAN", 0, 0);
  }

  // 3. A check couldn't be measured, or the AI is unsure or quoted evidence that is not on the
  //    page: a human decides, and silence releases only what passing measured checks back.
  if (uncertainJudged.length > 0 || unmeasured.length > 0) {
    for (const r of unmeasured) reasons.push(`Couldn't measure "${r.label}"`);
    for (const r of uncertainJudged) {
      reasons.push(
        r.evidenceVerified === false
          ? `AI evidence for "${r.label}" was not found in the delivery`
          : `AI confidence for "${r.label}" is below ${config.minConfidence}`,
      );
    }
    return finish("NEEDS_HUMAN", 0, floorCents);
  }

  // 4. A required judged criterion failed with confidence.
  if (requiredJudgedFailedConfidently) {
    for (const r of results.filter((x) => x.kind === "judged" && x.required && !x.passed)) {
      reasons.push(`Required criterion failed: ${r.label}`);
    }
    return finish("FAIL", 0);
  }

  // 5. Thresholds.
  if (atLeast(passedWeight, totalWeight, config.passRatio)) {
    reasons.push(`Score ${passedWeight}/${totalWeight} meets the pass bar`);
    return finish("PASS", amount);
  }
  if (atLeast(passedWeight, totalWeight, config.partialRatio)) {
    reasons.push(`Score ${passedWeight}/${totalWeight}: partial release of the earned share`);
    return finish("PARTIAL", share(amount, passedWeight, totalWeight));
  }
  reasons.push(`Score ${passedWeight}/${totalWeight} is below the partial bar`);
  return finish("FAIL", 0);
}

/* ------------------------------------------------------------------ */
/* Review window: what happens when it closes                          */
/* ------------------------------------------------------------------ */

export type ClientAction =
  | { type: "none" }
  | { type: "approve" }
  | { type: "dispute"; criterionIds: string[] }
  /** Client's final call after a dispute or NEEDS_HUMAN: release this total for the milestone. */
  | { type: "decide"; releaseTotalCents: number };

export type WindowOutcome =
  | { action: "capture"; amountCents: number; reason: string }
  | { action: "hold"; reason: string }
  | { action: "extend"; hours: number; reason: string }
  | { action: "reevaluate"; criterionIds: string[]; reason: string };

export interface WindowInput {
  evaluation: Evaluation;
  milestoneAmountCents: number;
  alreadyReleasedCents: number;
  clientAction: ClientAction;
  /** True once a NEEDS_HUMAN window has already been extended. */
  alreadyExtended: boolean;
  /** True once the one AI re-evaluation after a dispute has happened. */
  alreadyReevaluated: boolean;
  extensionHours?: number;
}

export function resolveWindow(input: WindowInput): WindowOutcome {
  const { evaluation: ev, clientAction: act, milestoneAmountCents: amount } = input;
  const released = input.alreadyReleasedCents;
  const remaining = amount - released;

  switch (act.type) {
    case "approve":
      // Approval releases the full milestone, whatever the verdict. The client is the human override.
      return remaining > 0
        ? { action: "capture", amountCents: remaining, reason: "Client approved" }
        : { action: "hold", reason: "Client approved; nothing left to release" };

    case "decide": {
      assertCents("releaseTotalCents", act.releaseTotalCents);
      const target = Math.min(act.releaseTotalCents, amount);
      const delta = target - released;
      return delta > 0
        ? { action: "capture", amountCents: delta, reason: "Client decision" }
        : { action: "hold", reason: "Client decision: release nothing more" };
    }

    case "dispute":
      if (act.criterionIds.length === 0) {
        throw new Error("A dispute must name at least one criterion");
      }
      if (!input.alreadyReevaluated) {
        return { action: "reevaluate", criterionIds: act.criterionIds, reason: "Client disputed; one AI re-evaluation" };
      }
      return { action: "hold", reason: "Dispute open; waiting for the client's final decision" };

    case "none":
      if (ev.verdict === "NEEDS_HUMAN") {
        if (!input.alreadyExtended) {
          return { action: "extend", hours: input.extensionHours ?? 24 * 7, reason: "Needs a human; window extended once" };
        }
        return ev.silenceReleaseCents > 0
          ? { action: "capture", amountCents: ev.silenceReleaseCents, reason: "Client silent; releasing the share backed by measured checks" }
          : { action: "hold", reason: "Client silent; nothing is backed by measured checks" };
      }
      return ev.releaseNowCents > 0
        ? { action: "capture", amountCents: ev.releaseNowCents, reason: `Client silent; ${ev.verdict} verdict executes` }
        : { action: "hold", reason: `Client silent; ${ev.verdict} verdict releases nothing` };
  }
}

/* ------------------------------------------------------------------ */
/* Authorization guard: the last check before any PayPal capture        */
/* ------------------------------------------------------------------ */

export function assertCaptureAllowed(p: {
  authorizedCents: number;
  capturedCents: number;
  captureCents: number;
}) {
  assertCents("authorizedCents", p.authorizedCents);
  assertCents("capturedCents", p.capturedCents);
  assertCents("captureCents", p.captureCents);
  if (p.captureCents === 0) throw new Error("Refusing a zero capture");
  if (p.capturedCents + p.captureCents > p.authorizedCents) {
    throw new Error(
      `Capture of ${p.captureCents} would exceed the authorization (${p.capturedCents} of ${p.authorizedCents} already captured)`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Milestone status after money moves                                   */
/* ------------------------------------------------------------------ */

export type SettledStatus = "RELEASED" | "PARTIAL_HELD" | "HELD";

/** Where a milestone stands once its released total is known. */
export function statusAfterRelease(amountCents: number, releasedCents: number): SettledStatus {
  if (releasedCents >= amountCents) return "RELEASED";
  return releasedCents > 0 ? "PARTIAL_HELD" : "HELD";
}

export type ClientChoice = "release_all" | "release_earned" | "release_measured" | "hold" | "close";

/**
 * The released total a client's choice leads to, from server-side numbers only.
 * Never below what's already released (money isn't clawed back) or above the milestone.
 */
export function targetForChoice(
  choice: ClientChoice,
  p: { amountCents: number; releasedCents: number; earnedCents: number | null; silenceReleaseCents: number | null },
): number {
  const clamp = (v: number) => Math.min(p.amountCents, Math.max(p.releasedCents, v));
  switch (choice) {
    case "release_all":
      return p.amountCents;
    case "release_earned":
      return clamp(p.earnedCents ?? p.releasedCents);
    case "release_measured":
      return clamp(p.releasedCents + (p.silenceReleaseCents ?? 0));
    case "hold":
    case "close":
      return p.releasedCents;
  }
}

/**
 * PayPal-Request-Id for a milestone capture. `seq` is how many captures this milestone already
 * has. Write the pending payment row with this id before calling PayPal, so a retry after a
 * crash or timeout reuses the id and PayPal returns the original capture instead of a new one.
 */
export function captureRequestId(milestoneId: string, seq: number) {
  if (!Number.isInteger(seq) || seq < 0) throw new Error("seq must be a non-negative integer");
  return `vouch-cap-${milestoneId}-${seq}`;
}
