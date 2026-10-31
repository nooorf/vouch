import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Brief, Criterion } from "@/lib/brief/schema";
import type { Verdict } from "@/lib/policy/policy";
import type { RecordedResult } from "@/lib/referee/evaluate";

/* Money is always integer cents. Times are timestamptz. */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const jobStatus = pgEnum("job_status", [
  "DRAFT", // freelancer is editing, client has not seen it
  "PROPOSED", // a brief version is waiting for the other party
  "AGREED", // both accepted the same hash; Pay unlocks
  "FUNDED", // PayPal authorization held
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED", // never funded in time
]);

export const milestoneStatus = pgEnum("milestone_status", [
  "PENDING",
  "SUBMITTED",
  "EVALUATING",
  "REVIEW_WINDOW",
  "DISPUTED",
  "RELEASED", // fully captured
  "PARTIAL_HELD", // part captured, rest held for a fix
  "HELD", // nothing captured, waiting for a fix or a decision
  "CLOSED", // settled with money left unreleased (client decision)
]);

export const party = pgEnum("party", ["freelancer", "client"]);
export const proposer = pgEnum("proposer", ["ai", "freelancer", "client"]);
export const briefVersionStatus = pgEnum("brief_version_status", ["proposed", "accepted", "superseded"]);

export const verdict = pgEnum("verdict", ["PASS", "PARTIAL", "FAIL", "NEEDS_HUMAN"]);
export const evaluationStatus = pgEnum("evaluation_status", ["queued", "running", "done", "error"]);
export const evaluationKind = pgEnum("evaluation_kind", ["initial", "reevaluation"]);

export const paymentType = pgEnum("payment_type", ["authorize", "capture", "void", "refund", "reauthorize"]);
export const paymentStatus = pgEnum("payment_status", [
  "pending", // row written, PayPal call not confirmed yet
  "completed",
  "pending_paypal", // PayPal accepted but reports PENDING (e.g. review)
  "failed",
]);

