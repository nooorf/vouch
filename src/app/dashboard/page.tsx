import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { MoneyBar } from "@/components/money-bar";
import { Badge, Card, Container } from "@/components/ui";
import { db, schema } from "@/db";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

const statusTone = {
  DRAFT: "neutral",
  PROPOSED: "info",
  AGREED: "info",
  FUNDED: "held",
  IN_PROGRESS: "held",
  COMPLETED: "brand",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
} as const;

export default async function Dashboard() {
  const user = await requireUser();
  const jobs = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.ownerId, user.id))
    .orderBy(desc(schema.jobs.createdAt));

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Freelancer workspace</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your jobs</h1>
        </div>
      </div>

      {user.demo && (
        <p className="mt-6 rounded-lg border border-line bg-info-soft px-4 py-3 text-sm text-info">
          This is a private demo workspace. You are <strong>{user.name}</strong>, a freelancer. Anything you do here uses
          the PayPal sandbox and is visible only to you.
        </p>
      )}

      {jobs.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center px-6 py-16 text-center">
          <h2 className="font-semibold">No jobs yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted">
            Jobs you create appear here with their milestones and how much money is held or released.
          </p>
        </Card>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <Card className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 truncate font-semibold">{job.title}</h2>
                  <Badge tone={statusTone[job.status]}>{job.status.replace("_", " ").toLowerCase()}</Badge>
                </div>
                <p className="tabular mt-1 font-mono text-sm text-muted">{formatCents(job.totalCents)}</p>
                <div className="mt-4">
                  <MoneyBar totalCents={job.totalCents} authorizedCents={job.authorizedCents} releasedCents={job.capturedCents} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
