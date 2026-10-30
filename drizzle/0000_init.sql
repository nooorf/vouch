CREATE TYPE "public"."brief_version_status" AS ENUM('proposed', 'accepted', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."evaluation_kind" AS ENUM('initial', 'reevaluation');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('queued', 'running', 'done', 'error');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('app', 'paypal', 'ai', 'client', 'freelancer', 'system');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('DRAFT', 'PROPOSED', 'AGREED', 'FUNDED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('PENDING', 'SUBMITTED', 'EVALUATING', 'REVIEW_WINDOW', 'DISPUTED', 'RELEASED', 'PARTIAL_HELD', 'HELD', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."party" AS ENUM('freelancer', 'client');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'completed', 'pending_paypal', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('authorize', 'capture', 'void', 'refund', 'reauthorize');--> statement-breakpoint
CREATE TYPE "public"."proposer" AS ENUM('ai', 'freelancer', 'client');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('PASS', 'PARTIAL', 'FAIL', 'NEEDS_HUMAN');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_version_id" uuid NOT NULL,
	"party" "party" NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brief_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"proposed_by" "proposer" NOT NULL,
	"change_request" text,
	"status" "brief_version_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"url" text NOT NULL,
	"repo_url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"brief_version_id" uuid NOT NULL,
	"kind" "evaluation_kind" DEFAULT 'initial' NOT NULL,
	"status" "evaluation_status" DEFAULT 'queued' NOT NULL,
	"results" jsonb,
	"measurements" jsonb,
	"suspicious" boolean DEFAULT false NOT NULL,
	"verdict" "verdict",
	"earned_cents" integer,
	"release_now_cents" integer,
	"silence_release_cents" integer,
	"reasons" jsonb,
	"fix_list" jsonb,
	"model" text,
	"prompt_hash" text,
	"raw_output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid,
	"milestone_id" uuid,
	"type" text NOT NULL,
	"source" "event_source" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paypal_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "job_status" DEFAULT 'DRAFT' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"total_cents" integer NOT NULL,
	"client_name" text,
	"client_email" text,
	"client_token_hash" text NOT NULL,
	"agreed_version_id" uuid,
	"review_window_seconds" integer DEFAULT 86400 NOT NULL,
	"max_resubmissions" integer DEFAULT 2 NOT NULL,
	"funding_expires_at" timestamp with time zone,
	"payee_email" text,
	"paypal_order_id" text,
	"paypal_authorization_id" text,
	"authorized_cents" integer DEFAULT 0 NOT NULL,
	"captured_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"authorized_at" timestamp with time zone,
	"honor_expires_at" timestamp with time zone,
	"auth_expires_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_client_token_hash_unique" UNIQUE("client_token_hash"),
	CONSTRAINT "jobs_paypal_order_id_unique" UNIQUE("paypal_order_id")
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"brief_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount_cents" integer NOT NULL,
	"criteria" jsonb NOT NULL,
	"status" "milestone_status" DEFAULT 'PENDING' NOT NULL,
	"released_cents" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"current_evaluation_id" uuid,
	"review_ends_at" timestamp with time zone,
	"window_extended" boolean DEFAULT false NOT NULL,
	"reevaluated" boolean DEFAULT false NOT NULL,
	"disputed_criteria" jsonb,
	"dispute_note" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"party" "party" NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"email_status" text,
	"read_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"milestone_id" uuid,
	"type" "payment_type" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"request_id" text NOT NULL,
	"paypal_id" text,
	"paypal_status" text,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_login" text,
	"name" text NOT NULL,
	"email" text,
	"paypal_email" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_login_unique" UNIQUE("github_login")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_brief_version_id_brief_versions_id_fk" FOREIGN KEY ("brief_version_id") REFERENCES "public"."brief_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_versions" ADD CONSTRAINT "brief_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_brief_version_id_brief_versions_id_fk" FOREIGN KEY ("brief_version_id") REFERENCES "public"."brief_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_version_party_uq" ON "approvals" USING btree ("brief_version_id","party");--> statement-breakpoint
CREATE UNIQUE INDEX "brief_versions_job_version_uq" ON "brief_versions" USING btree ("job_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_milestone_attempt_uq" ON "deliveries" USING btree ("milestone_id","attempt_no");--> statement-breakpoint
CREATE INDEX "evaluations_milestone_idx" ON "evaluations" USING btree ("milestone_id","created_at");--> statement-breakpoint
CREATE INDEX "events_job_idx" ON "events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_owner_idx" ON "jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_job_position_uq" ON "milestones" USING btree ("job_id","position");--> statement-breakpoint
CREATE INDEX "milestones_review_due_idx" ON "milestones" USING btree ("review_ends_at") WHERE "milestones"."status" = 'REVIEW_WINDOW';--> statement-breakpoint
CREATE INDEX "notifications_job_party_idx" ON "notifications" USING btree ("job_id","party","created_at");--> statement-breakpoint
CREATE INDEX "payments_job_idx" ON "payments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "payments_paypal_id_idx" ON "payments" USING btree ("paypal_id");--> statement-breakpoint
CREATE INDEX "tasks_ready_idx" ON "tasks" USING btree ("run_after") WHERE "tasks"."status" = 'queued';