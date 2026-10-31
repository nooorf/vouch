import type { NoticeRow } from "@/lib/notify";
import { Badge, Card } from "./ui";

const ago = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/** Notices addressed to the viewer, newest first. Unread ones are marked New (they're marked read once shown). */
export function Notices({ notices }: { notices: NoticeRow[] }) {
  if (!notices.length) return null;
  const unread = notices.filter((n) => !n.readAt).length;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">For you</h2>
        {unread > 0 && <Badge tone="brand">{unread} new</Badge>}
      </div>
      <ol className="mt-3 space-y-3">
        {notices.map((n) => (
          <li key={n.id} className="flex gap-3 text-sm">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-line" : "bg-brand"}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-pretty">
                {!n.readAt && <span className="sr-only">New: </span>}
                {n.title}
              </p>
              <p className="mt-0.5 text-pretty text-muted">{n.body}</p>
              <time dateTime={n.createdAt.toISOString()} className="text-xs text-muted">
                {ago(n.createdAt)}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
