ALTER TABLE "evaluations" DROP CONSTRAINT "evaluations_brief_version_id_brief_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_brief_version_id_brief_versions_id_fk" FOREIGN KEY ("brief_version_id") REFERENCES "public"."brief_versions"("id") ON DELETE cascade ON UPDATE no action;