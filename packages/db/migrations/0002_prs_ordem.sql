ALTER TABLE "pull_requests" ADD COLUMN "checks_state" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "external_updated_at" timestamp with time zone;