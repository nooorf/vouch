import type { schema } from "@/db";
import { formatCents, splitByShares } from "@/lib/money";
import type { Verdict } from "@/lib/policy/policy";
import type { Measurements, RecordedResult } from "@/lib/referee/evaluate";
import { AutoRefresh } from "./auto-refresh";
import { Countdown } from "./countdown";
import { Badge, Callout, Card } from "./ui";

type Evaluation = typeof schema.evaluations.$inferSelect;
type Delivery = typeof schema.deliveries.$inferSelect;
type Milestone = typeof schema.milestones.$inferSelect;

const verdictView: Record<Verdict, { label: string; tone: "ok" | "held" | "danger" | "info" }> = {
  PASS: { label: "Passed", tone: "ok" },
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
    <div className="mt-3 rounded-lg border border-held-fill/40 bg-held-soft px-3.5 py-2.5 text-ink">
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
    <div className="rounded-xl bg-surface-2 px-4 py-3.5 text-sm">
      {closesAt && <AutoRefresh seconds={4} from={new Date(closesAt.getTime() - 60_000).toISOString()} />}
      <p className="mb-1 text-xs font-medium text-muted">What happens to the money</p>
      <p className="text-pretty">{body}</p>
      <DecisionNote m={m} viewer={viewer} freelancer={freelancer} refundCents={refundCents} />
    </div>
  );
}

