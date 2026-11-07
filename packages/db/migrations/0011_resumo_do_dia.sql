ALTER TABLE "daily_artifacts" ADD COLUMN "facts" jsonb;--> statement-breakpoint
ALTER TABLE "daily_artifacts" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "daily_artifacts" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_artifacts_person_date_kind" ON "daily_artifacts" USING btree ("org_id","person_id","date","kind");