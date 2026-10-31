"use server";

import { AgreementError } from "@/lib/jobs/agreement";
import {
  clientCancel,
  clientExtendDeadline,
  clientRequestCancel,
  clientWithdrawCancelRequest,
  demoSkipToDeadline,
  freelancerAnswerCancelRequest,
  freelancerCancel,
} from "@/lib/jobs/cancel";
import { requireUser } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<void>): Promise<Result> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof AgreementError) return { ok: false, error: err.message };
    console.error("[cancel]", err);
    return { ok: false, error: "Something went wrong. Nothing changed. Please try again." };
  }
}

/* Freelancer (signed in) */

export async function cancelJobAction(jobId: string, reason: string): Promise<Result> {
  const user = await requireUser();
  return run(() => freelancerCancel(user.id, String(jobId), String(reason ?? "")));
}

export async function answerCancelRequestAction(jobId: string, accept: boolean): Promise<Result> {
  const user = await requireUser();
  return run(() => freelancerAnswerCancelRequest(user.id, String(jobId), accept === true));
}

/* Client (private link) */

export async function requestCancelAction(token: string, note: string): Promise<Result> {
  return run(() => clientRequestCancel(String(token), String(note ?? "")));
}

export async function withdrawCancelRequestAction(token: string): Promise<Result> {
  return run(() => clientWithdrawCancelRequest(String(token)));
}

export async function clientCancelAction(token: string): Promise<Result> {
  return run(() => clientCancel(String(token)));
}

export async function extendDeadlineAction(token: string, days: number): Promise<Result> {
  return run(() => clientExtendDeadline(String(token), Number(days)));
}

export async function demoSkipToDeadlineAction(token: string): Promise<Result> {
  return run(() => demoSkipToDeadline(String(token)));
}
