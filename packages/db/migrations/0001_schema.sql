CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"hr_event_id" text,
	"inferred" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"flow" text NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"duration_ms" integer NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_note_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"author_id" uuid,
	"author_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"visibility" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sha" text,
	"managed_by_rule" boolean DEFAULT false NOT NULL,
	"mirror_conflict_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capacity_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"adjustment" integer NOT NULL,
	"reason" text,
	"valid_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"helper_id" uuid NOT NULL,
	"helped_id" uuid NOT NULL,
	"delivery_ref" text,
	"kind" text NOT NULL,
	"weight" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" text NOT NULL,
	"spec" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"date" text NOT NULL,
	"stopped_at" text,
	"blocked" text,
	"released" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reserved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expertise_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"include" boolean NOT NULL,
	"valid_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"delivery_ref" text NOT NULL,
	"pr_id" uuid,
	"script" jsonb,
	"storage_key" text,
	"duration_s" integer,
	"state" text DEFAULT 'queued' NOT NULL,
	"cost_usd" numeric(10, 4),
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fix_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"branch" text,
	"draft_pr_number" integer,
	"tests_reported" text,
	"checks_state" text,
	"cost_usd" numeric(10, 4),
	"state" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"login" text
);
--> statement-breakpoint
CREATE TABLE "inbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"source" text NOT NULL,
	"delivery_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "installation_routes" (
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	CONSTRAINT "installation_routes_kind_external_id_pk" PRIMARY KEY("kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"tokens_encrypted" text,
	"expires_at" timestamp with time zone,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "morning_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"date" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'demo' NOT NULL,
	"monthly_limit_usd" numeric(10, 2) DEFAULT '50' NOT NULL,
	"hard_limit_usd" numeric(10, 2) DEFAULT '100' NOT NULL,
	"gains_baseline" jsonb,
	"repositories_open_to_team" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"target" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"approved_by" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"timezone" text NOT NULL,
	"work_hours" jsonb NOT NULL,
	"job_title" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"away_instructions" text,
	"active" boolean DEFAULT true NOT NULL,
	"offboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"task_id" uuid,
	"pr_id" uuid,
	"from_id" uuid,
	"to_id" uuid,
	"reason" text,
	"context" text,
	"state" text DEFAULT 'proposed' NOT NULL,
	"refusal" text
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"repository" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"author_id" uuid,
	"state" text NOT NULL,
	"branch" text NOT NULL,
	"head_sha" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tests_state" text,
	"task_key" text,
	"reviewer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	"first_human_review_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asker_id" uuid,
	"owner_id" uuid,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"source_ref" text,
	"text" text,
	"text_expires_at" timestamp with time zone,
	"answer" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"claimed_by" text,
	"needs_owner" boolean DEFAULT false NOT NULL,
	"digest_kind" text,
	"resolved" boolean,
	"owner_returns_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redistribution_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"absence_id" uuid,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"choice" jsonb,
	"state" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"pr_id" uuid NOT NULL,
	"head_sha" text NOT NULL,
	"batch_id" text,
	"model" text,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"linear_id" text,
	"title" text NOT NULL,
	"assignee_id" uuid,
	"state" text NOT NULL,
	"due_date" text,
	"size" integer,
	"area" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"leader_id" uuid,
	"load_limit" integer DEFAULT 12 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"week" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"text" text,
	"observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"covered_period" jsonb NOT NULL,
	"notice_at" timestamp with time zone,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"person_id" uuid,
	"repository" text,
	"branch" text,
	"pr_number" integer,
	"task_key" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"external_login" text,
	"attributed_at" timestamp with time zone,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_note_versions" ADD CONSTRAINT "brain_note_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_note_versions" ADD CONSTRAINT "brain_note_versions_note_id_brain_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."brain_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_notes" ADD CONSTRAINT "brain_notes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_notes" ADD CONSTRAINT "brain_notes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_overrides" ADD CONSTRAINT "capacity_overrides_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_overrides" ADD CONSTRAINT "capacity_overrides_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_helper_id_people_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_helped_id_people_id_fk" FOREIGN KEY ("helped_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_artifacts" ADD CONSTRAINT "daily_artifacts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_artifacts" ADD CONSTRAINT "daily_artifacts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_overrides" ADD CONSTRAINT "expertise_overrides_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_overrides" ADD CONSTRAINT "expertise_overrides_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_videos" ADD CONSTRAINT "feature_videos_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_videos" ADD CONSTRAINT "feature_videos_report_id_weekly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."weekly_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_videos" ADD CONSTRAINT "feature_videos_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD CONSTRAINT "fix_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD CONSTRAINT "fix_runs_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morning_plans" ADD CONSTRAINT "morning_plans_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morning_plans" ADD CONSTRAINT "morning_plans_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_actions" ADD CONSTRAINT "outbox_actions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_redistribution_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."redistribution_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_from_id_people_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_to_id_people_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_asker_id_people_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redistribution_plans" ADD CONSTRAINT "redistribution_plans_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redistribution_plans" ADD CONSTRAINT "redistribution_plans_absence_id_absences_id_fk" FOREIGN KEY ("absence_id") REFERENCES "public"."absences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_people_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_events" ADD CONSTRAINT "work_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_events" ADD CONSTRAINT "work_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_org_flow" ON "agent_runs" USING btree ("org_id","flow","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_notes_path" ON "brain_notes" USING btree ("org_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_src" ON "contributions" USING btree ("org_id","source","source_ref","helper_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_notes_person_date" ON "daily_notes" USING btree ("org_id","person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_platform_ext" ON "identities" USING btree ("org_id","platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_source_delivery" ON "inbox_events" USING btree ("source","delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installations_kind_ext" ON "installations" USING btree ("kind","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "morning_plans_person_date" ON "morning_plans" USING btree ("org_id","person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_key" ON "outbox_actions" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "prs_repo_number" ON "pull_requests" USING btree ("org_id","repository","number");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_source_ref" ON "questions" USING btree ("org_id","source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_pr_sha" ON "reviews" USING btree ("org_id","pr_id","head_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_key" ON "tasks" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_reports_person_week" ON "weekly_reports" USING btree ("org_id","person_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "work_events_src" ON "work_events" USING btree ("org_id","source","source_ref");--> statement-breakpoint
CREATE INDEX "work_events_person" ON "work_events" USING btree ("org_id","person_id","occurred_at");