export const eventSource = pgEnum("event_source", ["app", "paypal", "ai", "client", "freelancer", "system"]);
export const taskStatus = pgEnum("task_status", ["queued", "running", "done", "failed"]);

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: id(),
  githubLogin: text("github_login").unique(),
  name: text("name").notNull(),
  email: text("email"),
  /** Where captures go when funds are sent straight to the freelancer. */
  paypalEmail: text("paypal_email"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Jobs and the brief                                                   */
/* ------------------------------------------------------------------ */

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    ownerId: uuid("owner_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    status: jobStatus("status").notNull().default("DRAFT"),
    currency: text("currency").notNull().default("USD"),
    totalCents: integer("total_cents").notNull(),

    clientName: text("client_name"),
    clientEmail: text("client_email"),
    /** sha256 of the client's link token: how the client page finds the job. */
    clientTokenHash: text("client_token_hash").notNull().unique(),
    /**
     * The link token, AES-GCM encrypted with a key derived from AUTH_SECRET, so the owner can
     * copy the link again. A database leak alone exposes no working links.
     */
    clientTokenEnc: text("client_token_enc"),
    sentAt: ts("sent_at"),
    agreedAt: ts("agreed_at"),

    agreedVersionId: uuid("agreed_version_id"),
    /** Seconds, so demo mode can use 30 s windows. */
    reviewWindowSeconds: integer("review_window_seconds").notNull().default(24 * 3600),
    maxResubmissions: integer("max_resubmissions").notNull().default(2),
    fundingExpiresAt: ts("funding_expires_at"),

    /** Who receives captures: null means the platform account. */
    payeeEmail: text("payee_email"),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalAuthorizationId: text("paypal_authorization_id"),
    authorizedCents: integer("authorized_cents").notNull().default(0),
    capturedCents: integer("captured_cents").notNull().default(0),
    refundedCents: integer("refunded_cents").notNull().default(0),
    authorizedAt: ts("authorized_at"),
    /** End of the 3-day honor period of the current authorization. */
    honorExpiresAt: ts("honor_expires_at"),
    /** 29 days after the original authorization. */
    authExpiresAt: ts("auth_expires_at"),

    /** The client asked to cancel before a deadline passed; only the freelancer's acceptance executes it. */
    cancelRequestedAt: ts("cancel_requested_at"),
    cancelRequestNote: text("cancel_request_note"),
    /** Ledger events up to this id have been turned into notices. */
    noticedThroughEventId: bigint("noticed_through_event_id", { mode: "number" }).notNull().default(0),

    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_owner_idx").on(t.ownerId), index("jobs_status_idx").on(t.status)],
);

export const briefVersions = pgTable(
  "brief_versions",
  {
    id: id(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    content: jsonb("content").$type<Brief>().notNull(),
    contentHash: text("content_hash").notNull(),
    proposedBy: proposer("proposed_by").notNull(),
    /** The change request in plain language, when the client asked for one. */
    changeRequest: text("change_request"),
    status: briefVersionStatus("status").notNull().default("proposed"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("brief_versions_job_version_uq").on(t.jobId, t.versionNo)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    briefVersionId: uuid("brief_version_id")
      .notNull()
      .references(() => briefVersions.id, { onDelete: "cascade" }),
    party: party("party").notNull(),
    /** The hash the party saw when accepting. Must equal the version's hash. */
    contentHash: text("content_hash").notNull(),
    acceptedAt: createdAt(),
  },
  (t) => [uniqueIndex("approvals_version_party_uq").on(t.briefVersionId, t.party)],
);

/* ------------------------------------------------------------------ */
/* Milestones, deliveries, evaluations                                  */
/* ------------------------------------------------------------------ */

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** The milestone id inside the brief content (e.g. "m1"). */
    briefKey: text("brief_key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    amountCents: integer("amount_cents").notNull(),
    /** Copied from the agreed brief version at funding; never edited afterwards. */
    criteria: jsonb("criteria").$type<Criterion[]>().notNull(),
    status: milestoneStatus("status").notNull().default("PENDING"),
    releasedCents: integer("released_cents").notNull().default(0),
    /** Number of submissions so far. */
    attempts: integer("attempts").notNull().default(0),
    dueAt: ts("due_at"),
    currentEvaluationId: uuid("current_evaluation_id"),
    reviewEndsAt: ts("review_ends_at"),
    windowExtended: boolean("window_extended").notNull().default(false),
    reevaluated: boolean("reevaluated").notNull().default(false),
    disputedCriteria: jsonb("disputed_criteria").$type<string[]>(),
    disputeNote: text("dispute_note"),
    settledAt: ts("settled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("milestones_job_position_uq").on(t.jobId, t.position),
    index("milestones_review_due_idx").on(t.reviewEndsAt).where(sql`${t.status} = 'REVIEW_WINDOW'`),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    url: text("url").notNull(),
    repoUrl: text("repo_url"),
    note: text("note"),
    submittedAt: createdAt(),
  },
  (t) => [uniqueIndex("deliveries_milestone_attempt_uq").on(t.milestoneId, t.attemptNo)],
);

export interface Measurements {
  /** Raw facts from the fetch, the checks and PageSpeed, kept for audit. */
  [checkId: string]: unknown;
}

export const evaluations = pgTable(
  "evaluations",
  {
    id: id(),
    deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id, { onDelete: "cascade" }),
    briefVersionId: uuid("brief_version_id")
      .notNull()
      .references(() => briefVersions.id, { onDelete: "cascade" }),
    kind: evaluationKind("kind").notNull().default("initial"),
    status: evaluationStatus("status").notNull().default("queued"),

    results: jsonb("results").$type<RecordedResult[]>(),
    measurements: jsonb("measurements").$type<Measurements>(),
    suspicious: boolean("suspicious").notNull().default(false),
    verdict: verdict("verdict").$type<Verdict>(),
    earnedCents: integer("earned_cents"),
    releaseNowCents: integer("release_now_cents"),
    silenceReleaseCents: integer("silence_release_cents"),
    reasons: jsonb("reasons").$type<string[]>(),
    fixList: jsonb("fix_list").$type<string[]>(),

    /** LLM audit trail. */
    model: text("model"),
    promptHash: text("prompt_hash"),
    rawOutput: jsonb("raw_output"),
    error: text("error"),

    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("evaluations_milestone_idx").on(t.milestoneId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Money and the ledger                                                 */
/* ------------------------------------------------------------------ */

export const payments = pgTable(
  "payments",
  {
    id: id(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
    type: paymentType("type").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    /** PayPal-Request-Id. Written before the call, so a retry reuses it. */
    requestId: text("request_id").notNull().unique(),
    /** Capture, refund or authorization id returned by PayPal. */
    paypalId: text("paypal_id"),
    paypalStatus: text("paypal_status"),
    error: jsonb("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_job_idx").on(t.jobId), index("payments_paypal_id_idx").on(t.paypalId)],
);

/** The audit ledger. Append-only: rows are never updated or deleted. */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id"),
    type: text("type").notNull(),
    source: eventSource("source").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** PayPal webhook event id. Unique, so a redelivered webhook is ignored. */
    paypalEventId: text("paypal_event_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("events_job_idx").on(t.jobId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Background work, notices, cache                                      */
/* ------------------------------------------------------------------ */

/** Database-backed work queue, drained by tick() on page loads and by the cron. */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    kind: text("kind").notNull(), // e.g. "evaluate", "send_email"
    refId: uuid("ref_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: taskStatus("status").notNull().default("queued"),
    runAfter: ts("run_after").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),
    /** Stops the same work being queued twice. */
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_ready_idx").on(t.runAfter).where(sql`${t.status} = 'queued'`)],
);

/** In-app notices for both parties; email is a bonus on top. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    party: party("party").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    emailStatus: text("email_status"), // null (none), "sent", "failed", "skipped"
    readAt: ts("read_at"),
    /** One reminder of each kind per milestone and window. */
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_job_party_idx").on(t.jobId, t.party, t.createdAt)],
);

/** LLM responses keyed by a hash of model + prompt + inputs, to stay inside free-tier limits. */
export const llmCache = pgTable("llm_cache", {
  key: text("key").primaryKey(),
  model: text("model").notNull(),
  response: jsonb("response").notNull(),
  createdAt: createdAt(),
});
