ALTER TABLE "jobs" ADD COLUMN "noticed_through_event_id" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing jobs start from their latest event, so history doesn't turn into a flood of old notices.
UPDATE "jobs" SET "noticed_through_event_id" = COALESCE((SELECT MAX("id") FROM "events" WHERE "events"."job_id" = "jobs"."id"), 0);
