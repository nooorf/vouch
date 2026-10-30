import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { BriefView, VersionChanges } from "@/components/brief-view";
import { EvaluationCard } from "@/components/evaluation-card";
import { JobTimeline, ViewSwitcher } from "@/components/job-bits";
import { MilestoneList } from "@/components/milestones";
import { MoneyBar } from "@/components/money-bar";
import { Badge, Card, Container } from "@/components/ui";
import { db, schema } from "@/db";
import { diffBriefs } from "@/lib/brief/diff";
import { env, hasFeature } from "@/lib/env";
import { findJobByClientToken } from "@/lib/jobs/agreement";
import { drainTasks } from "@/lib/jobs/runner";
import { tickJob } from "@/lib/jobs/tick";
import { milestonesWithEvaluations } from "@/lib/jobs/views";
import { stepIndex } from "@/lib/jobs/status";
import { formatCents } from "@/lib/money";
import { getCurrentUser } from "@/lib/session";
import { ClientActions } from "./client-actions";
import { FundCard } from "./fund-card";

// The link is the client's key: never leak it to other sites through the Referer header.
export const metadata: Metadata = { title: "Brief for review", referrer: "no-referrer", robots: { index: false } };

export default async function ClientPage(props: PageProps<"/c/[token]">) {
  const { token } = await props.params;
  const found = await findJobByClientToken(token);
  if (!found) notFound();
  // Bring the job up to date first (e.g. a PayPal approval we haven't recorded yet).
  await tickJob(found.id);
  after(() => drainTasks({ jobId: found.id }).catch((e) => console.error("[client page] drain", e)));
  // Independent reads in parallel: each is a network round trip to the database.
  const [job, rows, [owner], versions, viewer] = await Promise.all([
    findJobByClientToken(token).then((j) => j!),
    milestonesWithEvaluations(found.id),
    db.select().from(schema.users).where(eq(schema.users.id, found.ownerId)),
    db.select().from(schema.briefVersions).where(eq(schema.briefVersions.jobId, found.id)).orderBy(desc(schema.briefVersions.versionNo)),
    getCurrentUser(),
  ]);
  const milestones = rows.map((r) => r.m);
  const e = env();

  // Only versions someone put forward (sent by the freelancer or proposed by the client) are visible.
  // The freelancer's unsent drafts never are.
  const sentIds = new Set(
    (
      await db
        .select({ id: schema.approvals.briefVersionId })
        .from(schema.approvals)
        .where(inArray(schema.approvals.briefVersionId, versions.map((v) => v.id)))
    ).map((r) => r.id),
  );
  const sent = versions.filter((v) => sentIds.has(v.id));
  const shown = job.agreedVersionId ? versions.find((v) => v.id === job.agreedVersionId)! : sent[0];
  if (!shown) notFound();
  const previous = sent.find((v) => v.versionNo < shown.versionNo);
  const pendingRequest = job.status === "DRAFT" ? versions[0]?.changeRequest : null;

  const isDemoOwner = viewer?.demo && viewer.id === job.ownerId;

  return (
    <Container className="max-w-5xl py-10">
      {isDemoOwner && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-info-soft px-4 py-3">
          <p className="text-sm text-info">You&apos;re seeing what the client sees at their private link.</p>
          <ViewSwitcher active="client" freelancerHref={`/jobs/${job.id}`} clientHref={`/c/${token}`} />
        </div>
      )}

      <p className="text-sm text-muted">
        {owner?.name ?? "Your freelancer"} sent {job.clientName ? `${job.clientName} ` : "you "}a brief to review
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{shown.content.title}</h1>
        <Badge tone="neutral">v{shown.versionNo}</Badge>
      </div>
      <div className="mt-4">
        <JobTimeline current={stepIndex(job.status)} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <MilestoneList milestones={milestones} />
          {[...rows].reverse().map(({ m, ev, delivery }) =>
            ev && delivery ? (
              <EvaluationCard key={ev.id} m={m} ev={ev} delivery={delivery} viewer="client" freelancer={owner?.name ?? "the freelancer"} maxAttempts={1 + job.maxResubmissions} />
            ) : null,
          )}
          {previous && job.status === "PROPOSED" && <VersionChanges changes={diffBriefs(previous.content, shown.content)} fromVersion={previous.versionNo} />}
          <BriefView brief={shown.content} />
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          {job.status === "PROPOSED" && shown.proposedBy !== "client" && (
            <ClientActions
              token={token}
              versionId={shown.id}
              hash={shown.contentHash}
              totalCents={shown.content.totalCents}
              versionNo={shown.versionNo}
              freelancerName={owner?.name ?? "the freelancer"}
            />
          )}
          {job.status === "PROPOSED" && shown.proposedBy === "client" && (
            <Card className="p-5">
              <Badge tone="info">Your proposal</Badge>
              <p className="mt-3 text-sm">
                You proposed v{shown.versionNo}. {owner?.name ?? "The freelancer"} can accept it as is, which locks the brief, or revise it.
              </p>
              {shown.changeRequest && <blockquote className="mt-3 border-l-2 border-line pl-3 text-sm text-muted">{shown.changeRequest}</blockquote>}
              <p className="tabular mt-4 font-mono text-2xl font-semibold">{formatCents(shown.content.totalCents)}</p>
            </Card>
          )}
          {job.status === "DRAFT" && (
            <Card className="p-5">
              <Badge tone="held">Being revised</Badge>
              <p className="mt-3 text-sm">You asked for changes. The freelancer is revising the brief and will send a new version to this same link.</p>
              {pendingRequest && <blockquote className="mt-3 border-l-2 border-line pl-3 text-sm text-muted">{pendingRequest}</blockquote>}
            </Card>
          )}
          {job.status === "AGREED" && (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                You and {owner?.name ?? "the freelancer"} agreed on v{shown.versionNo}
                {job.agreedAt ? ` on ${job.agreedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}. This is exactly what each delivery
                will be checked against.
              </p>
              {hasFeature("paypal") ? (
                <FundCard
                  token={token}
                  clientId={e.NEXT_PUBLIC_PAYPAL_CLIENT_ID!}
                  totalCents={job.totalCents}
                  fundBy={job.fundingExpiresAt ? job.fundingExpiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : null}
                  demoBuyer={job.isDemo && e.DEMO_BUYER_EMAIL && e.DEMO_BUYER_PASSWORD ? { email: e.DEMO_BUYER_EMAIL, password: e.DEMO_BUYER_PASSWORD } : null}
                />
              ) : (
                <Card className="p-5 text-sm text-muted">PayPal isn&apos;t configured on this server yet.</Card>
              )}
            </div>
          )}
          {(job.status === "FUNDED" || job.status === "IN_PROGRESS" || job.status === "COMPLETED") && (
            <Card className="p-5">
              <Badge tone="brand">{job.status === "COMPLETED" ? "Completed" : "Funded"}</Badge>
              <p className="mt-3 text-sm">
                {formatCents(job.authorizedCents)} is held by PayPal. Each milestone is paid only when its delivery passes the agreed checks or you approve
                it.
              </p>
              <div className="mt-4">
                <MoneyBar totalCents={job.totalCents} authorizedCents={job.authorizedCents} releasedCents={job.capturedCents} />
              </div>
            </Card>
          )}
          {job.status === "EXPIRED" && (
            <Card className="p-5">
              <Badge tone="neutral">Expired</Badge>
              <p className="mt-3 text-sm">This agreement wasn&apos;t funded in time, so it expired. Nothing was charged.</p>
            </Card>
          )}
        </aside>
      </div>
    </Container>
  );
}
