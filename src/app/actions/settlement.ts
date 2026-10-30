"use server";

import { after } from "next/server";
import { AgreementError, findJobByClientToken } from "@/lib/jobs/agreement";
import { drainTasks } from "@/lib/jobs/runner";
import { clientDecide, clientDispute } from "@/lib/jobs/settle";
import type { ClientChoice } from "@/lib/policy/policy";

type Result = { ok: true } | { ok: false; error: string };
const CHOICES: ClientChoice[] = ["release_all", "release_earned", "release_measured", "hold", "close"];

function fail(err: unknown): Result {
  if (err instanceof AgreementError) return { ok: false, error: err.message };
  console.error("[settlement]", err);
  return { ok: false, error: "Something went wrong. Nothing was charged. Please try again." };
}

export async function decideMilestone(token: string, milestoneId: string, choice: string): Promise<Result> {
  if (!CHOICES.includes(choice as ClientChoice)) return { ok: false, error: "Unknown option." };
  try {
    await clientDecide(token, milestoneId, choice as ClientChoice);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function disputeMilestone(token: string, milestoneId: string, criterionIds: string[], note: string): Promise<Result> {
  try {
    await clientDispute(token, milestoneId, Array.isArray(criterionIds) ? criterionIds.map(String) : [], String(note ?? ""));
  } catch (err) {
    return fail(err);
  }
  const job = await findJobByClientToken(token);
  if (job) after(() => drainTasks({ jobId: job.id }).catch((e) => console.error("[settlement] drain", e)));
  return { ok: true };
}
