"use server";

import { AgreementError, findJobByClientToken } from "@/lib/jobs/agreement";
import { completeFunding, createFundingOrder, type FundingResult } from "@/lib/paypal/funding";

type Fail = { ok: false; error: string };

function fail(err: unknown): Fail {
  if (err instanceof AgreementError) return { ok: false, error: err.message };
  console.error("[funding]", err);
  return { ok: false, error: "Something went wrong with PayPal. Nothing was charged. Please try again." };
}

/** Called by the PayPal button's createOrder. */
export async function startFunding(token: string): Promise<{ ok: true; orderId: string } | Fail> {
  try {
    const job = await findJobByClientToken(token);
    if (!job) return { ok: false, error: "This link is not valid." };
    return { ok: true, orderId: await createFundingOrder(job) };
  } catch (err) {
    return fail(err);
  }
}

/** Called by the PayPal button's onApprove. */
export async function finishFunding(token: string, orderId: string): Promise<{ ok: true; result: FundingResult } | Fail> {
  try {
    const job = await findJobByClientToken(token);
    if (!job) return { ok: false, error: "This link is not valid." };
    return { ok: true, result: await completeFunding(job.id, String(orderId), "client") };
  } catch (err) {
    return fail(err);
  }
}