function Evidence({ r }: { r: RecordedResult }) {
  return (
    <div className="mt-2 space-y-2">
      {r.evidenceSource === "code" && r.codeRefs?.length ? (
        <div className="space-y-2">
          {r.codeRefs.map((ref) => (
            <figure key={`${ref.path}:${ref.startLine}`} className="overflow-hidden rounded-lg border border-line">
              <figcaption className="border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-xs">
                <a href={ref.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  {ref.path}:{ref.startLine}
                  {ref.endLine > ref.startLine ? `-${ref.endLine}` : ""}
                </a>
              </figcaption>
              <pre className="overflow-x-auto bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-muted">
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
        r.evidence && r.evidenceSource !== "code" && <blockquote className="border-l-2 border-line-strong pl-3 text-muted italic">{r.evidence}</blockquote>
      )}
      {r.explanation && <p className="text-pretty text-muted">{r.explanation}</p>}
    </div>
  );
}

const statusIcon = {
  pass: { c: "bg-released-soft text-released", s: "✓", l: "passed" },
  fail: { c: "bg-danger-soft text-danger", s: "✗", l: "failed" },
  unknown: { c: "bg-held-soft text-held", s: "?", l: "couldn't be measured" },
} as const;

function ResultRow({ r, valueCents }: { r: RecordedResult; valueCents: number }) {
  const icon = r.status === "pass" ? statusIcon.pass : r.status === "fail" ? statusIcon.fail : statusIcon.unknown;
  const verified =
    r.evidenceVerified === true
      ? { c: "text-released", t: r.evidenceSource === "code" ? "code found in the repo" : "quote found on the page" }
      : r.evidenceVerified === false
        ? { c: "font-medium text-danger", t: r.evidenceSource === "code" ? "code not found in the repo" : "quote not found on the page" }
        : null;
  const passed = r.status === "pass";
  return (
    <li className="flex gap-3 py-4 text-sm">
      <span className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${icon.c}`} aria-label={icon.l}>
        {icon.s}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-x-4">
          <p className="min-w-0 flex-1 font-medium text-pretty">
            {r.label}
            {r.required && <span className="ml-2 rounded-full bg-held-soft px-2 py-0.5 text-[11px] font-medium text-held">must pass</span>}
          </p>
          <span className="amount shrink-0 text-xs text-muted">{formatCents(valueCents)}</span>
        </div>
        {r.kind === "check" ? (
          <p className="mt-1 text-pretty text-muted">{r.evidence}</p>
        ) : (
          <>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span>AI · {Math.round((r.confidence ?? 0) * 100)}% sure</span>
              {r.evidenceSource === "screenshot" && r.evidenceVerified !== false && <span>· from the screenshot</span>}
              {verified && <span className={verified.c}>· {verified.t}</span>}
            </p>
            {passed ? (
              <details className="mt-1">
                <summary className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-brand hover:text-brand-hover">
                  <span className="chevron inline-block transition-transform" aria-hidden="true">
                    ›
                  </span>
                  Show evidence
                </summary>
                <Evidence r={r} />
              </details>
            ) : (
              <Evidence r={r} />
            )}
          </>
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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          M{m.position} delivery · try {Math.min(delivery.attemptNo, maxAttempts)} of {maxAttempts}
          {ev.kind === "reevaluation" ? " · re-check after the client's dispute" : ""}
        </p>
        <a href={delivery.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-sm text-brand hover:underline">
          {delivery.url}
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {delivery.withdrawnAt && <Badge tone="neutral">Withdrawn</Badge>}
        {ev.status === "done" && ev.verdict && (
          <Badge tone={verdictView[ev.verdict].tone} dot>
            {verdictView[ev.verdict].label}
          </Badge>
        )}
      </div>
    </div>
  );

  if (delivery.withdrawnAt && ev.status !== "done") {
    return (
      <Card className="p-5 sm:p-6">
        {header}
        <div className="mt-4">
          <MoneyOutcome ev={ev} m={m} delivery={delivery} viewer={viewer} freelancer={freelancer} refundCents={refundCents} />
        </div>
      </Card>
    );
  }

  if (ev.status === "queued" || ev.status === "running") {
    return (
      <Card className="p-5 sm:p-6" aria-live="polite">
        {header}
        <AutoRefresh seconds={3} />
        <p className="mt-4 flex items-center gap-2 text-sm">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-held-fill" aria-hidden="true" />
          {ev.kind === "reevaluation"
            ? "Re-checking the delivery with the client's objection: measured checks again, then the AI judge. Usually under a minute."
            : "Checking the delivery: loading the page, running the measured checks and Google Lighthouse, then the AI judge. Usually under a minute."}
        </p>
      </Card>
    );
  }

  if (ev.status === "error") {
    return (
      <Card className="p-5 sm:p-6">
        {header}
        <Callout tone="danger" className="mt-4">
          The check couldn&apos;t finish{ev.error ? `: ${ev.error}` : "."} {viewer === "freelancer" ? "You can submit again; this didn't use up a try." : ""}
        </Callout>
      </Card>
    );
  }

  const results = ev.results ?? [];
  const rowCents = splitByShares(m.amountCents, results.map((r) => r.weight));
  const measurements = ev.measurements as unknown as Measurements | null;
  const report = measurements?.report;
  const ps = report?.pagespeed;
  const judgeInfo = measurements?.judge;

  const counts = {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    unknown: results.filter((r) => r.status !== "pass" && r.status !== "fail").length,
  };
  const howChecked: React.ReactNode[] = [];
  if (report?.rendered)
    howChecked.push(
      <>
        Loaded in a real browser ({report.rendered.renderer === "kernel" ? "Kernel cloud browser" : "Chrome"}, phone then desktop):{" "}
        {report.rendered.pageErrors.length ? `${report.rendered.pageErrors.length} JavaScript error(s)` : "no JavaScript errors"},{" "}
        {report.rendered.failedRequests.length ? `${report.rendered.failedRequests.length} failed request(s)` : "every request answered"},{" "}
        {report.rendered.mobileOverflow ? "spills off a phone screen" : "fits a phone screen"}.
      </>,
    );
  if (report && !report.rendered && report.renderError) howChecked.push(<>Not loaded in a real browser: {report.renderError}.</>);
  if (measurements?.code?.repo)
    howChecked.push(
      <>
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
      </>,
    );
  if (measurements?.code?.error && !measurements.code.repo) howChecked.push(<>The code couldn&apos;t be read: {measurements.code.error}</>);
  if (ps?.ok)
    howChecked.push(
      <>
        Google Lighthouse (mobile): accessibility {ps.scores.accessibility ?? "–"}, performance {ps.scores.performance ?? "–"}, SEO {ps.scores.seo ?? "–"}.
      </>,
    );
  howChecked.push(
    <>
      Checked {when(ev.finishedAt)}
      {ev.finishedAt ? ` in ${Math.max(1, Math.round((ev.finishedAt.getTime() - ev.createdAt.getTime()) / 1000))} s` : ""}
      {judgeInfo && "model" in judgeInfo ? `, AI judge ${judgeInfo.model}` : ""}
      {judgeInfo && "error" in judgeInfo ? ", AI judge unavailable" : ""}.
    </>,
  );

  return (
    <Card className="p-5 sm:p-6">
      {header}
      <div className="mt-5 space-y-3">
        <MoneyOutcome ev={ev} m={m} delivery={delivery} viewer={viewer} freelancer={freelancer} refundCents={refundCents} />
        {report?.suspicious.flagged && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm">
            <p className="font-semibold text-danger">This delivery contains instructions aimed at an AI grader</p>
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
        {viewer === "freelancer" && ev.verdict !== "PASS" && (ev.fixList?.length ?? 0) > 0 && (
          <div className="rounded-xl border border-held-fill/40 bg-held-soft p-4 text-sm">
            <p className="font-semibold text-held">To fix before resubmitting</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-held-fill">
              {ev.fixList!.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {ev.kind === "reevaluation" && m.disputeNote && (
          <blockquote className="border-l-2 border-brand/40 pl-3 text-sm text-muted">Client&apos;s objection: “{m.disputeNote}”</blockquote>
        )}
        {ev.reasons && ev.reasons.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted marker:text-faint">
            {ev.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      {results.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Criteria</h3>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="text-released">{counts.pass} passed</span>
              {counts.fail > 0 && <span className="font-medium text-danger">{counts.fail} failed</span>}
              {counts.unknown > 0 && <span className="font-medium text-held">{counts.unknown} unsure</span>}
              <span className="text-faint">of {results.length}</span>
            </p>
          </div>
          <ul className="mt-1 divide-y divide-line">
            {results.map((r, i) => (
              <ResultRow key={r.id} r={r} valueCents={rowCents[i]} />
            ))}
          </ul>
        </>
      )}

      <ul className="mt-4 space-y-1 border-t border-line pt-4 text-xs text-muted">
        {howChecked.map((item, i) => (
          <li key={i} className="text-pretty">
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}
