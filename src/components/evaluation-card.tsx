import type { schema } from "@/db";
import { formatCents } from "@/lib/money";
import type { Verdict } from "@/lib/policy/policy";
import type { Measurements, RecordedResult } from "@/lib/referee/evaluate";
import { AutoRefresh } from "./auto-refresh";
import { Badge, Card } from "./ui";

type Evaluation = typeof schema.evaluations.$inferSelect;
type Delivery = typeof schema.deliveries.$inferSelect;
type Milestone = typeof schema.milestones.$inferSelect;

const verdictView: Record<Verdict, { label: string; tone: "brand" | "held" | "danger" | "info" }> = {
  PASS: { label: "Passed", tone: "brand" },
  PARTIAL: { label: "Partly met", tone: "held" },
  FAIL: { label: "Not met", tone: "danger" },
  NEEDS_HUMAN: { label: "Needs a person", tone: "info" },
};

const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "");

function MoneyOutcome({ ev, m, freelancer }: { ev: Evaluation; m: Milestone; freelancer: string }) {
  const held = m.amountCents - m.releasedCents - (ev.releaseNowCents ?? 0);
  if (m.status !== "REVIEW_WINDOW") return null;
  let text: string;
  if (ev.verdict === "NEEDS_HUMAN") {
    text = `The client decides. If they don't respond by ${when(m.reviewEndsAt)}, the window is extended once; after that ${formatCents(ev.silenceReleaseCents ?? 0)} (the share backed by passing measured checks) is released.`;
  } else if ((ev.releaseNowCents ?? 0) > 0) {
    text = `${formatCents(ev.releaseNowCents!)} is released to ${freelancer} when the review window closes (${when(m.reviewEndsAt)}), unless the client disputes it.${held > 0 ? ` ${formatCents(held)} stays held until a fix is accepted.` : ""}`;
  } else {
    text = `Nothing is released. ${formatCents(held)} stays held until a fix is accepted.`;
  }
  return <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm">{text}</p>;
}

function ResultRow({ r, valueCents }: { r: RecordedResult; valueCents: number }) {
  const icon = r.status === "pass" ? { c: "text-brand", s: "✓", l: "passed" } : r.status === "fail" ? { c: "text-danger", s: "✗", l: "failed" } : { c: "text-held", s: "?", l: "couldn't be measured" };
  return (
    <li className="flex gap-3 py-3 text-sm">
      <span className={`mt-0.5 w-4 shrink-0 text-center font-bold ${icon.c}`} aria-label={icon.l}>
        {icon.s}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 font-medium">
            {r.label}
            {r.required && <span className="ml-2 text-xs font-medium text-held">must pass</span>}
          </p>
          <span className="tabular shrink-0 font-mono text-xs text-muted">{formatCents(valueCents)}</span>
        </div>
        {r.kind === "check" ? (
          <p className="mt-1 text-muted">{r.evidence}</p>
        ) : (
          <div className="mt-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="info">AI · {Math.round((r.confidence ?? 0) * 100)}% sure</Badge>
              {r.evidenceSource === "screenshot" && r.evidenceVerified !== false && <Badge tone="neutral">From the screenshot</Badge>}
              {r.evidenceVerified === true && <Badge tone="brand">Quote found on the page</Badge>}
              {r.evidenceVerified === false && <Badge tone="danger">Quote not found on the page</Badge>}
            </div>
            {r.evidence && <blockquote className="border-l-2 border-line pl-3 text-muted italic">{r.evidence}</blockquote>}
            {r.explanation && <p className="text-muted">{r.explanation}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

export function EvaluationCard({
  m,
  ev,
  delivery,
  viewer,
  freelancer,
  maxAttempts,
}: {
  m: Milestone;
  ev: Evaluation;
  delivery: Delivery;
  viewer: "freelancer" | "client";
  freelancer: string;
  maxAttempts: number;
}) {
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-muted">
          M{m.position} delivery · attempt {delivery.attemptNo} of {maxAttempts}
        </p>
        <a href={delivery.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-brand hover:underline">
          {delivery.url}
        </a>
      </div>
      {ev.status === "done" && ev.verdict && <Badge tone={verdictView[ev.verdict].tone}>{verdictView[ev.verdict].label}</Badge>}
    </div>
  );

  if (ev.status === "queued" || ev.status === "running") {
    return (
      <Card className="p-5" aria-live="polite">
        {header}
        <AutoRefresh seconds={3} />
        <p className="mt-4 flex items-center gap-2 text-sm">
          <span className="size-2 animate-pulse rounded-full bg-held" aria-hidden="true" />
          Checking the delivery: loading the page, running the measured checks and Google Lighthouse, then the AI judge. Usually under a minute.
        </p>
      </Card>
    );
  }

  if (ev.status === "error") {
    return (
      <Card className="p-5">
        {header}
        <p className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          The check couldn&apos;t finish{ev.error ? `: ${ev.error}` : "."} {viewer === "freelancer" ? "You can submit again; this didn't use up an attempt." : ""}
        </p>
      </Card>
    );
  }

  const results = ev.results ?? [];
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  const measurements = ev.measurements as unknown as Measurements | null;
  const report = measurements?.report;
  const ps = report?.pagespeed;
  const judgeInfo = measurements?.judge;

  return (
    <Card className="p-5">
      {header}
      <div className="mt-4 space-y-3">
        <MoneyOutcome ev={ev} m={m} freelancer={freelancer} />
        {ev.reasons && ev.reasons.length > 0 && (
          <ul className="space-y-1 text-sm text-muted">
            {ev.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        )}
        {report?.suspicious.flagged && (
          <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm">
            <p className="font-medium text-danger">This delivery contains instructions aimed at an AI grader</p>
            <p className="mt-1 text-muted">Vouch never pays on what a page tells the AI. A person decides, and nothing is released automatically.</p>
            <ul className="mt-2 space-y-1">
              {report.suspicious.findings.map((f, i) => (
                <li key={i} className="text-ink">
                  <span className="text-muted">In a {f.where}:</span> “{f.excerpt}”
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ul className="mt-4 divide-y divide-line border-t border-line">
        {results.map((r) => (
          <ResultRow key={r.id} r={r} valueCents={totalWeight ? Math.floor((m.amountCents * r.weight) / totalWeight) : 0} />
        ))}
      </ul>

      {ps?.ok && (
        <p className="mt-3 text-xs text-muted">
          Google Lighthouse (mobile): accessibility {ps.scores.accessibility ?? "–"} · performance {ps.scores.performance ?? "–"} · SEO {ps.scores.seo ?? "–"}
        </p>
      )}

      {viewer === "freelancer" && ev.verdict !== "PASS" && (ev.fixList?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-lg bg-held-soft p-4 text-sm">
          <p className="font-medium text-held">To fix before resubmitting</p>
          <ul className="mt-2 space-y-1">
            {ev.fixList!.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        Checked {when(ev.finishedAt)}
        {ev.finishedAt ? ` in ${Math.max(1, Math.round((ev.finishedAt.getTime() - ev.createdAt.getTime()) / 1000))} s` : ""}
        {judgeInfo && "model" in judgeInfo ? ` · AI judge ${judgeInfo.model}` : ""}
        {judgeInfo && "error" in judgeInfo ? " · AI judge unavailable" : ""}
      </p>
    </Card>
  );
}
