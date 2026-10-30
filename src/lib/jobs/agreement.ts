import { and, desc, eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { briefHash } from "@/lib/brief/hash";
import { proposeRevision, type Proposal } from "@/lib/brief/propose";
import { Brief } from "@/lib/brief/schema";
import { decrypt, encrypt, hashToken, LINK_TOKEN_RE, newLinkToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { assertTransition } from "./status";

/** A problem the user can act on; its message is shown as is. */
export class AgreementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgreementError";
  }
}

const LINK_PURPOSE = "client-link";
/** How long the client has to fund an agreed brief. */
export const FUNDING_WINDOW_HOURS = 72;

export type Job = typeof schema.jobs.$inferSelect;
export type BriefVersion = typeof schema.briefVersions.$inferSelect;

export function clientUrlFor(job: Pick<Job, "clientTokenEnc">): string | null {
  if (!job.clientTokenEnc) return null;
  const token = decrypt(job.clientTokenEnc, env().AUTH_SECRET!, LINK_PURPOSE);
  return token ? `${env().APP_URL.replace(/\/$/, "")}/c/${token}` : null;
}

export async function latestVersion(jobId: string, tx: Tx | typeof db = db): Promise<BriefVersion | undefined> {
  const [v] = await tx
    .select()
    .from(schema.briefVersions)
    .where(eq(schema.briefVersions.jobId, jobId))
    .orderBy(desc(schema.briefVersions.versionNo))
    .limit(1);
  return v;
}

export async function findJobByClientToken(token: string): Promise<Job | undefined> {
  if (!LINK_TOKEN_RE.test(token)) return undefined;
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.clientTokenHash, hashToken(token)));
  return job;
}

async function lockJob(tx: Tx, where: ReturnType<typeof eq>): Promise<Job | undefined> {
  const [job] = await tx.select().from(schema.jobs).where(where).for("update");
  return job;
}

/* ------------------------------------------------------------------ */
/* Freelancer                                                           */
/* ------------------------------------------------------------------ */

/**
 * Send the current draft to the client. The freelancer's acceptance of exactly this version is
 * recorded at the same time. The client link is created on the first send and kept afterwards.
 */
export async function sendBrief(ownerId: string, jobId: string): Promise<{ clientUrl: string; versionNo: number }> {
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, and(eq(schema.jobs.id, jobId), eq(schema.jobs.ownerId, ownerId))!);
    if (!job) throw new AgreementError("Job not found.");
    if (job.status !== "DRAFT") throw new AgreementError("This brief has already been sent.");
    assertTransition(job.status, "PROPOSED");

    const version = await latestVersion(jobId, tx);
    if (!version) throw new AgreementError("Brief not found.");
    const parsed = Brief.safeParse(version.content);
    if (!parsed.success) throw new AgreementError("Fix the brief before sending it.");
    const hash = briefHash(parsed.data);
    if (hash !== version.contentHash) throw new AgreementError("The brief changed while sending. Please try again.");

    let tokenEnc = job.clientTokenEnc;
    let tokenHash = job.clientTokenHash;
    if (!tokenEnc) {
      const link = newLinkToken();
      tokenEnc = encrypt(link.token, env().AUTH_SECRET!, LINK_PURPOSE);
      tokenHash = link.hash;
    }

    await tx
      .insert(schema.approvals)
      .values({ briefVersionId: version.id, party: "freelancer", contentHash: hash })
      .onConflictDoNothing();
    await tx
      .update(schema.jobs)
      .set({ status: "PROPOSED", clientTokenEnc: tokenEnc, clientTokenHash: tokenHash, sentAt: new Date() })
      .where(eq(schema.jobs.id, jobId));
    await tx.insert(schema.events).values({
      jobId,
      type: "brief.sent",
      source: "freelancer",
      payload: { version: version.versionNo, hash },
    });

    return { clientUrl: clientUrlFor({ clientTokenEnc: tokenEnc })!, versionNo: version.versionNo };
  });
}

/* ------------------------------------------------------------------ */
/* Client                                                               */
/* ------------------------------------------------------------------ */

