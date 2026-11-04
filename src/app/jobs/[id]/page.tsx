import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { Activity } from "@/components/activity";
import { BriefView, VersionChanges } from "@/components/brief-view";
import { EvaluationCard } from "@/components/evaluation-card";
import { HoldNotice } from "@/components/hold-notice";
import { Notices } from "@/components/notices";
import { CopyLink, JobTimeline, ViewSwitcher } from "@/components/job-bits";
import { NextStep, type Step } from "@/components/next-step";
import { MilestoneList } from "@/components/milestones";
import { MoneyBar } from "@/components/money-bar";
import { Receipt } from "@/components/receipt";
import { Badge, Card, Container, LinkButton } from "@/components/ui";
import { db, schema } from "@/db";
import { diffBriefs } from "@/lib/brief/diff";
import { clientUrlFor } from "@/lib/jobs/agreement";
import { cancelRefundCents, cancelView } from "@/lib/jobs/cancel";
import { stepIndex } from "@/lib/jobs/status";
import { canSubmit, currentMilestone } from "@/lib/jobs/delivery";
import { drainTasks } from "@/lib/jobs/runner";
import { tickJob } from "@/lib/jobs/tick";
import { holdPhase } from "@/lib/jobs/hold-rules";
import { canWithdraw, triesAllowed, triesLeft } from "@/lib/jobs/tries";
import { milestonesWithEvaluations } from "@/lib/jobs/views";
import { formatCents, returnedCents } from "@/lib/money";
import { env } from "@/lib/env";
import { listNotices, markNoticesRead } from "@/lib/notify";
import { requireUser } from "@/lib/session";
import { FreelancerCancelPanel } from "./cancel-panel";
import { ProposalActions } from "./proposal-actions";
import { SubmitDelivery } from "./submit-delivery";
import { WithdrawDelivery } from "./withdraw-delivery";

