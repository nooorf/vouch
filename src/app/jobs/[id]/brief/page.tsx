import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Badge, Card, Container } from "@/components/ui";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { BriefEditor } from "./brief-editor";

export const metadata: Metadata = { title: "Brief" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BriefPage(props: PageProps<"/jobs/[id]/brief">) {
  const { id } = await props.params;
  const user = await requireUser();
  if (!UUID.test(id)) notFound();

  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.ownerId, user.id)));
  if (!job) notFound();

  const [version] = await db
    .select()
    .from(schema.briefVersions)
    .where(eq(schema.briefVersions.jobId, id))
    .orderBy(desc(schema.briefVersions.versionNo))
    .limit(1);
  if (!version) notFound();
  // Once sent, the brief is read-only; the job page shows it.
  if (job.status !== "DRAFT") redirect(`/jobs/${job.id}`);

  return (
    <Container className="py-10">
      <Link href={`/jobs/${job.id}`} className="text-sm text-muted hover:text-ink">
        ← Job overview
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Edit the brief</h1>
        <Badge tone={version.proposedBy === "ai" ? "info" : "neutral"}>
          v{version.versionNo} · {version.proposedBy === "ai" ? "drafted by AI" : version.changeRequest ? "revision" : "edited by you"}
        </Badge>
      </div>
      <p className="mt-2 max-w-2xl text-muted">
        Check every milestone and criterion. Once the client accepts the same version, this is exactly what deliveries are
        checked against and what decides how much money is released.
      </p>
      {version.changeRequest && (
        <Card className="mt-6 border-held/40 p-5">
          <Badge tone="held">The client asked for changes to v{version.versionNo - 1}</Badge>
          <blockquote className="mt-3 border-l-2 border-held/50 pl-3 text-pretty">{version.changeRequest}</blockquote>
        </Card>
      )}
      <div className="mt-8">
        <BriefEditor jobId={job.id} initial={version.content} editable={job.status === "DRAFT"} versionNo={version.versionNo} />
      </div>
    </Container>
  );
}