async function lockForClient(tx: Tx, token: string, versionId: string) {
  if (!LINK_TOKEN_RE.test(token)) throw new AgreementError("This link is not valid.");
  const job = await lockJob(tx, eq(schema.jobs.clientTokenHash, hashToken(token)));
  if (!job) throw new AgreementError("This link is not valid.");
  if (job.status !== "PROPOSED") {
    throw new AgreementError(job.status === "DRAFT" ? "The freelancer is revising this brief." : "This brief is no longer open for review.");
  }
  const version = await latestVersion(job.id, tx);
  if (!version || version.id !== versionId) throw new AgreementError("A newer version was sent. Reload the page to see it.");
  if (version.proposedBy === "client") throw new AgreementError("Waiting for the freelancer to respond to your proposal.");
  return { job, version };
}

/** Both parties accepted this exact version → AGREED. Call inside the transaction that holds the job lock. */
async function agreeIfBothAccepted(tx: Tx, job: Job, version: BriefVersion, source: "client" | "freelancer"): Promise<boolean> {
  const approvals = await tx.select().from(schema.approvals).where(eq(schema.approvals.briefVersionId, version.id));
  const both = ["freelancer", "client"].every((p) => approvals.some((a) => a.party === p && a.contentHash === version.contentHash));
  if (!both) return false;

  assertTransition(job.status, "AGREED");
  const now = new Date();
  await tx.update(schema.briefVersions).set({ status: "accepted" }).where(eq(schema.briefVersions.id, version.id));
  await tx
    .update(schema.jobs)
    .set({
      status: "AGREED",
      agreedVersionId: version.id,
      agreedAt: now,
      totalCents: version.content.totalCents,
      title: version.content.title,
      reviewWindowSeconds: version.content.terms.reviewWindowHours * 3600,
      maxResubmissions: version.content.terms.maxResubmissions,
      fundingExpiresAt: new Date(now.getTime() + FUNDING_WINDOW_HOURS * 3600_000),
    })
    .where(eq(schema.jobs.id, job.id));
  await tx.insert(schema.events).values({
    jobId: job.id,
    type: "brief.agreed",
    source,
    payload: { version: version.versionNo, hash: version.contentHash },
  });
  return true;
}

/** The client accepts the exact version they were shown (by hash). Both accepted → AGREED. */
export async function clientAccept(token: string, versionId: string, seenHash: string): Promise<{ agreed: boolean }> {
  return db.transaction(async (tx) => {
    const { job, version } = await lockForClient(tx, token, versionId);
    if (version.contentHash !== seenHash) throw new AgreementError("The brief changed. Reload the page to see the latest version.");

    await tx
      .insert(schema.approvals)
      .values({ briefVersionId: version.id, party: "client", contentHash: version.contentHash })
      .onConflictDoNothing();

    const agreed = await agreeIfBothAccepted(tx, job, version, "client");
    if (!agreed) {
      await tx.insert(schema.events).values({ jobId: job.id, type: "brief.accepted", source: "client", payload: { version: version.versionNo } });
    }
    return { agreed };
  });
}

/** The client asks for changes in plain words. The freelancer gets a new draft version to revise. */
export async function clientRequestChanges(token: string, versionId: string, note: string): Promise<void> {
  const text = note.trim();
  if (text.length < 10) throw new AgreementError("Say what you'd like changed (at least a sentence).");
  if (text.length > 2000) throw new AgreementError("Keep the request under 2,000 characters.");

  await db.transaction(async (tx) => {
    const { job, version } = await lockForClient(tx, token, versionId);
    assertTransition(job.status, "DRAFT");

    await tx.update(schema.briefVersions).set({ status: "superseded" }).where(eq(schema.briefVersions.id, version.id));
    await tx.insert(schema.briefVersions).values({
      jobId: job.id,
      versionNo: version.versionNo + 1,
      content: version.content,
      contentHash: version.contentHash,
      proposedBy: "freelancer",
      changeRequest: text,
    });
    await tx.update(schema.jobs).set({ status: "DRAFT" }).where(eq(schema.jobs.id, job.id));
    await tx.insert(schema.events).values({
      jobId: job.id,
      type: "brief.changes_requested",
      source: "client",
      payload: { version: version.versionNo, note: text },
    });
  });
}

/* ------------------------------------------------------------------ */
/* AI-drafted proposals                                                 */
/* ------------------------------------------------------------------ */

export type ProposalPreview = Omit<Proposal, "brief"> & { totalCents: number; nextVersion: number };

function checkRequest(note: string) {
  const text = note.trim();
  if (text.length < 10) throw new AgreementError("Say what you'd like changed (at least a sentence).");
  if (text.length > 2000) throw new AgreementError("Keep the request under 2,000 characters.");
  return text;
}

