ALTER TABLE "deliveries" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "extra_tries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "decide_by" timestamp with time zone;