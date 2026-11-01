import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { BriefView, VersionChanges } from "@/components/brief-view";
import { EvaluationCard } from "@/components/evaluation-card";
import { HoldNotice } from "@/components/hold-notice";
import { Notices } from "@/components/notices";
import { JobTimeline, ViewSwitcher } from "@/components/job-bits";
import { NextStep, type Step } from "@/components/next-step";
import { MilestoneList } from "@/components/milestones";
import { MoneyBar } from "@/components/money-bar";
import { Receipt } from "@/components/receipt";
import { Badge, Card, Container } from "@/components/ui";
import { db, schema } from "@/db";
import { diffBriefs } from "@/lib/brief/diff";
import { env, hasFeature } from "@/lib/env";
import { findJobByClientToken } from "@/lib/jobs/agreement";
import { cancelRefundCents, cancelView } from "@/lib/jobs/cancel";
import { drainTasks } from "@/lib/jobs/runner";
import { choiceViews } from "@/lib/jobs/choice-views";
import { choicesFor } from "@/lib/jobs/settle";
import { tickJob } from "@/lib/jobs/tick";
import { triesAllowed } from "@/lib/jobs/tries";
import { milestonesWithEvaluations } from "@/lib/jobs/views";
import { stepIndex } from "@/lib/jobs/status";
import { formatCents, returnedCents } from "@/lib/money";
import { listNotices, markNoticesRead } from "@/lib/notify";
import { getCurrentUser } from "@/lib/session";
import { ClientCancelPanel } from "./cancel-panel";
import { ClientActions } from "./client-actions";
import { FundCard } from "./fund-card";
import { ReviewPanel } from "./review-panel";

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
  const [job, rows, [owner], versions, viewer, payments, notices] = await Promise.all([
    findJobByClientToken(token).then((j) => j!),
    milestonesWithEvaluations(found.id),
    db.select().from(schema.users).where(eq(schema.users.id, found.ownerId)),
    db.select().from(schema.briefVersions).where(eq(schema.briefVersions.jobId, found.id)).orderBy(desc(schema.briefVersions.versionNo)),
    getCurrentUser(),
    db.select().from(schema.payments).where(eq(schema.payments.jobId, found.id)),
    listNotices(found.id, "client"),
  ]);
  if (notices.some((n) => !n.readAt)) after(() => markNoticesRead(found.id, "client").catch((e) => console.error("[client page] notices", e)));
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
  const cancel = cancelView(job, milestones);
  const freelancer = owner?.name ?? "the freelancer";
  const Freelancer = owner?.name ?? "The freelancer";
  const step = nextStepForClient();

  /** The one thing that happens next, from the client's side. */
  function nextStepForClient(): Step {
    const fmt = (d: Date | null) => (d ? d.toISOString() : null);
    switch (job.status) {
      case "PROPOSED":
        return shown.proposedBy === "client"
          ? { who: "waiting", title: `${Freelancer} is reviewing your proposed v${shown.versionNo}`, body: "They can accept it as is, which locks the brief, or revise it." }
          : {
              who: "you",
              title: `Review the brief, then accept it or ask for changes`,
              body: "Accepting doesn't charge you. Funding comes next, and the money is held, not sent.",
              href: "#respond",
              cta: "Respond",
            };
      case "DRAFT":
        return { who: "waiting", title: `${Freelancer} is revising the brief`, body: "The new version will arrive at this same link." };
      case "AGREED":
        return {
          who: "you",
          title: `Fund the job to start the work`,
          body: "PayPal holds the money. It's paid out milestone by milestone, only as deliveries pass.",
          href: "#fund",
          cta: `Fund ${formatCents(job.totalCents)}`,
          endsAt: fmt(job.fundingExpiresAt),
        };
      case "FUNDED":
      case "IN_PROGRESS": {
        const deciding = rows.find(({ m, ev }) => ev && choicesFor(m, ev, job.maxResubmissions).length > 0);
        if (deciding) {
          const m = deciding.m;
          return {
            who: "you",
            title: `Decide on M${m.position}: ${m.title}`,
            body: m.decideBy ? `${Freelancer} has used every try. If you don't decide in time, the project ends and the unpaid money comes back to you.` : "Look over the evidence, then approve, hold, or dispute.",
            href: `#decide-${m.position}`,
            cta: "Go to decision",
            endsAt: fmt(m.decideBy ?? m.reviewEndsAt),
          };
        }
        if (cancel.live && cancel.deadline === "overdue" && !cancel.blocker)
          return { who: "you", title: `M${cancel.position} is overdue`, body: "Nothing was delivered in time. You can cancel the job or give more time.", href: "#cancel", cta: "See options" };
        const checking = milestones.find((m) => m.status === "EVALUATING" || m.status === "SUBMITTED");
        if (checking) return { who: "waiting", title: `M${checking.position} is being checked`, body: "Measured checks first, then the AI judge. Usually under a minute." };
        const disputed = milestones.find((m) => m.status === "DISPUTED");
        if (disputed) return { who: "waiting", title: `The AI is re-checking M${disputed.position} with your objection`, body: "You decide once it's done." };
        const open = milestones.find((m) => m.status === "PENDING" || m.status === "HELD" || m.status === "PARTIAL_HELD");
        if (open)
          return {
            who: "waiting",
            title: `${Freelancer} is working on M${open.position}: ${open.title}`,
            body: open.dueAt ? `Due ${open.dueAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}. You'll be asked to review when it's delivered.` : "You'll be asked to review when it's delivered.",
          };
        return { who: "waiting", title: "Work is in progress" };
      }
      case "COMPLETED":
        return { who: "done", title: `Completed. ${formatCents(job.capturedCents)} paid for delivered work.`, body: job.authorizedCents > job.capturedCents ? `${formatCents(job.authorizedCents - job.capturedCents)} was released back to you.` : undefined };
      case "CANCELLED":
        return { who: "done", title: "This job was cancelled", body: job.authorizedCents > 0 ? "The receipt below shows where every dollar went." : "It was cancelled before it was funded. Nothing was charged." };
      case "EXPIRED":
        return { who: "done", title: "This agreement expired", body: "It wasn't funded in time. Nothing was charged." };
    }
  }

  const action = (
    <>
      {job.status === "PROPOSED" && shown.proposedBy !== "client" && (
        <div id="respond" className="scroll-mt-24 rounded-2xl">
          <ClientActions token={token} versionId={shown.id} hash={shown.contentHash} totalCents={shown.content.totalCents} versionNo={shown.versionNo} freelancerName={freelancer} />
        </div>
      )}
      {job.status === "PROPOSED" && shown.proposedBy === "client" && (
        <Card className="p-5 sm:p-6">
          <Badge tone="info" dot>
            Your proposal
          </Badge>
          <p className="amount mt-4 text-4xl font-semibold">{formatCents(shown.content.totalCents)}</p>
          <p className="mt-3 text-sm text-pretty text-muted">
            You proposed v{shown.versionNo}. {Freelancer} can accept it as is, which locks the brief, or revise it.
          </p>
          {shown.changeRequest && <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-sm text-muted">{shown.changeRequest}</blockquote>}
        </Card>
      )}
      {job.status === "DRAFT" && (
        <Card className="p-5 sm:p-6">
          <Badge tone="held" dot>
            Being revised
          </Badge>
          <p className="mt-3 text-sm text-pretty">You asked for changes. The freelancer is revising the brief and will send a new version to this same link.</p>
          {pendingRequest && <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-sm text-muted">{pendingRequest}</blockquote>}
        </Card>
      )}
      {job.status === "AGREED" && (
        <div id="fund" className="scroll-mt-24 space-y-3 rounded-2xl">
          {hasFeature("paypal") ? (
            <FundCard
              token={token}
              clientId={e.NEXT_PUBLIC_PAYPAL_CLIENT_ID!}
              totalCents={job.totalCents}
              agreedText={`You and ${freelancer} agreed on v${shown.versionNo}${job.agreedAt ? ` on ${job.agreedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}. This is exactly what each delivery will be checked against.`}
              fundBy={job.fundingExpiresAt ? job.fundingExpiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : null}
              demoBuyer={job.isDemo && e.DEMO_BUYER_EMAIL && e.DEMO_BUYER_PASSWORD ? { email: e.DEMO_BUYER_EMAIL, password: e.DEMO_BUYER_PASSWORD } : null}
            />
          ) : (
            <Card className="p-5 text-sm text-muted">PayPal isn&apos;t configured on this server yet.</Card>
          )}
        </div>
      )}
      {(job.status === "FUNDED" || job.status === "IN_PROGRESS" || job.status === "COMPLETED" || (job.status === "CANCELLED" && job.authorizedCents > 0)) && (
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">Total</p>
            <Badge tone={job.status === "CANCELLED" ? "neutral" : "ok"} dot>
              {job.status === "COMPLETED" ? "Completed" : job.status === "CANCELLED" ? "Cancelled" : "Funded"}
            </Badge>
          </div>
          <p className="amount mt-1 text-4xl font-semibold">{formatCents(job.totalCents)}</p>
          <div className="mt-5">
            <MoneyBar totalCents={job.totalCents} authorizedCents={job.authorizedCents} releasedCents={job.capturedCents} returnedCents={returnedCents(job)} size="lg" />
          </div>
          <p className="mt-5 border-t border-line pt-4 text-sm text-pretty text-muted">
            {job.status === "COMPLETED"
              ? `Done. ${formatCents(job.capturedCents)} was paid for the delivered work${job.authorizedCents > job.capturedCents ? ` and ${formatCents(job.authorizedCents - job.capturedCents)} was released back to you` : ""}.`
              : job.status === "CANCELLED"
                ? `This job was cancelled. ${formatCents(job.capturedCents)} was paid for delivered work${job.authorizedCents > job.capturedCents ? ` and ${formatCents(job.authorizedCents - job.capturedCents)} was released back to you` : ""}.`
                : `${formatCents(job.authorizedCents)} is held by PayPal. Each milestone is paid only when its delivery passes the agreed checks or you approve it.`}
          </p>
        </Card>
      )}
      {job.status === "CANCELLED" && job.authorizedCents === 0 && (
        <Card className="p-5 sm:p-6">
          <Badge tone="neutral">Cancelled</Badge>
          <p className="mt-3 text-sm">This job was cancelled before it was funded. Nothing was charged.</p>
        </Card>
      )}
      {job.status === "EXPIRED" && (
        <Card className="p-5 sm:p-6">
          <Badge tone="neutral">Expired</Badge>
          <p className="mt-3 text-sm">This agreement wasn&apos;t funded in time, so it expired. Nothing was charged.</p>
        </Card>
      )}
    </>
  );

  return (
    <Container className="py-8 sm:py-12">
      {isDemoOwner && (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">You&apos;re seeing what the client sees at their private link.</p>
          <ViewSwitcher active="client" freelancerHref={`/jobs/${job.id}`} clientHref={`/c/${token}`} />
        </div>
      )}

      <header>
        <p className="text-sm text-muted">
          {owner?.name ?? "Your freelancer"} sent {job.clientName ? `${job.clientName} ` : "you "}a brief to review
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-balance sm:text-4xl">{shown.content.title}</h1>
          <Badge tone="neutral">v{shown.versionNo}</Badge>
        </div>
        <div className="mt-5">
          <JobTimeline current={stepIndex(job.status)} />
        </div>
      </header>

      <div className="mt-8">
        <NextStep step={step} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:gap-x-10">
        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1">{action}</div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <HoldNotice job={job} />
          <MilestoneList milestones={milestones} />
          {[...rows].reverse().map(({ m, ev, delivery }) => {
            if (!ev || !delivery) return null;
            const choices = choicesFor(m, ev, job.maxResubmissions);
            const canDispute = m.status === "REVIEW_WINDOW" && !m.reevaluated && ev.status === "done" && ev.verdict !== "NEEDS_HUMAN";
            return (
              <div key={ev.id} className="space-y-4">
                <EvaluationCard
                  m={m}
                  ev={ev}
                  delivery={delivery}
                  viewer="client"
                  freelancer={freelancer}
                  maxAttempts={triesAllowed(job.maxResubmissions, m)}
                  refundCents={cancelRefundCents(job)}
                />
                {choices.length > 0 && (
                  <ReviewPanel
                    token={token}
                    milestoneId={m.id}
                    position={m.position}
                    choices={choiceViews(m, ev, choices, { freelancer, refundCents: cancelRefundCents(job) })}
                    dispute={canDispute ? (ev.results ?? []).map((r) => ({ id: r.id, label: r.label, passed: r.passed })) : null}
                  />
                )}
              </div>
            );
          })}
          {previous && job.status === "PROPOSED" && <VersionChanges changes={diffBriefs(previous.content, shown.content)} fromVersion={previous.versionNo} />}
          <BriefView brief={shown.content} agreed={!!job.agreedVersionId} />
        </div>

        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-2">
          {cancel.live && (
            <div id="cancel" className="scroll-mt-24 rounded-2xl">
              <ClientCancelPanel token={token} freelancer={freelancer} view={cancel} />
            </div>
          )}
          <Notices notices={notices} />
          {payments.length > 0 && <Receipt payments={payments} milestones={milestones} completed={job.status === "COMPLETED"} freelancer={freelancer} />}
        </div>
      </div>
    </Container>
  );
}
