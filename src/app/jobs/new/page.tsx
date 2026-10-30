import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { NewJobForm } from "./new-job-form";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage() {
  await requireUser();
  return (
    <Container className="max-w-3xl py-10">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
        ← Your jobs
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">New job</h1>
      <p className="mt-2 text-muted">
        Describe the work. AI turns it into milestones with checkable acceptance criteria, which you can edit before the client
        sees anything.
      </p>
      <div className="mt-8">
        <NewJobForm />
      </div>
    </Container>
  );
}
