import type { schema } from "@/db";
import { currentMilestone } from "@/lib/jobs/cancel-rules";
import { formatCents } from "@/lib/money";

/**
 * In-app notices for both sides, as pure functions: one set derived from ledger events (each
 * event becomes at most one notice per party), and timed reminders worked out from the job's
 * state. Wording is fixed text, not AI, so it is always accurate and costs nothing.
 */

type Event = Pick<typeof schema.events.$inferSelect, "id" | "type" | "source" | "payload">;
type Job = Pick<typeof schema.jobs.$inferSelect, "id" | "status" | "fundingExpiresAt" | "agreedAt" | "isDemo" | "reviewWindowSeconds">;
type Milestone = Pick<typeof schema.milestones.$inferSelect, "id" | "position" | "status" | "dueAt" | "reviewEndsAt">;

export type Party = "freelancer" | "client";

export interface Notice {
  party: Party;
  kind: string;
  title: string;
  body: string;
  dedupeKey: string;
}

export interface NoticeContext {
  job: Job;
  freelancer: string;
  client: string;
}

const when = (iso: unknown) =>
  typeof iso === "string" || iso instanceof Date
    ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"
    : "";
const money = (c: unknown) => (typeof c === "number" ? formatCents(c) : "");
const verdictWord: Record<string, string> = { PASS: "passed", PARTIAL: "partly passed", FAIL: "didn't pass", NEEDS_HUMAN: "needs a person to decide" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The notices one ledger event produces. */
export function noticesForEvent(e: Event, ctx: NoticeContext): Notice[] {
  const p = e.payload as Record<string, unknown>;
  const M = `M${p.position}`;
  const out: Notice[] = [];
  const to = (party: Party, title: string, body: string) => out.push({ party, kind: e.type, title, body, dedupeKey: `ev:${e.id}:${party}` });

  switch (e.type) {
    case "brief.sent":
      to("client", `New brief to review (v${p.version})`, `${ctx.freelancer} sent the brief. Accept it, or ask for changes in plain words.`);
      break;
    case "brief.changes_requested":
      to("freelancer", "The client asked for changes", `“${p.note}” Revise the brief and send the new version.`);
      break;
    case "brief.client_proposed":
      to("freelancer", `The client proposed v${p.version}`, "Accept it to lock the brief, or revise it and send your own version.");
      break;
    case "brief.agreed":
      if (e.source === "client") to("freelancer", "Brief agreed", `${cap(ctx.client)} accepted v${p.version}. Work starts once they fund the job with PayPal.`);
      else to("client", "Brief agreed: fund the job", `${ctx.freelancer} accepted v${p.version}. Fund it with PayPal${ctx.job.fundingExpiresAt ? ` by ${when(ctx.job.fundingExpiresAt)}` : ""}; the money is held, not sent.`);
      break;
    case "payment.authorized":
      to("freelancer", "Funded: you can start", `PayPal is holding ${money(p.amountCents)} for this job. Each milestone is paid when its delivery passes the agreed checks.`);
      break;
    case "job.expired":
      to("freelancer", "The agreement expired", "The client didn't fund the job in time. Nothing was charged.");
      to("client", "The agreement expired", "The job wasn't funded in time, so it expired. Nothing was charged.");
      break;
    case "delivery.submitted":
      to("client", `${M} delivered`, `${ctx.freelancer} submitted ${M}. Vouch is checking it against the agreed criteria; the result appears here.`);
      break;
    case "evaluation.completed": {
      const verdict = verdictWord[String(p.verdict)] ?? "was checked";
      const release = typeof p.releaseNowCents === "number" && p.releaseNowCents > 0 ? money(p.releaseNowCents) : null;
      to(
        "client",
        `${M} checked: it ${verdict}`,
        p.verdict === "NEEDS_HUMAN"
          ? "The check couldn't decide on its own. Look at the evidence and decide what to release."
          : `Review the evidence and approve or dispute. If you do nothing, ${release ? `${release} is released` : "nothing is released"} when the review window closes.`,
      );
      to("freelancer", `${M} checked: it ${verdict}`, release ? `${release} is released when the client's review window closes, unless they dispute.` : "See the fix list. You can resubmit once it's fixed.");
      break;
    }
    case "evaluation.failed":
      to("freelancer", `Couldn't check ${M}`, "Vouch will try again. If it keeps failing, check the delivery link works.");
      break;
    case "dispute.opened":
      to("freelancer", `The client disputed ${M}`, `“${p.note}” The AI is checking again with their objection.`);
      break;
    case "evaluation.rechecked": {
      const verdict = verdictWord[String(p.verdict)] ?? "was checked";
      to("client", `Re-check of ${M} done: it ${verdict}`, "You make the final call: release, release what the re-check earned, or hold.");
      to("freelancer", `Re-check of ${M} done: it ${verdict}`, "The client makes the final call.");
      break;
    }
    case "review.extended":
      to("client", `${M} needs your decision`, "Nothing is released until you decide. The window was extended once; if you stay silent, only the share backed by measured checks is released.");
      break;
    case "milestone.settled": {
      const delta = typeof p.releasedCents === "number" ? p.releasedCents : 0;
      if (delta > 0) to("freelancer", `${M}: ${money(delta)} released`, `${money(p.totalReleasedCents)} released for ${M} so far.`);
      if (String(p.how).startsWith("silence")) to("client", `${M} settled`, `Your review window closed, so the verdict executed: ${money(p.totalReleasedCents)} released for ${M}.`);
      break;
    }
    case "job.completed":
      to("freelancer", "Job completed", `You were paid ${money(p.releasedCents)}. The receipt has PayPal's transaction ids.`);
      to("client", "Job completed", `${money(p.releasedCents)} paid for delivered work${typeof p.returnedCents === "number" && p.returnedCents > 0 ? `; ${money(p.returnedCents)} released back to you` : ""}.`);
      break;
    case "job.cancel_requested":
      to("freelancer", "The client asked to cancel", `“${p.note}” Nothing changes unless you accept.`);
      break;
    case "job.cancel_withdrawn":
      to("freelancer", "Cancellation request withdrawn", "The client no longer wants to cancel. Carry on.");
      break;
    case "job.cancel_declined":
      to("client", "Cancellation declined", `${ctx.freelancer} wants to finish the job. If a deadline passes with nothing delivered, you can cancel after a grace period.`);
      break;
    case "job.cancelled": {
      const body = `${money(p.releasedCents)} stays with the freelancer; ${money(p.returningCents)} goes back to the client.`;
      if (p.by !== "client") to("client", "The job was cancelled", `${p.by === "both" ? `${ctx.freelancer} accepted your request.` : `${ctx.freelancer} cancelled.`} ${body}`);
      if (p.by === "client") to("freelancer", "The client cancelled the job", `${p.reason ?? "A deadline was missed."} ${body}`);
      break;
    }
    case "milestone.deadline_missed":
      to("freelancer", `${M}'s deadline passed`, `Deliver by ${when(p.graceEndsAt)}. After that the client can cancel or give you more time.`);
      to("client", `${M}'s deadline passed`, `${ctx.freelancer} has until ${when(p.graceEndsAt)} to deliver. After that you can cancel or extend the deadline.`);
      break;
    case "milestone.deadline_extended":
      to("freelancer", `More time for ${M}`, `The client gave you ${p.days} more ${p.days === 1 ? "day" : "days"}: ${M} is now due ${when(p.dueAt)}. Later milestones moved too.`);
      break;
    case "hold.ending_soon":
      for (const party of ["freelancer", "client"] as const) {
        to(party, "PayPal's hold ends soon", `It ends ${when(p.expiresAt)}. Anything still open on ${when(p.settleBy)} is settled automatically by the agreed rules.`);
      }
      break;
    case "hold.settling":
      for (const party of ["freelancer", "client"] as const) {
        to(party, "Settled before PayPal's hold ends", "Open reviews closed by the silence rule, and undelivered work was closed with its money going back to the client.");
      }
      break;
  }
  return out;
}

/** Timed reminders due now. Each has a dedupe key tied to the moment it's about, so it's sent once. */
export function dueReminders(job: Job, milestones: Milestone[], now: Date, ctx: NoticeContext, windowSeconds: number, graceSeconds: number): Notice[] {
  const out: Notice[] = [];
  const t = now.getTime();

  // Funding: 24 and 48 hours into the 72-hour window.
  if (job.status === "AGREED" && job.fundingExpiresAt && job.agreedAt) {
    for (const hours of [24, 48]) {
      if (t >= job.agreedAt.getTime() + hours * 3_600_000 && t < job.fundingExpiresAt.getTime()) {
        out.push({ party: "client", kind: "remind.fund", title: "Reminder: fund the job", body: `The agreed brief expires unless it's funded by ${when(job.fundingExpiresAt)}.`, dedupeKey: `remind:fund:${job.id}:${hours}` });
      }
    }
  }

  if (job.status !== "FUNDED" && job.status !== "IN_PROGRESS") return out;

  // Review windows: at the halfway point and shortly before they close.
  for (const m of milestones) {
    if (m.status !== "REVIEW_WINDOW" || !m.reviewEndsAt) continue;
    const end = m.reviewEndsAt.getTime();
    const half = end - (windowSeconds * 1000) / 2;
    const soon = end - Math.min(3_600_000, (windowSeconds * 1000) / 4);
    const key = `${m.id}:${end}`;
    if (t >= soon && t < end) {
      out.push({ party: "client", kind: "remind.review", title: `M${m.position}: review closes soon`, body: `The review window closes ${when(m.reviewEndsAt)}. If you do nothing, the verdict executes.`, dedupeKey: `remind:review-soon:${key}` });
    } else if (t >= half && t < end) {
      out.push({ party: "client", kind: "remind.review", title: `M${m.position}: half of the review window left`, body: `Approve or dispute by ${when(m.reviewEndsAt)}. If you do nothing, the verdict executes.`, dedupeKey: `remind:review-half:${key}` });
    }
  }

  // Deadlines: a day before, and when the grace period runs out.
  const current = currentMilestone(milestones);
  if (current?.dueAt && ["PENDING", "HELD", "PARTIAL_HELD"].includes(current.status)) {
    const due = current.dueAt.getTime();
    const key = `${current.id}:${due}`;
    if (t < due && t >= due - 24 * 3_600_000) {
      out.push({ party: "freelancer", kind: "remind.due", title: `M${current.position} is due within a day`, body: `Deliver by ${when(current.dueAt)}.`, dedupeKey: `remind:due:${key}` });
    }
    if (t >= due + graceSeconds * 1000) {
      out.push({ party: "client", kind: "remind.overdue", title: `M${current.position} is overdue`, body: "The grace period ended with nothing delivered. You can cancel the job or give more time.", dedupeKey: `remind:overdue:${key}:client` });
      out.push({ party: "freelancer", kind: "remind.overdue", title: `M${current.position} is overdue`, body: "The grace period has ended: the client can now cancel or extend. Delivering still counts if they haven't cancelled.", dedupeKey: `remind:overdue:${key}:freelancer` });
    }
  }
  return out;
}
