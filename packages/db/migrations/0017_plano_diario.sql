ALTER TABLE "people" ADD COLUMN "schedule_pins" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_by" jsonb DEFAULT '[]'::jsonb NOT NULL;