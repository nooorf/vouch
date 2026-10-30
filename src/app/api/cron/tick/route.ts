import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { dueJobIds, tickJob } from "@/lib/jobs/tick";

/** Backup for jobs nobody is viewing. Called by a scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });

  const ids = await dueJobIds();
  const results: Record<string, string[]> = {};
  for (const id of ids) {
    try {
      results[id] = await tickJob(id);
    } catch (err) {
      results[id] = [`error: ${err instanceof Error ? err.message : String(err)}`];
    }
  }
  return Response.json({ checked: ids.length, results });
}
