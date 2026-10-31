import type { schema } from "@/db";
import { formatCents } from "@/lib/money";
import type { Verdict } from "@/lib/policy/policy";
import type { Measurements, RecordedResult } from "@/lib/referee/evaluate";
import { AutoRefresh } from "./auto-refresh";
import { Countdown } from "./countdown";
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

/** Out of tries: what the client can do, and what happens if they don't. Shown to both sides. */
function DecisionNote({ m, viewer, freelancer, refundCents }: { m: Milestone; viewer: "freelancer" | "client"; freelancer: string; refundCents?: number }) {
  if (!m.decideBy) return null;
  const refund = refundCents !== undefined ? formatCents(refundCents) : "the unpaid money";
  return (
    <div className="mt-2 rounded-md border border-held/40 bg-held-soft px-3 py-2">
      {viewer === "freelancer" ? (
        <>
          You&apos;ve used every try for M{m.position}. The client decides within <Countdown endsAt={m.decideBy.toISOString()} />: give you another try, accept
          the work as is, skip the milestone, or end the project. If they don&apos;t decide, the project ends and {refund} goes back to them.
        </>
      ) : (
        <>
          {freelancer} has used every try for M{m.position}, so it&apos;s your call. Decide within <Countdown endsAt={m.decideBy.toISOString()} />; if you
          don&apos;t, the project ends and {refund} comes back to you.
        </>
      )}
    </div>
  );
}

