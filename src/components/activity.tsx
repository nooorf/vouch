import type { schema } from "@/db";
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
