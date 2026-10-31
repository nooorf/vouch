import type { schema } from "@/db";
import { formatCents } from "@/lib/money";
import { targetForChoice, type ClientChoice } from "@/lib/policy/policy";
import { awaitingClientDecision, canGiveTry, CLIENT_EXTRA_TRIES } from "./tries";

type Milestone = typeof schema.milestones.$inferSelect;
type Evaluation = typeof schema.evaluations.$inferSelect;

/** Which choices the client has right now for a milestone. */
export function choicesFor(m: Milestone, ev: Evaluation | undefined, maxResubmissions: number): ClientChoice[] {
  if (m.status === "REVIEW_WINDOW" && ev?.status === "done") {
    return ev.verdict === "NEEDS_HUMAN" ? ["release_all", "release_measured", "hold"] : ["release_all"];
  }
  if (m.status === "DISPUTED" && m.reevaluated && ev?.status === "done") return ["release_all", "release_earned", "hold"];
  // Every try used: only the client moves things on. Nothing opens the next milestone by itself.
  if (awaitingClientDecision(m, maxResubmissions)) {
    return [...(canGiveTry(m, maxResubmissions) ? (["another_try"] as const) : []), "release_all", "close", "end_project"];
  }
  // Held after a partial or failed check while the freelancer still has tries: they can fix it, or
  // the client can pay the rest or skip the milestone (its unreleased money goes back when the job ends).
  if (m.status === "HELD" || m.status === "PARTIAL_HELD") return ["release_all", "close"];
  return [];
}

/** Button labels and hints for the client's choices, with exact amounts from the server. */
export function choiceViews(m: Milestone, ev: Evaluation | null, choices: ClientChoice[], ctx: { freelancer: string; refundCents: number }) {
  const amount = (c: ClientChoice) =>
    targetForChoice(c, { amountCents: m.amountCents, releasedCents: m.releasedCents, earnedCents: ev?.earnedCents ?? null, silenceReleaseCents: ev?.silenceReleaseCents ?? null }) -
    m.releasedCents;
  const inReview = m.status === "REVIEW_WINDOW" && ev?.verdict !== "NEEDS_HUMAN";
  // The freelancer is out of tries: these choices are what moves the job on.
  const deciding = choices.includes("end_project");
  return choices.map((c) => {
    switch (c) {
      case "release_all":
        return inReview
          ? { choice: c, primary: true, label: `Approve and release ${formatCents(amount(c))}`, hint: "You're happy with the delivery: pay the rest of this milestone now." }
          : deciding
            ? { choice: c, label: `Accept as is and release ${formatCents(amount(c))}`, hint: "Pay the rest of this milestone and move on to the next one." }
            : { choice: c, primary: true, label: `Release ${formatCents(amount(c))}`, hint: "Pay the full remaining amount for this milestone." };
      case "release_earned":
        return { choice: c, label: `Release what the re-check earned (${formatCents(amount(c))})`, hint: "Pay what the second check says the delivery earned." };
      case "release_measured":
        return { choice: c, label: `Release the measured share (${formatCents(amount(c))})`, hint: "Pay only the part backed by measured checks that passed." };
      case "hold":
        return { choice: c, label: "Hold for a fix", hint: "Release nothing now. The freelancer can fix it and resubmit." };
      case "close":
        return {
          choice: c,
          label: `Skip this milestone (${formatCents(m.amountCents - m.releasedCents)} back to you)`,
          hint: "Don't pay the rest of it, and move on to the next milestone. The money returns to you when the job ends.",
        };
      case "another_try": {
        const left = CLIENT_EXTRA_TRIES - m.extraTries;
        return {
          choice: c,
          primary: true,
          label: `Give ${ctx.freelancer} another try`,
          hint: `They fix it and resubmit; nothing is paid until a delivery passes or you accept it. You can give ${left} more ${left === 1 ? "try" : "tries"} for this milestone.`,
        };
      }
      case "end_project":
        return {
          choice: c,
          label: `End the project (${formatCents(ctx.refundCents)} back to you)`,
          hint: "Stop here. Everything not yet paid goes back to you, and later milestones don't start.",
        };
    }
  });
}