export const metadata: Metadata = { title: "Job" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const { id } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser();
  if (!UUID.test(id)) notFound();
  await tickJob(id);
  after(() => drainTasks({ jobId: id }).catch((e) => console.error("[job page] drain", e)));

  // Independent reads in parallel: each is a network round trip to the database.
  const [[job], versions, rows, events, payments, notices] = await Promise.all([
    db.select().from(schema.jobs).where(and(eq(schema.jobs.id, id), eq(schema.jobs.ownerId, user.id))),
    db.select().from(schema.briefVersions).where(eq(schema.briefVersions.jobId, id)).orderBy(desc(schema.briefVersions.versionNo)),
    milestonesWithEvaluations(id),
    db.select().from(schema.events).where(eq(schema.events.jobId, id)).orderBy(desc(schema.events.id)).limit(50),
    db.select().from(schema.payments).where(eq(schema.payments.jobId, id)),
    listNotices(id, "freelancer"),
  ]);
  if (!job) notFound();
  if (notices.some((n) => !n.readAt)) after(() => markNoticesRead(id, "freelancer").catch((e) => console.error("[job page] notices", e)));
  const latest = versions[0];
  const shown = (job.agreedVersionId && versions.find((v) => v.id === job.agreedVersionId)) || latest;
  const milestones = rows.map((r) => r.m);
  const current = currentMilestone(milestones);
  const submittable = (job.status === "FUNDED" || job.status === "IN_PROGRESS") && current ? canSubmit(current, job.maxResubmissions, job.authExpiresAt) : null;

  const cancel = cancelView(job, milestones);

  const clientUrl = clientUrlFor(job);
  const clientPath = clientUrl ? new URL(clientUrl).pathname : null;
  const justSent = search.sent === "1";
  const clientProposal = job.status === "PROPOSED" && latest.proposedBy === "client" ? latest : null;
  const beforeProposal = clientProposal ? versions.find((v) => v.versionNo === clientProposal.versionNo - 1) : undefined;
  const statusBadge = {
    DRAFT: { label: "Draft", tone: "neutral" },
    PROPOSED: { label: "Sent", tone: "info" },
    AGREED: { label: "Agreed", tone: "info" },
    FUNDED: { label: "Funded", tone: "ok" },
    IN_PROGRESS: { label: "Funded", tone: "ok" },
    COMPLETED: { label: "Completed", tone: "ok" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
    EXPIRED: { label: "Expired", tone: "neutral" },
  }[job.status] as { label: string; tone: "neutral" | "info" | "ok" };

  const step = nextStepForFreelancer();

  /** The one thing that happens next, from the freelancer's side. */
  function nextStepForFreelancer(): Step {
    const fmt = (d: Date | null) => (d ? d.toISOString() : null);
    if (job.status === "DRAFT")
      return latest.changeRequest
        ? { who: "you", title: `The client asked for changes to v${latest.versionNo - 1}`, body: "Revise the brief and send the new version. The client keeps the same link.", href: "#changes", cta: "See the request" }
        : { who: "you", title: "Check the AI's draft, then send it to the client", body: "Only you can see it until you send it.", href: `/jobs/${job.id}/brief`, cta: "Edit and send" };
    if (clientProposal) return { who: "you", title: `The client proposed v${clientProposal.versionNo}`, body: "Accept it to lock the brief, or revise it and send your own version.", href: "#proposal", cta: "Review proposal" };
    if (job.status === "PROPOSED")
      return { who: "waiting", title: justSent ? `Sent v${latest.versionNo} to the client` : `Waiting for the client to accept v${latest.versionNo}`, body: "They review it at their private link. No account needed.", href: "#share", cta: "Copy their link" };
    if (job.status === "AGREED") return { who: "waiting", title: `Agreed on v${shown.versionNo}. Waiting for the client to fund it.`, body: "The brief is locked. Work starts once PayPal holds the money.", endsAt: fmt(job.fundingExpiresAt) };
    if (job.status === "FUNDED" || job.status === "IN_PROGRESS") {
      if (cancel.live && cancel.requestNote !== null) return { who: "you", title: "The client asked to cancel", body: "Nothing changes unless you accept.", href: "#cancel", cta: "Respond" };
      if (current && submittable?.ok)
        return {
          who: "you",
          title: `${current.attempts > 0 ? "Resubmit" : "Deliver"} M${current.position}: ${current.title}`,
          body: `Try ${current.attempts + 1} of ${triesAllowed(job.maxResubmissions, current)}. Paste the live link and Vouch checks it against the brief.`,
          href: "#deliver",
          cta: current.attempts > 0 ? "Resubmit" : "Submit delivery",
          endsAt: fmt(current.dueAt),
        };
      if (current?.decideBy) return { who: "waiting", title: `The client decides on M${current.position}`, body: "You've used every try. They can give another, accept, skip it, or end the project.", endsAt: fmt(current.decideBy) };
      if (current && (current.status === "EVALUATING" || current.status === "SUBMITTED")) return { who: "waiting", title: `M${current.position} is being checked`, body: "Measured checks first, then the AI judge. Usually under a minute." };
      if (current && current.status === "REVIEW_WINDOW")
        return { who: "waiting", title: `The client is reviewing M${current.position}`, body: "If they don't respond in time, the verdict executes on its own.", endsAt: fmt(current.reviewEndsAt) };
      if (current && current.status === "DISPUTED") return { who: "waiting", title: `The client disputed M${current.position}`, body: "The AI is checking again with their objection. Then they decide." };
      return { who: "waiting", title: "Funded and in progress" };
    }
    if (job.status === "COMPLETED")
      return { who: "done", title: `Completed. You were paid ${formatCents(job.capturedCents)}.`, body: job.authorizedCents > job.capturedCents ? `${formatCents(job.authorizedCents - job.capturedCents)} went back to the client.` : undefined };
    if (job.status === "CANCELLED") return { who: "done", title: "This job was cancelled", body: job.authorizedCents > 0 ? `You were paid ${formatCents(job.capturedCents)}.` : "It was cancelled before it was funded." };
    return { who: "done", title: "This agreement expired", body: "The client didn't fund the job in time. Nothing was charged." };
  }

  return (
    <Container className="py-8 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
          ← Your jobs
        </Link>
        {user.demo && <ViewSwitcher active="freelancer" freelancerHref={`/jobs/${job.id}`} clientHref={clientPath} />}
      </div>

      <header className="mt-6">
        {job.clientName && <p className="text-sm text-muted">For {job.clientName}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-balance sm:text-4xl">{job.title}</h1>
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
        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">Total</p>
              <Badge tone={statusBadge.tone} dot>
                {statusBadge.label}
              </Badge>
            </div>
            <p className="amount mt-1 text-4xl font-semibold">{formatCents(job.totalCents)}</p>
            <div className="mt-5">
              <MoneyBar totalCents={job.totalCents} authorizedCents={job.authorizedCents} releasedCents={job.capturedCents} returnedCents={returnedCents(job)} size="lg" />
            </div>
            <div className="mt-5 border-t border-line pt-4 text-sm text-pretty text-muted">
              {job.status === "DRAFT" && !latest.changeRequest && (
                <>
                  <p>Only you can see this brief. Review it, then send it to the client.</p>
                  <LinkButton href={`/jobs/${job.id}/brief`} className="mt-4 w-full">
                    Edit and send
                  </LinkButton>
                </>
              )}
              {job.status === "DRAFT" && latest.changeRequest && <p>Revise the brief and send v{latest.versionNo}. The client keeps the same link.</p>}
              {clientProposal && <p>The client proposed v{clientProposal.versionNo}. Accept it to lock the brief, or revise it.</p>}
              {job.status === "PROPOSED" && !clientProposal && (
                <p>
                  Share this private link. The client can accept or ask for changes, no account needed. You&apos;ve already accepted v{latest.versionNo}.
                </p>
              )}
              {job.status === "AGREED" && <p>The brief is locked. Waiting for the client to fund the job with PayPal.</p>}
              {job.status === "COMPLETED" && (
                <p>
                  You were paid {formatCents(job.capturedCents)}.{job.authorizedCents > job.capturedCents ? ` ${formatCents(job.authorizedCents - job.capturedCents)} went back to the client.` : ""}
                </p>
              )}
              {(job.status === "FUNDED" || job.status === "IN_PROGRESS") && (
                <p>PayPal is holding {formatCents(job.authorizedCents)} for this job. Deliver each milestone to get paid for it.</p>
              )}
              {job.status === "CANCELLED" && (
                <p>
                  {job.authorizedCents > 0
                    ? `You were paid ${formatCents(job.capturedCents)}.${job.authorizedCents > job.capturedCents ? ` ${formatCents(job.authorizedCents - job.capturedCents)} went back to the client.` : ""}`
                    : "This job was cancelled before it was funded."}
                </p>
              )}
              {job.status === "EXPIRED" && <p>The client didn&apos;t fund the job in time. Nothing was charged.</p>}
              {clientUrl && (
                <div id="share" className="mt-4 scroll-mt-24 rounded-full">
                  <p className="mb-2 text-xs font-medium text-ink">Client&apos;s private link</p>
                  <CopyLink url={clientUrl} />
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {job.status === "DRAFT" && latest.changeRequest && (
            <Card id="changes" className="scroll-mt-24 border-held-fill/50 p-5 shadow-raised sm:p-6">
              <Badge tone="held" dot>
                Client asked for changes to v{latest.versionNo - 1}
              </Badge>
              <blockquote className="mt-4 border-l-2 border-held-fill pl-4 text-[15px] text-pretty">{latest.changeRequest}</blockquote>
              <LinkButton href={`/jobs/${job.id}/brief`} className="mt-5">
                Revise the brief
              </LinkButton>
            </Card>
          )}
          {clientProposal && (
            <Card id="proposal" className="scroll-mt-24 border-brand/30 p-5 shadow-raised sm:p-6">
              <Badge tone="info" dot>
                The client proposed v{clientProposal.versionNo}
              </Badge>
              {clientProposal.changeRequest && <blockquote className="mt-4 border-l-2 border-brand/40 pl-4 text-[15px] text-pretty">{clientProposal.changeRequest}</blockquote>}
              <p className="mt-3 text-sm text-pretty text-muted">
                AI drafted these edits from the client&apos;s request and the client accepted them. Accept to lock the brief, or revise it and send your own
                version.
              </p>
              <ProposalActions jobId={job.id} versionId={clientProposal.id} hash={clientProposal.contentHash} versionNo={clientProposal.versionNo} />
            </Card>
          )}
          {clientProposal && beforeProposal && <VersionChanges changes={diffBriefs(beforeProposal.content, clientProposal.content)} fromVersion={beforeProposal.versionNo} />}
          <HoldNotice job={job} />
          <MilestoneList milestones={milestones} />
          {current && submittable?.ok && (
            <div id="deliver" className="scroll-mt-24 rounded-2xl">
              <SubmitDelivery
                jobId={job.id}
                milestoneId={current.id}
                position={current.position}
                title={current.title}
                wantsRepo={current.criteria.some((c) => (c.kind === "check" && ["repo_readme", "repo_fresh_commits", "ci_passing"].includes(c.checkId)) || (c.kind === "judged" && c.source === "code"))}
                demo={user.demo}
                demoRepo={user.demo ? env().DEMO_REPO_URL : undefined}
                resubmission={current.attempts > 0}
                tryNo={current.attempts + 1}
                tries={triesAllowed(job.maxResubmissions, current)}
              />
            </div>
          )}
          {current && job.status === "IN_PROGRESS" && canWithdraw(current).ok && holdPhase(job.authExpiresAt, new Date()) !== "settle" && (
            <WithdrawDelivery
              jobId={job.id}
              milestoneId={current.id}
              position={current.position}
              tryNo={current.attempts}
              triesLeft={triesLeft(job.maxResubmissions, current)}
            />
          )}
          {[...rows].reverse().map(({ m, ev, delivery }) =>
            ev && delivery ? (
              <EvaluationCard
                key={ev.id}
                m={m}
                ev={ev}
                delivery={delivery}
                viewer="freelancer"
                freelancer="you"
                maxAttempts={triesAllowed(job.maxResubmissions, m)}
                refundCents={cancelRefundCents(job)}
              />
            ) : null,
          )}
          <BriefView brief={shown.content} agreed={!!job.agreedVersionId} />
        </div>

        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-2">
          {cancel.live && (
            <div id="cancel" className="scroll-mt-24 rounded-2xl">
              <FreelancerCancelPanel jobId={job.id} view={cancel} />
            </div>
          )}
          <Notices notices={notices} />
          <Receipt payments={payments} milestones={milestones} completed={job.status === "COMPLETED"} freelancer="you" />
          <Activity events={events} />
        </div>
      </div>
    </Container>
  );
}
