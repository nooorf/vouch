import type { Metadata } from "next";
import Link from "next/link";
import { Card, Container } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { NewJobForm } from "./new-job-form";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage() {
  await requireUser();
  return (
    <Container className="max-w-3xl py-8 sm:py-12">
      <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
        ← Your jobs
      </Link>
      <h1 className="mt-6 text-3xl font-semibold sm:text-4xl">New job</h1>
      <p className="mt-3 text-pretty text-muted">
        Describe the work. AI turns it into milestones with checkable acceptance criteria, which you can edit before the client
        sees anything.
      </p>
      <Card className="mt-10 p-5 sm:p-8">
        <NewJobForm />
      </Card>
    </Container>
  );
}
