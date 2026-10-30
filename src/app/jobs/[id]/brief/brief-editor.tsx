"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveBrief } from "@/app/actions/jobs";
import { Badge, Button, Card } from "@/components/ui";
import { CHECKS, CHECK_IDS, DEFAULT_PARAMS, type CheckId, type ParamField } from "@/lib/brief/checks";
import { lintBrief, measuredShare, type Lint } from "@/lib/brief/lint";
import { MAX_JOB_DAYS, type Brief, type Criterion, type Milestone } from "@/lib/brief/schema";
import { formatCents } from "@/lib/money";

const input =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";
const small = "rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

const uid = () => Math.random().toString(36).slice(2, 8);
const GROUPS = { page: "Page", lighthouse: "Google Lighthouse", repo: "GitHub repo" } as const;

/* ------------------------------------------------------------------ */
/* Small inputs                                                         */
/* ------------------------------------------------------------------ */

function MoneyInput({ cents, onChange, label }: { cents: number; onChange: (c: number) => void; label: string }) {
  const [text, setText] = useState((cents / 100).toString());
  // Follow outside changes to `cents` without clobbering what the user is typing ("150." stays "150.").
  const [synced, setSynced] = useState(cents);
  if (cents !== synced) {
    setSynced(cents);
    if (Math.round(parseFloat(text) * 100) !== cents) setText((cents / 100).toString());
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted">$</span>
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Math.round(parseFloat(e.target.value) * 100);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
        className={`${small} tabular w-28 pl-6 font-mono`}
      />
    </div>
  );
}

function IntInput({ value, onChange, min, max, label, className = "w-16" }: { value: number; onChange: (n: number) => void; min: number; max: number; label: string; className?: string }) {
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={1}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      className={`${small} tabular font-mono ${className}`}
    />
  );
}

