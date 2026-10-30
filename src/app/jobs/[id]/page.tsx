import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Activity } from "@/components/activity";
import { BriefView, VersionChanges } from "@/components/brief-view";
import { CopyLink, JobTimeline, ViewSwitcher } from "@/components/job-bits";
import { MoneyBar } from "@/components/money-bar";
import { Badge, Card, Container, LinkButton } from "@/components/ui";
import { db, schema } from "@/db";
import { diffBriefs } from "@/lib/brief/diff";
import { clientUrlFor } from "@/lib/jobs/agreement";
import { stepIndex } from "@/lib/jobs/status";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { ProposalActions } from "./proposal-actions";

export const metadata: Metadata = { title: "Job" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const { id } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser();
  if (!UUID.test(id)) notFound();

  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.ownerId, user.id)));
  if (!job) notFound();

  const versions = await db
    .select()
    .from(schema.briefVersions)
    .where(eq(schema.briefVersions.jobId, id))
    .orderBy(desc(schema.briefVersions.versionNo));
  const latest = versions[0];
  const shown = (job.agreedVersionId && versions.find((v) => v.id === job.agreedVersionId)) || latest;
  const events = await db.select().from(schema.events).where(eq(schema.events.jobId, id)).orderBy(desc(schema.events.id)).limit(50);

  const clientUrl = clientUrlFor(job);
  const clientPath = clientUrl ? new URL(clientUrl).pathname : null;
  const justSent = search.sent === "1";
  const clientProposal = job.status === "PROPOSED" && latest.proposedBy === "client" ? latest : null;
  const beforeProposal = clientProposal ? versions.find((v) => v.versionNo === clientProposal.versionNo - 1) : undefined;

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
          ← Your jobs
        </Link>
        {user.demo && <ViewSwitcher active="freelancer" freelancerHref={`/jobs/${job.id}`} clientHref={clientPath} />}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{job.title}</h1>
        <Badge tone="neutral">v{shown.versionNo}</Badge>
      </div>
      {job.clientName && <p className="mt-1 text-muted">For {job.clientName}</p>}
      <div className="mt-4">
        <JobTimeline current={stepIndex(job.status)} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {job.status === "DRAFT" && latest.changeRequest && (
            <Card className="border-held/40 p-5">
              <Badge tone="held">Client asked for changes to v{latest.versionNo - 1}</Badge>
              <blockquote className="mt-3 border-l-2 border-held/50 pl-3 text-pretty">{latest.changeRequest}</blockquote>
              <LinkButton href={`/jobs/${job.id}/brief`} className="mt-4">
                Revise the brief
              </LinkButton>
            </Card>
          )}
          {clientProposal && (
            <Card className="border-info/40 p-5">
              <Badge tone="info">The client proposed v{clientProposal.versionNo}</Badge>
              {clientProposal.changeRequest && <blockquote className="mt-3 border-l-2 border-info/50 pl-3 text-pretty">{clientProposal.changeRequest}</blockquote>}
              <p className="mt-3 text-sm text-muted">
                AI drafted these edits from the client&apos;s request and the client accepted them. Accept to lock the brief, or revise it and send your own
                version.
              </p>
              <ProposalActions jobId={job.id} versionId={clientProposal.id} hash={clientProposal.contentHash} versionNo={clientProposal.versionNo} />
            </Card>
          )}
          {clientProposal && beforeProposal && <VersionChanges changes={diffBriefs(beforeProposal.content, clientProposal.content)} fromVersion={beforeProposal.versionNo} />}
          <BriefView brief={shown.content} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <p className="text-sm text-muted">Total</p>
            <p className="tabular mt-1 font-mono text-3xl font-semibold">{formatCents(job.totalCents)}</p>
            <div className="mt-4">
              <MoneyBar totalCents={job.totalCents} authorizedCents={job.authorizedCents} releasedCents={job.capturedCents} />
            </div>
          </Card>

          <Card className="p-5">
            {job.status === "DRAFT" && !latest.changeRequest && (
              <>
                <h2 className="font-semibold">Draft</h2>
                <p className="mt-2 text-sm text-muted">Only you can see this brief. Review it, then send it to the client.</p>
                <LinkButton href={`/jobs/${job.id}/brief`} className="mt-4 w-full">
                  Edit and send
                </LinkButton>
              </>
            )}
            {job.status === "DRAFT" && latest.changeRequest && (
              <>
                <h2 className="font-semibold">Changes requested</h2>
                <p className="mt-2 text-sm text-muted">Revise the brief and send v{latest.versionNo}. The client keeps the same link.</p>
              </>
            )}
            {clientProposal && (
              <>
                <h2 className="font-semibold">Your turn</h2>
                <p className="mt-2 text-sm text-muted">The client proposed v{clientProposal.versionNo}. Accept it to lock the brief, or revise it.</p>
              </>
            )}
            {job.status === "PROPOSED" && !clientProposal && (
              <>
                <h2 className="font-semibold">{justSent ? `Sent v${latest.versionNo} to the client` : "Waiting for the client"}</h2>
                <p className="mt-2 text-sm text-muted">
                  Share this private link. The client can accept or ask for changes, no account needed. You&apos;ve already accepted v{latest.versionNo}.
                </p>
              </>
            )}
            {job.agreedVersionId && (
              <>
                <h2 className="font-semibold">Agreed on v{shown.versionNo}</h2>
                <p className="mt-2 text-sm text-muted">The brief is locked. Waiting for the client to fund the job with PayPal.</p>
              </>
            )}
            {clientUrl && (
              <div className="mt-4">
                <CopyLink url={clientUrl} />
              </div>
            )}
          </Card>

          <Activity events={events} />
        </aside>
      </div>
    </Container>
  );
}
