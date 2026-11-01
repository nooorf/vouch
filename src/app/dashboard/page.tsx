import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { MoneyBar } from "@/components/money-bar";
import { Badge, Callout, Card, Container, LinkButton } from "@/components/ui";
import { db, schema } from "@/db";
import { formatCents, returnedCents } from "@/lib/money";
import { syncNotices, unreadForOwner } from "@/lib/notify";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

const statusView = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PROPOSED: { label: "Sent to client", tone: "info" },
  AGREED: { label: "Agreed", tone: "info" },
  FUNDED: { label: "Funded", tone: "ok" },
  IN_PROGRESS: { label: "In progress", tone: "ok" },
  COMPLETED: { label: "Completed", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
} as const;

type Job = typeof schema.jobs.$inferSelect;

function JobRow({ job, unread }: { job: Job; unread: number }) {
  const v = statusView[job.status];
  return (
    <li>
      <Link href={`/jobs/${job.id}`} className="group grid grid-cols-1 gap-4 px-5 py-5 transition-colors hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold group-hover:text-brand">{job.title}</h3>
            {unread > 0 && <Badge tone="brand">{unread} new</Badge>}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            {job.clientName ? `For ${job.clientName}` : "No client name"} · <span className="amount text-ink">{formatCents(job.totalCents)}</span>
          </p>
        </div>
        <div className="min-w-0" title="Released / held / not funded">
          <MoneyBar totalCents={job.totalCents} authorizedCents={job.authorizedCents} releasedCents={job.capturedCents} returnedCents={returnedCents(job)} size="sm" />
          <p className="amount mt-1.5 text-xs text-muted">
            {formatCents(job.capturedCents)} <span className="text-faint">released</span>
          </p>
        </div>
        <div className="sm:justify-self-end">
          <Badge tone={v.tone} dot>
            {v.label}
          </Badge>
        </div>
      </Link>
    </li>
  );
}

function JobList({ title, jobs, unread }: { title: string; jobs: Job[]; unread: Map<string, number> }) {
  if (!jobs.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-muted">
        {title} <span className="tabular text-faint">{jobs.length}</span>
      </h2>
      <Card className="mt-3 overflow-hidden">
        <ul className="divide-y divide-line">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} unread={unread.get(job.id) ?? 0} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

export default async function Dashboard() {
  const user = await requireUser();
  const jobs = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.ownerId, user.id))
    .orderBy(desc(schema.jobs.createdAt));
  // Pick up anything the client did since the freelancer last looked (cheap: no PayPal calls).
  const live = jobs.filter((j) => !["COMPLETED", "CANCELLED", "EXPIRED"].includes(j.status));
  await Promise.all(live.map((j) => syncNotices(j.id).catch(() => 0)));
  const unread = await unreadForOwner(user.id);

  const finished = (j: Job) => ["COMPLETED", "CANCELLED", "EXPIRED"].includes(j.status);
  const attention = jobs.filter((j) => !finished(j) && ((unread.get(j.id) ?? 0) > 0 || j.status === "DRAFT"));
  const active = jobs.filter((j) => !finished(j) && !attention.includes(j));
  const done = jobs.filter(finished);
  // Money PayPal still holds: authorized on live jobs, not yet captured. Finished jobs hold nothing.
  const held = jobs.filter((j) => !finished(j)).reduce((s, j) => s + Math.max(0, j.authorizedCents - j.capturedCents), 0);
  const paid = jobs.reduce((s, j) => s + j.capturedCents, 0);

  return (
    <Container className="py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Freelancer workspace</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Your jobs</h1>
        </div>
        <LinkButton href="/jobs/new" size="lg">
          New job
        </LinkButton>
      </div>

      {user.demo && (
        <Callout tone="info" className="mt-8">
          This is a private demo workspace. You are <strong>{user.name}</strong>, a freelancer. Anything you do here uses the PayPal sandbox and is visible only to you.
        </Callout>
      )}

      {jobs.length > 0 && (
        <dl className="mt-8 grid grid-cols-3 gap-4 sm:max-w-xl">
          <div>
            <dt className="text-xs text-muted">Jobs</dt>
            <dd className="amount mt-1 text-2xl font-semibold">{jobs.length}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              <span className="held-stripes size-2 rounded-full" aria-hidden="true" />
              Held for you
            </dt>
            <dd className="amount mt-1 text-2xl font-semibold">{formatCents(held)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              <span className="size-2 rounded-full bg-released-fill" aria-hidden="true" />
              Paid to you
            </dt>
            <dd className="amount mt-1 text-2xl font-semibold">{formatCents(paid)}</dd>
          </div>
        </dl>
      )}

      {jobs.length === 0 ? (
        <Card className="mt-10 flex flex-col items-center px-6 py-20 text-center">
          <h2 className="text-lg font-semibold">No jobs yet</h2>
          <p className="mt-2 max-w-sm text-sm text-pretty text-muted">
            Describe a job in plain words and AI drafts a brief with milestones and checkable criteria.
          </p>
          <LinkButton href="/jobs/new" size="lg" className="mt-8">
            Create your first job
          </LinkButton>
        </Card>
      ) : (
        <>
          <JobList title="Needs you" jobs={attention} unread={unread} />
          <JobList title="In progress" jobs={active} unread={unread} />
          <JobList title="Finished" jobs={done} unread={unread} />
        </>
      )}
    </Container>
  );
}
