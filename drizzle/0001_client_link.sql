ALTER TABLE "jobs" ADD COLUMN "client_token_enc" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "agreed_at" timestamp with time zone;