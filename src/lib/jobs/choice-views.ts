import type { schema } from "@/db";
import { formatCents } from "@/lib/money";
import { targetForChoice, type ClientChoice } from "@/lib/policy/policy";

type Milestone = typeof schema.milestones.$inferSelect;
type Evaluation = typeof schema.evaluations.$inferSelect;

/** Button labels and hints for the client's choices, with exact amounts from the server. */
export function choiceViews(m: Milestone, ev: Evaluation | null, choices: ClientChoice[]) {
  const amount = (c: ClientChoice) =>
    targetForChoice(c, { amountCents: m.amountCents, releasedCents: m.releasedCents, earnedCents: ev?.earnedCents ?? null, silenceReleaseCents: ev?.silenceReleaseCents ?? null }) -
    m.releasedCents;
  const inReview = m.status === "REVIEW_WINDOW" && ev?.verdict !== "NEEDS_HUMAN";
  return choices.map((c) => {
    switch (c) {
      case "release_all":
        return inReview
          ? { choice: c, primary: true, label: `Approve and release ${formatCents(amount(c))}`, hint: "You're happy with the delivery: pay the rest of this milestone now." }
          : { choice: c, primary: true, label: `Release ${formatCents(amount(c))}`, hint: "Pay the full remaining amount for this milestone." };
      case "release_earned":
        return { choice: c, label: `Release what the re-check earned (${formatCents(amount(c))})`, hint: "Pay what the second check says the delivery earned." };
      case "release_measured":
        return { choice: c, label: `Release the measured share (${formatCents(amount(c))})`, hint: "Pay only the part backed by measured checks that passed." };
      case "hold":
        return { choice: c, label: "Hold for a fix", hint: "Release nothing now. The freelancer can fix it and resubmit." };
      case "close":
        return { choice: c, label: `Close this milestone (${formatCents(m.amountCents - m.releasedCents)} back to you)`, hint: "End this milestone. What isn't released returns to you when the job ends." };
    }
  });
}
