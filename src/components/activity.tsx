import type { schema } from "@/db";
import { formatCents } from "@/lib/money";
import { Card } from "./ui";

type Event = typeof schema.events.$inferSelect;

const who: Record<Event["source"], string> = {
  freelancer: "Freelancer",
  client: "Client",
  ai: "AI",
  paypal: "PayPal",
  app: "Vouch",
  system: "Vouch",
};

const money = (c: unknown) => (typeof c === "number" ? formatCents(c) : "");

/** A verified PayPal webhook, worded as what PayPal confirmed. */
function webhookText(p: Record<string, unknown>): string {
  const amount = money(p.amountCents);
  const text: Record<string, string> = {
    "CHECKOUT.ORDER.APPROVED": "confirmed the client approved the checkout",
    "PAYMENT.AUTHORIZATION.CREATED": `confirmed the ${amount} hold`,
    "PAYMENT.AUTHORIZATION.VOIDED": "confirmed the rest of the hold was released back to the client",
    "PAYMENT.CAPTURE.COMPLETED": `confirmed the ${amount} capture`,
    "PAYMENT.CAPTURE.DENIED": `denied the ${amount} capture`,
    "PAYMENT.CAPTURE.REFUNDED": `refunded ${amount} to the client`,
  };
  const what = text[String(p.eventType)] ?? `sent ${String(p.eventType)}`;
  return `${what} (webhook, signature verified)${p.error ? `. Not applied: ${p.error}` : ""}`;
}

function describe(e: Event): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "job.created":
      return "created the job";
    case "brief.drafted":
      return `drafted brief v${p.version ?? 1}${p.model ? ` (${p.model})` : ""}`;
    case "brief.edited":
      return `edited brief v${p.version}`;
    case "brief.sent":
      return `sent brief v${p.version} and accepted it`;
    case "brief.accepted":
      return `accepted brief v${p.version}`;
    case "brief.changes_requested":
      return `asked for changes to v${p.version}: “${p.note}”`;
    case "brief.client_proposed":
      return `proposed v${p.version} with AI-drafted edits: “${p.note}”`;
    case "brief.revising":
      return `started revising the client's v${p.from}`;
    case "payment.order_created":
      return `opened PayPal checkout for ${money(p.amountCents)}`;
    case "payment.authorization_pending":
      return "is reviewing the payment";
    case "payment.authorized":
      return `authorized ${money(p.amountCents)}. The money is held, not captured.`;
    case "job.expired":
      return "expired the agreement: it wasn't funded in time";
    case "delivery.submitted":
      return `submitted M${p.position} (attempt ${p.attempt}): ${p.url}`;
    case "evaluation.completed":
      return `checked M${p.position}: ${String(p.verdict).replace("_", " ").toLowerCase()}${typeof p.releaseNowCents === "number" && p.releaseNowCents > 0 ? `, ${money(p.releaseNowCents)} to release` : ""}${p.suspicious ? " (flagged: instructions aimed at the AI)" : ""}`;
    case "evaluation.failed":
      return `couldn't finish checking M${p.position}: ${p.error}`;
    case "payment.captured":
      return `captured ${money(p.amountCents)}: released to the freelancer`;
    case "payment.capture_failed":
      return `couldn't capture ${money(p.amountCents)}${p.issue ? ` (${p.issue})` : ""}; nothing was charged`;
    case "payment.reauthorized":
      return `reauthorized the hold for ${money(p.amountCents)} after the 3-day honor period`;
    case "milestone.settled":
      return `settled M${p.position} (${String(p.how).replace("client: ", "client chose ").replace(/_/g, " ")}): ${money(p.totalReleasedCents)} released so far`;
    case "review.extended":
      return `extended M${p.position}'s review window once, because a person needs to decide`;
    case "dispute.opened":
      return `disputed M${p.position}: “${p.note}”`;
    case "evaluation.rechecked":
      return `re-checked M${p.position} after the dispute: ${String(p.verdict).replace("_", " ").toLowerCase()}`;
    case "job.completed":
      return `completed the job: ${money(p.releasedCents)} released${typeof p.returnedCents === "number" && p.returnedCents > 0 ? `, ${money(p.returnedCents)} returned to the client` : ""}`;
    case "job.cancel_requested":
      return `asked to cancel the job: “${p.note}”`;
    case "job.cancel_withdrawn":
      return "withdrew the request to cancel";
    case "job.cancel_declined":
      return "declined the request to cancel and kept working";
    case "job.cancelled":
      return `${p.by === "both" ? "agreed to cancel" : "cancelled"} the job${p.reason ? ` (${p.reason})` : ""}: ${money(p.releasedCents)} stays with the freelancer, ${money(p.returningCents)} goes back to the client`;
    case "payment.voided":
      return `released the unused ${money(p.amountCents)} hold back to the client`;
    case "milestone.deadline_missed":
      return `noted that M${p.position}'s deadline passed with nothing delivered; a grace period started`;
    case "milestone.deadline_extended":
      return `gave ${p.days} more ${p.days === 1 ? "day" : "days"} for M${p.position}`;
    case "demo.skipped_to_deadline":
      return `skipped ahead to M${p.position}'s deadline (demo)`;
    case "paypal.webhook":
      return webhookText(p);
    case "brief.agreed":
      return `accepted brief v${p.version}. Both sides agreed on the same version.`;
    default:
      return e.type;
  }
}

/** The audit ledger, newest first. */
export function Activity({ events }: { events: Event[] }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Activity</h2>
      <ol className="mt-3 space-y-3">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-unfunded" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-pretty">
                <span className="font-medium">{who[e.source]}</span> {describe(e)}
              </p>
              <time dateTime={e.createdAt.toISOString()} className="text-xs text-muted">
                {e.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
              </time>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
