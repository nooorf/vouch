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
