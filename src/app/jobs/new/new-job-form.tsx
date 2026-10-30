"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createJob, type NewJobState } from "@/app/actions/jobs";
import { Button, Card } from "@/components/ui";
import { EXAMPLE_JOB } from "@/lib/brief/example";


const DRAFT_STEPS = [
  "Reading your description",
  "Splitting the price into milestones",
  "Choosing measurable checks",
  "Writing questions only a person can judge",
  "Checking the brief adds up",
];

function DraftingCard() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, DRAFT_STEPS.length - 1)), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <Card className="p-6" aria-live="polite">
      <p className="font-medium">Gemini is drafting your brief…</p>
      <ol className="mt-4 space-y-2 text-sm">
        {DRAFT_STEPS.map((label, i) => (
          <li key={label} className={`flex items-center gap-2 ${i > step ? "text-muted/60" : i === step ? "text-ink" : "text-muted"}`}>
            <span
              className={`size-2 rounded-full ${i < step ? "bg-brand" : i === step ? "animate-pulse bg-held" : "bg-unfunded"}`}
              aria-hidden="true"
            />
            {label}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted">Usually 5 to 20 seconds.</p>
    </Card>
  );
}

function SubmitArea() {
  const { pending } = useFormStatus();
  return pending ? (
    <DraftingCard />
  ) : (
    <Button type="submit" size="lg" className="w-full sm:w-auto">
      Draft the brief with AI
    </Button>
  );
}

const field = "mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-sm text-danger">{message}</p> : null;
}

export function NewJobForm() {
  const [state, action] = useActionState<NewJobState, FormData>(createJob, {});
  const formRef = useRef<HTMLFormElement>(null);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};

  function fillExample() {
    const form = formRef.current;
    if (!form) return;
    for (const [name, value] of Object.entries(EXAMPLE_JOB)) {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) el.value = value;
    }
  }

  return (
    <form ref={formRef} action={action} className="space-y-6">
      {state.error && (
        <p role="alert" className="rounded-lg border border-line bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div>
        <div className="flex items-end justify-between gap-3">
          <label htmlFor="description" className="font-medium">
            What&apos;s the job?
          </label>
          <button type="button" onClick={fillExample} className="text-sm text-brand hover:underline">
            Use the coffee roastery example
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Write it the way you would message the client. Mention what the site needs and anything that must work.</p>
        <textarea
          id="description"
          name="description"
          rows={7}
          required
          defaultValue={v.description}
          className={field}
          placeholder="A landing page for a local bakery with their menu, opening hours, a gallery and a contact form. Needs to work well on phones…"
        />
        <FieldError message={e.description} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="priceUsd" className="font-medium">
            Total price (USD)
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 mt-[3px] -translate-y-1/2 text-muted">$</span>
            <input id="priceUsd" name="priceUsd" type="number" inputMode="decimal" min={10} max={10000} step="0.01" required defaultValue={v.priceUsd} className={`${field} tabular pl-7 font-mono`} />
          </div>
          <FieldError message={e.priceUsd} />
        </div>
        <div>
          <label htmlFor="deadlineDays" className="font-medium">
            Deadline (days after funding)
          </label>
          <input id="deadlineDays" name="deadlineDays" type="number" min={1} max={25} step={1} required defaultValue={v.deadlineDays ?? "14"} className={`${field} tabular font-mono`} />
          <FieldError message={e.deadlineDays} />
        </div>
        <div>
          <label htmlFor="clientName" className="font-medium">
            Client name <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="clientName" name="clientName" type="text" maxLength={80} defaultValue={v.clientName} className={field} />
          <FieldError message={e.clientName} />
        </div>
        <div>
          <label htmlFor="clientEmail" className="font-medium">
            Client email <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="clientEmail" name="clientEmail" type="email" maxLength={200} defaultValue={v.clientEmail} className={field} />
          <FieldError message={e.clientEmail} />
        </div>
      </div>

      <SubmitArea />
    </form>
  );
}