async function currentForClient(token: string, versionId: string) {
  return db.transaction(async (tx) => lockForClient(tx, token, versionId));
}

/** The client's request, turned into concrete edits by the AI. Nothing is saved. */
export async function previewClientProposal(token: string, versionId: string, note: string): Promise<ProposalPreview> {
  const text = checkRequest(note);
  const { version } = await currentForClient(token, versionId);
  const proposal = await proposeRevision(version.content, text);
  const { brief, ...rest } = proposal;
  return { ...rest, totalCents: brief.totalCents, nextVersion: version.versionNo + 1 };
}

/**
 * The client proposes the previewed edits as the next version, accepting it themselves.
 * The proposal is recomputed (served from the AI cache) and must match what they previewed.
 */
export async function clientPropose(token: string, versionId: string, note: string, previewedHash: string): Promise<void> {
  const text = checkRequest(note);
  const { version: before } = await currentForClient(token, versionId);
  const proposal = await proposeRevision(before.content, text);
  if (proposal.hash !== previewedHash) throw new AgreementError("The suggested changes were updated. Review them again before proposing.");
  if (proposal.changes.length === 0) throw new AgreementError("There's nothing to change. Try describing the change differently, or send it as a note.");

  await db.transaction(async (tx) => {
    const { job, version } = await lockForClient(tx, token, versionId);
    await tx.update(schema.briefVersions).set({ status: "superseded" }).where(eq(schema.briefVersions.id, version.id));
    const [created] = await tx
      .insert(schema.briefVersions)
      .values({
        jobId: job.id,
        versionNo: version.versionNo + 1,
        content: proposal.brief,
        contentHash: proposal.hash,
        proposedBy: "client",
        changeRequest: text,
      })
      .returning();
    await tx.insert(schema.approvals).values({ briefVersionId: created.id, party: "client", contentHash: proposal.hash });
    await tx.insert(schema.events).values({
      jobId: job.id,
      type: "brief.client_proposed",
      source: "client",
      payload: { version: created.versionNo, from: version.versionNo, note: text, summary: proposal.summary, model: proposal.model, changes: proposal.changes.length },
    });
  });
}

async function lockClientProposal(tx: Tx, ownerId: string, jobId: string, versionId: string) {
  const job = await lockJob(tx, and(eq(schema.jobs.id, jobId), eq(schema.jobs.ownerId, ownerId))!);
  if (!job) throw new AgreementError("Job not found.");
  const version = await latestVersion(jobId, tx);
  if (job.status !== "PROPOSED" || !version || version.id !== versionId || version.proposedBy !== "client") {
    throw new AgreementError("This proposal is no longer open. Reload the page.");
  }
  return { job, version };
}

/** The freelancer accepts the client's proposed version as is → AGREED. */
export async function freelancerAcceptProposal(ownerId: string, jobId: string, versionId: string, seenHash: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { job, version } = await lockClientProposal(tx, ownerId, jobId, versionId);
    if (version.contentHash !== seenHash) throw new AgreementError("The proposal changed. Reload the page.");
    await tx.insert(schema.approvals).values({ briefVersionId: version.id, party: "freelancer", contentHash: version.contentHash }).onConflictDoNothing();
    const agreed = await agreeIfBothAccepted(tx, job, version, "freelancer");
    if (!agreed) throw new Error("Expected agreement after both approvals");
  });
}

/** The freelancer wants to adjust the client's proposal: it becomes their next draft. */
export async function freelancerReviseProposal(ownerId: string, jobId: string, versionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { job, version } = await lockClientProposal(tx, ownerId, jobId, versionId);
    assertTransition(job.status, "DRAFT");
    await tx.update(schema.briefVersions).set({ status: "superseded" }).where(eq(schema.briefVersions.id, version.id));
    await tx.insert(schema.briefVersions).values({
      jobId,
      versionNo: version.versionNo + 1,
      content: version.content,
      contentHash: version.contentHash,
      proposedBy: "freelancer",
      changeRequest: version.changeRequest,
    });
    await tx.update(schema.jobs).set({ status: "DRAFT" }).where(eq(schema.jobs.id, jobId));
    await tx.insert(schema.events).values({ jobId, type: "brief.revising", source: "freelancer", payload: { from: version.versionNo } });
  });
}