function LintList({ lints }: { lints: Lint[] }) {
  if (!lints.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {lints.map((l, i) => (
        <li key={i} className={`flex gap-2 text-xs ${l.level === "warn" ? "text-held" : "text-muted"}`}>
          <span aria-hidden="true">{l.level === "warn" ? "▲" : "ⓘ"}</span>
          {l.message}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Criteria                                                             */
/* ------------------------------------------------------------------ */

function ParamInput({ field, params, onChange }: { field: ParamField; params: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const value = params[field.key];
  if (field.type === "int") {
    return (
      <label className="flex items-center gap-2 text-sm text-muted">
        {field.label}
        <IntInput value={Number(value)} min={field.min} max={field.max} label={field.label} onChange={(n) => onChange({ ...params, [field.key]: n })} />
        {field.suffix}
      </label>
    );
  }
  if (field.type === "percent") {
    return (
      <label className="flex items-center gap-2 text-sm text-muted">
        {field.label}
        <IntInput value={Math.round(Number(value) * 100)} min={0} max={100} label={field.label} onChange={(n) => onChange({ ...params, [field.key]: n / 100 })} />%
      </label>
    );
  }
  const list = Array.isArray(value) ? (value as string[]) : [];
  return (
    <label className="flex w-full flex-col gap-1 text-sm text-muted">
      {field.label} <span className="text-xs">(comma separated)</span>
      <input
        defaultValue={list.join(", ")}
        placeholder={field.placeholder}
        onChange={(e) =>
          onChange({
            ...params,
            [field.key]: e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 10),
          })
        }
        className={`${small} w-full`}
      />
    </label>
  );
}

function CriterionRow({
  c,
  lints,
  valueCents,
  onChange,
  onRemove,
}: {
  c: Criterion;
  lints: Lint[];
  /** This criterion's share of the milestone amount. */
  valueCents: number;
  onChange: (c: Criterion) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <Badge tone={c.kind === "check" ? "brand" : "info"}>{c.kind === "check" ? "Measured" : "AI-judged"}</Badge>
          {c.kind === "check" ? (
            <>
              <select
                aria-label="Check"
                value={c.checkId}
                onChange={(e) => {
                  const checkId = e.target.value as CheckId;
                  onChange({ ...c, checkId, params: { ...DEFAULT_PARAMS[checkId] } });
                }}
                className={`${small} w-full sm:w-auto`}
              >
                {Object.entries(GROUPS).map(([group, label]) => (
                  <optgroup key={group} label={label}>
                    {CHECK_IDS.filter((id) => CHECKS[id].group === group).map((id) => (
                      <option key={id} value={id}>
                        {CHECKS[id].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="text-xs text-muted">{CHECKS[c.checkId].help}</p>
              {CHECKS[c.checkId].fields.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {CHECKS[c.checkId].fields.map((f) => (
                    <ParamInput key={`${c.checkId}-${f.key}`} field={f} params={c.params} onChange={(params) => onChange({ ...c, params })} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <textarea
                aria-label="Question for the AI judge"
                rows={2}
                value={c.rubric}
                onChange={(e) => onChange({ ...c, rubric: e.target.value })}
                placeholder="Does the hero section name the business and what it sells?"
                className={`${small} w-full`}
              />
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={c.visual} onChange={(e) => onChange({ ...c, visual: e.target.checked })} className="accent-[var(--brand)]" />
                Judge from a screenshot of the page
              </label>
            </>
          )}
          <LintList lints={lints} />
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            Weight
            <IntInput value={c.weight} min={1} max={10} label="Weight" className="w-14" onChange={(weight) => onChange({ ...c, weight })} />
          </label>
          <span className="tabular font-mono text-xs text-muted" title="This criterion's share of the milestone payment">
            ≈ {formatCents(valueCents)}
          </span>
          <label className="flex items-center gap-2 text-sm text-muted" title="If this fails, nothing is released for the milestone.">
            <input type="checkbox" checked={c.required} onChange={(e) => onChange({ ...c, required: e.target.checked })} className="accent-[var(--brand)]" />
            Must pass
          </label>
          <button type="button" onClick={onRemove} className="text-sm text-muted hover:text-danger">
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Milestones                                                           */
/* ------------------------------------------------------------------ */

function MilestoneCard({
  m,
  index,
  lints,
  canRemove,
  onChange,
  onRemove,
}: {
  m: Milestone;
  index: number;
  lints: Lint[];
  canRemove: boolean;
  onChange: (m: Milestone) => void;
  onRemove: () => void;
}) {
  const share = Math.round(measuredShare(m) * 100);
  const totalWeight = m.criteria.reduce((s, c) => s + c.weight, 0);
  const setCriterion = (i: number, c: Criterion) => onChange({ ...m, criteria: m.criteria.map((x, j) => (j === i ? c : x)) });
  const addCheck = () =>
    onChange({ ...m, criteria: [...m.criteria, { kind: "check", id: `${m.id}-${uid()}`, checkId: "has_h1", params: {}, weight: 2, required: false }] });
  const addJudged = () =>
    onChange({ ...m, criteria: [...m.criteria, { kind: "judged", id: `${m.id}-${uid()}`, rubric: "", weight: 2, required: false, visual: false }] });

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft font-mono text-sm font-semibold text-brand">
          M{index + 1}
        </span>
        <input aria-label="Milestone title" value={m.title} onChange={(e) => onChange({ ...m, title: e.target.value })} className={`${input} font-medium`} />
        {canRemove && (
          <button type="button" onClick={onRemove} className="shrink-0 text-sm text-muted hover:text-danger">
            Remove
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2 text-muted">
          Amount
          <MoneyInput label="Milestone amount" cents={m.amountCents} onChange={(amountCents) => onChange({ ...m, amountCents })} />
        </label>
        <label className="flex items-center gap-2 text-muted">
          Due on day
          <IntInput label="Due day" value={m.dueInDays} min={1} max={MAX_JOB_DAYS} onChange={(dueInDays) => onChange({ ...m, dueInDays })} />
        </label>
        <div className="flex min-w-48 flex-1 items-center gap-2" title="Share of this payment decided by measured checks rather than AI judgement">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-info-soft">
            <div className="h-full bg-brand" style={{ width: `${share}%` }} />
          </div>
          <span className="tabular shrink-0 font-mono text-xs text-muted">{share}% measured</span>
        </div>
      </div>

      <textarea
        aria-label="Milestone description"
        rows={2}
        value={m.description}
        onChange={(e) => onChange({ ...m, description: e.target.value })}
        placeholder="What the client gets in this milestone"
        className={`${input} mt-4 text-sm`}
      />
      <LintList lints={lints.filter((l) => !l.criterionId)} />

      <ul className="mt-4 space-y-2">
        {m.criteria.map((c, i) => (
          <CriterionRow
            key={c.id}
            c={c}
            lints={lints.filter((l) => l.criterionId === c.id)}
            valueCents={totalWeight ? Math.floor((m.amountCents * c.weight) / totalWeight) : 0}
            onChange={(next) => setCriterion(i, next)}
            onRemove={() => onChange({ ...m, criteria: m.criteria.filter((_, j) => j !== i) })}
          />
        ))}
      </ul>
      {m.criteria.length < 10 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={addCheck}>
            + Measured check
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={addJudged}>
            + AI-judged question
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                               */
/* ------------------------------------------------------------------ */

export function BriefEditor({ jobId, initial, editable }: { jobId: string; initial: Brief; editable: boolean }) {
  const [brief, setBrief] = useState<Brief>(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [issues, setIssues] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totalCents = brief.milestones.reduce((s, m) => s + m.amountCents, 0);
  const current = useMemo(() => ({ ...brief, totalCents }), [brief, totalCents]);
  const dirty = JSON.stringify(current) !== saved;
  const lints = useMemo(() => lintBrief(current), [current]);
  const warnings = lints.filter((l) => l.level === "warn").length;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setMilestone = (i: number, m: Milestone) => setBrief((b) => ({ ...b, milestones: b.milestones.map((x, j) => (j === i ? m : x)) }));
  const addMilestone = () =>
    setBrief((b) => {
      const id = `m${b.milestones.length + 1}-${uid()}`;
      const lastDue = b.milestones.at(-1)?.dueInDays ?? 7;
      return {
        ...b,
        milestones: [
          ...b.milestones,
          {
            id,
            title: "New milestone",
            description: "",
            amountCents: 5000,
            dueInDays: Math.min(MAX_JOB_DAYS, lastDue + 3),
            criteria: [{ kind: "check", id: `${id}-${uid()}`, checkId: "http_ok", params: {}, weight: 1, required: true }],
          },
        ],
      };
    });

  function save() {
    startTransition(async () => {
      const res = await saveBrief(jobId, current);
      if (res.ok) {
        setSaved(JSON.stringify(current));
        setIssues([]);
        setSavedAt(new Date(res.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      } else {
        setIssues(res.issues);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <fieldset disabled={!editable} className="min-w-0 space-y-4">
        <Card className="p-4 sm:p-5">
          <label className="text-sm font-medium text-muted" htmlFor="title">
            Job title
          </label>
          <input id="title" value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} className={`${input} mt-1.5 text-lg font-semibold`} />
          <label className="mt-4 block text-sm font-medium text-muted" htmlFor="summary">
            Summary for the client
          </label>
          <textarea id="summary" rows={3} value={brief.summary} onChange={(e) => setBrief({ ...brief, summary: e.target.value })} className={`${input} mt-1.5`} />
        </Card>

        {brief.milestones.map((m, i) => (
          <MilestoneCard
            key={m.id}
            m={m}
            index={i}
            lints={lints.filter((l) => l.milestoneId === m.id)}
            canRemove={brief.milestones.length > 1}
            onChange={(next) => setMilestone(i, next)}
            onRemove={() => setBrief((b) => ({ ...b, milestones: b.milestones.filter((_, j) => j !== i) }))}
          />
        ))}
        {brief.milestones.length < 5 && (
          <Button type="button" variant="secondary" onClick={addMilestone}>
            + Add milestone
          </Button>
        )}
      </fieldset>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card className="p-5">
          <p className="text-sm text-muted">Total held from the client</p>
          <p className="tabular mt-1 font-mono text-3xl font-semibold">{formatCents(totalCents)}</p>
          <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            {brief.milestones.map((m, i) => (
              <li key={m.id} className="flex justify-between gap-3">
                <span className="truncate text-muted">
                  M{i + 1} · day {m.dueInDays}
                </span>
                <span className="tabular font-mono">{formatCents(m.amountCents)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
            <label className="flex items-center justify-between gap-3 text-muted">
              Client review window
              <span className="flex items-center gap-1.5">
                <IntInput
                  label="Review window hours"
                  value={brief.terms.reviewWindowHours}
                  min={1}
                  max={168}
                  onChange={(reviewWindowHours) => setBrief({ ...brief, terms: { ...brief.terms, reviewWindowHours } })}
                />
                h
              </span>
            </label>
            <label className="flex items-center justify-between gap-3 text-muted">
              Resubmissions allowed
              <IntInput
                label="Resubmissions allowed"
                value={brief.terms.maxResubmissions}
                min={0}
                max={5}
                onChange={(maxResubmissions) => setBrief({ ...brief, terms: { ...brief.terms, maxResubmissions } })}
              />
            </label>
            <p className="text-xs text-muted">If the client doesn&apos;t respond within the window, the verdict executes automatically.</p>
          </div>

          <div className="mt-4 border-t border-line pt-4">
            {warnings > 0 ? (
              <p className="text-sm text-held">
                {warnings} suggestion{warnings > 1 ? "s" : ""} to make criteria checkable
              </p>
            ) : (
              <p className="text-sm text-brand">Every criterion is checkable</p>
            )}
            {issues.length > 0 && (
              <ul role="alert" className="mt-3 space-y-1 rounded-lg bg-danger-soft p-3 text-sm text-danger">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            {editable ? (
              <>
                <Button type="button" className="mt-4 w-full" onClick={save} disabled={pending || !dirty}>
                  {pending ? "Saving…" : dirty ? "Save changes" : "Saved"}
                </Button>
                <p className="mt-2 text-center text-xs text-muted">
                  {dirty ? "Unsaved changes" : savedAt ? `Saved at ${savedAt}` : "Draft · only you can see it"}
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted">This brief has been sent and can no longer be edited here.</p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
