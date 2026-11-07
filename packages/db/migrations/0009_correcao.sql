ALTER TABLE "fix_runs" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD COLUMN "base_sha" text;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD COLUMN "draft_head_sha" text;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD COLUMN "findings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_actions" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD CONSTRAINT "fix_runs_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fix_runs_review" ON "fix_runs" USING btree ("org_id","review_id");