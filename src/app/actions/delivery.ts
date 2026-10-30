"use server";

import { after } from "next/server";
import { AgreementError } from "@/lib/jobs/agreement";
import { submitDelivery } from "@/lib/jobs/delivery";
import { drainTasks } from "@/lib/jobs/runner";
import { requireUser } from "@/lib/session";

export async function submitDeliveryAction(jobId: string, milestoneId: string, url: string, repoUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    await submitDelivery(user.id, jobId, milestoneId, String(url ?? ""), String(repoUrl ?? ""));
  } catch (err) {
    if (err instanceof AgreementError) return { ok: false, error: err.message };
    console.error("[delivery]", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  // Check the delivery right after responding; page loads and the cron pick it up if this is cut short.
  after(() => drainTasks({ jobId }).catch((e) => console.error("[delivery] drain", e)));
  return { ok: true };
}
