ALTER TABLE "questions" ADD COLUMN "digest_request" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "digest_reply" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "digested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "questions_owner_digest" ON "questions" USING btree ("org_id","owner_id","digested_at");