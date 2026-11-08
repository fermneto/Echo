ALTER TABLE "fix_runs" ADD COLUMN "decided_via" text;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD COLUMN "delegation_note" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "agent_style" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "delegation" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "delegation_updated_at" timestamp with time zone;