"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LlmUnavailableError } from "@/lib/llm";
import {
  AgreementError,
  clientAccept,
  clientPropose,
  clientRequestChanges,
  freelancerAcceptProposal,
  freelancerReviseProposal,
  previewClientProposal,
  sendBrief,
  type ProposalPreview,
} from "@/lib/jobs/agreement";
import { requireUser } from "@/lib/session";

export type ActionResult = { ok: true; agreed?: boolean } | { ok: false; error: string };

function toResult(err: unknown): ActionResult {
  if (err instanceof AgreementError || err instanceof LlmUnavailableError) return { ok: false, error: err.message };
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

export async function previewProposal(token: string, versionId: string, note: string): Promise<{ ok: true; preview: ProposalPreview } | { ok: false; error: string }> {
  try {
    return { ok: true, preview: await previewClientProposal(token, versionId, String(note ?? "")) };
  } catch (err) {
    return toResult(err) as { ok: false; error: string };
  }
}

export async function proposeChanges(token: string, versionId: string, note: string, previewedHash: string): Promise<ActionResult> {
  try {
    await clientPropose(token, versionId, String(note ?? ""), previewedHash);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function acceptProposal(jobId: string, versionId: string, seenHash: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await freelancerAcceptProposal(user.id, jobId, versionId, seenHash);
  } catch (err) {
    return toResult(err);
  }
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, agreed: true };
}

export async function reviseProposal(jobId: string, versionId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await freelancerReviseProposal(user.id, jobId, versionId);
  } catch (err) {
    return toResult(err);
  }
  redirect(`/jobs/${jobId}/brief`);
}
