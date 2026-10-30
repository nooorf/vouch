"use server";

import { redirect } from "next/navigation";
import { AgreementError, clientAccept, clientRequestChanges, sendBrief } from "@/lib/jobs/agreement";
import { requireUser } from "@/lib/session";

export type ActionResult = { ok: true; agreed?: boolean } | { ok: false; error: string };

function toResult(err: unknown): ActionResult {
  if (err instanceof AgreementError) return { ok: false, error: err.message };
  console.error("[agreement]", err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function sendToClient(jobId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await sendBrief(user.id, jobId);
  } catch (err) {
    return toResult(err);
  }
  redirect(`/jobs/${jobId}?sent=1`);
}

export async function acceptBrief(token: string, versionId: string, seenHash: string): Promise<ActionResult> {
  try {
    const { agreed } = await clientAccept(token, versionId, seenHash);
    return { ok: true, agreed };
  } catch (err) {
    return toResult(err);
  }
}

export async function requestChanges(token: string, versionId: string, note: string): Promise<ActionResult> {
  try {
    await clientRequestChanges(token, versionId, String(note ?? ""));
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