function MoneyOutcome({
  ev,
  m,
  delivery,
  viewer,
  freelancer,
  refundCents,
}: {
  ev: Evaluation;
  m: Milestone;
  delivery: Delivery;
  viewer: "freelancer" | "client";
  freelancer: string;
  refundCents?: number;
}) {
  const remaining = m.amountCents - m.releasedCents;
  const endsAt = m.reviewEndsAt ? <Countdown endsAt={m.reviewEndsAt.toISOString()} /> : null;
  let body: React.ReactNode = null;

  if (delivery.withdrawnAt) {
    body = (
      <>
        {viewer === "freelancer" ? "You withdrew this delivery" : `${freelancer} withdrew this delivery`} before it settled, so nothing was released for it. It
        counts as try {delivery.attemptNo}.
        {m.status === "PARTIAL_HELD" ? ` ${formatCents(m.releasedCents)} from earlier deliveries stays released.` : ""}
      </>
    );
  } else if (m.status === "REVIEW_WINDOW") {
    if (ev.verdict === "NEEDS_HUMAN") {
      body = (
        <>
          The client decides. If they don&apos;t within {endsAt}, the window is extended once; after that {formatCents(ev.silenceReleaseCents ?? 0)} (the share backed
          by passing measured checks) is released.
        </>
      );
    } else if ((ev.releaseNowCents ?? 0) > 0) {
      const held = remaining - (ev.releaseNowCents ?? 0);
      body = (
        <>
          {formatCents(ev.releaseNowCents!)} is released to {freelancer} in {endsAt} unless the client approves sooner or disputes it.
          {held > 0 ? ` ${formatCents(held)} stays held until a fix is accepted.` : ""}
        </>
      );
    } else {
      body = <>Nothing is released. {formatCents(remaining)} stays held until a fix is accepted (window closes in {endsAt}).</>;
    }
  } else if (m.status === "DISPUTED") {
    body =
      ev.status === "done" && m.reevaluated ? (
        <>
          The client disputed the result and the AI checked again. The client decides within {endsAt}; if they don&apos;t,{" "}
          {ev.verdict === "NEEDS_HUMAN"
            ? `${formatCents(ev.silenceReleaseCents ?? 0)} (backed by measured checks) is released.`
            : (ev.releaseNowCents ?? 0) > 0
              ? `${formatCents(ev.releaseNowCents!)} is released.`
              : "nothing more is released."}
        </>
      ) : (
        <>The client disputed the result. The AI is checking the delivery again with their objection in mind.</>
      );
  } else if (m.status === "RELEASED") {
    body = <>Released in full: {formatCents(m.releasedCents)} paid to {freelancer}.</>;
  } else if (m.status === "PARTIAL_HELD") {
    body = <>{formatCents(m.releasedCents)} released; {formatCents(remaining)} stays held until a fix is accepted or the client releases it.</>;
  } else if (m.status === "HELD") {
    body = <>Nothing released yet; {formatCents(remaining)} stays held until a fix is accepted or the client releases it.</>;
  } else if (m.status === "CLOSED") {
    body = <>Closed by the client: {formatCents(m.releasedCents)} released; {formatCents(remaining)} goes back to the client.</>;
  }
  if (!body) return null;
  // Start refreshing a little before a window or decision deadline closes, so the outcome shows up on its own.
  const closesAt = (m.status === "REVIEW_WINDOW" || m.status === "DISPUTED") && m.reviewEndsAt ? m.reviewEndsAt : m.decideBy;
  return (
    <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
      {closesAt && <AutoRefresh seconds={4} from={new Date(closesAt.getTime() - 60_000).toISOString()} />}
      {body}
      <DecisionNote m={m} viewer={viewer} freelancer={freelancer} refundCents={refundCents} />
    </div>
  );
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
              {r.evidenceSource === "code" ? (
                <>
                  {r.evidenceVerified === true && <Badge tone="brand">Code found in the repo</Badge>}
                  {r.evidenceVerified === false && <Badge tone="danger">Code not found in the repo</Badge>}
                </>
              ) : (
                <>
                  {r.evidenceVerified === true && <Badge tone="brand">Quote found on the page</Badge>}
                  {r.evidenceVerified === false && <Badge tone="danger">Quote not found on the page</Badge>}
                </>
              )}
            </div>
            {r.evidenceSource === "code" && r.codeRefs?.length ? (
              <div className="space-y-2">
                {r.codeRefs.map((ref) => (
                  <figure key={`${ref.path}:${ref.startLine}`} className="overflow-hidden rounded-md border border-line">
                    <figcaption className="border-b border-line bg-surface-2 px-3 py-1 font-mono text-xs">
                      <a href={ref.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        {ref.path}:{ref.startLine}
                        {ref.endLine > ref.startLine ? `-${ref.endLine}` : ""}
                      </a>
                    </figcaption>
                    <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-muted">
                      {ref.snippet.split("\n").map((line, i) => (
                        <div key={i}>
                          <span className="mr-3 inline-block w-8 text-right opacity-50 select-none">{ref.startLine + i}</span>
                          {line}
                        </div>
                      ))}
                    </pre>
                  </figure>
                ))}
              </div>
            ) : (
              r.evidence && r.evidenceSource !== "code" && <blockquote className="border-l-2 border-line pl-3 text-muted italic">{r.evidence}</blockquote>
            )}
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
  refundCents,
}: {
  m: Milestone;
  ev: Evaluation;
  delivery: Delivery;
  viewer: "freelancer" | "client";
  freelancer: string;
  maxAttempts: number;
  /** What the client gets back if the project ends now, for the out-of-tries note. */
  refundCents?: number;
}) {
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-muted">
          M{m.position} delivery · try {Math.min(delivery.attemptNo, maxAttempts)} of {maxAttempts}
          {ev.kind === "reevaluation" ? " · re-check after the client's dispute" : ""}
        </p>
        <a href={delivery.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-brand hover:underline">
          {delivery.url}
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {delivery.withdrawnAt && <Badge tone="neutral">Withdrawn</Badge>}
        {ev.status === "done" && ev.verdict && <Badge tone={verdictView[ev.verdict].tone}>{verdictView[ev.verdict].label}</Badge>}
      </div>
    </div>
  );

  if (delivery.withdrawnAt && ev.status !== "done") {
    return (
      <Card className="p-5">
        {header}
        <div className="mt-4">
          <MoneyOutcome ev={ev} m={m} delivery={delivery} viewer={viewer} freelancer={freelancer} refundCents={refundCents} />
        </div>
      </Card>
    );
  }

  if (ev.status === "queued" || ev.status === "running") {
    return (
      <Card className="p-5" aria-live="polite">
        {header}
        <AutoRefresh seconds={3} />
        <p className="mt-4 flex items-center gap-2 text-sm">
          <span className="size-2 animate-pulse rounded-full bg-held" aria-hidden="true" />
          {ev.kind === "reevaluation"
            ? "Re-checking the delivery with the client's objection: measured checks again, then the AI judge. Usually under a minute."
            : "Checking the delivery: loading the page, running the measured checks and Google Lighthouse, then the AI judge. Usually under a minute."}
        </p>
      </Card>
    );
  }

  if (ev.status === "error") {
    return (
      <Card className="p-5">
        {header}
        <p className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          The check couldn&apos;t finish{ev.error ? `: ${ev.error}` : "."} {viewer === "freelancer" ? "You can submit again; this didn't use up a try." : ""}
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
        <MoneyOutcome ev={ev} m={m} delivery={delivery} viewer={viewer} freelancer={freelancer} refundCents={refundCents} />
        {ev.kind === "reevaluation" && m.disputeNote && (
          <blockquote className="border-l-2 border-info/50 pl-3 text-sm text-muted">Client&apos;s objection: “{m.disputeNote}”</blockquote>
        )}
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

      {report?.rendered && (
        <p className="mt-3 text-xs text-muted">
          Loaded in a real browser ({report.rendered.renderer === "kernel" ? "Kernel cloud browser" : "Chrome"}, phone then desktop):{" "}
          {report.rendered.pageErrors.length ? `${report.rendered.pageErrors.length} JavaScript error(s)` : "no JavaScript errors"} ·{" "}
          {report.rendered.failedRequests.length ? `${report.rendered.failedRequests.length} failed request(s)` : "every request answered"} ·{" "}
          {report.rendered.mobileOverflow ? "spills off a phone screen" : "fits a phone screen"}
        </p>
      )}
      {report && !report.rendered && report.renderError && <p className="mt-3 text-xs text-muted">Not loaded in a real browser: {report.renderError}.</p>}
      {measurements?.code?.repo && (
        <p className="mt-3 text-xs text-muted">
          Code read from{" "}
          <a
            href={`https://github.com/${measurements.code.repo.owner}/${measurements.code.repo.repo}/tree/${measurements.code.repo.sha}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-brand hover:underline"
          >
            {measurements.code.repo.owner}/{measurements.code.repo.repo}@{measurements.code.repo.sha.slice(0, 7)}
          </a>{" "}
          ({measurements.code.repo.branch}): {measurements.code.clipped ? `the ${measurements.code.filesShown.length} files most relevant to the questions` : `all ${measurements.code.filesShown.length} source files`}
          {measurements.code.repo.skipped ? `; ${measurements.code.repo.skipped} dependency, build or binary files skipped` : ""}.
        </p>
      )}
      {measurements?.code?.error && !measurements.code.repo && <p className="mt-3 text-xs text-muted">The code couldn&apos;t be read: {measurements.code.error}</p>}
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
