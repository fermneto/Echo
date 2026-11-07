CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"repository" text,
	"sha" text,
	"branch" text,
	"environment" text NOT NULL,
	"state" text NOT NULL,
	"url" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absences" ADD COLUMN "calendar_event_id" text;--> statement-breakpoint
ALTER TABLE "absences" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "absences" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "work_hours_suggested" jsonb;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "checks_url" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "checks_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_ext" ON "deployments" USING btree ("org_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "deployments_sha" ON "deployments" USING btree ("org_id","sha");--> statement-breakpoint
CREATE UNIQUE INDEX "absences_calendar_event" ON "absences" USING btree ("org_id","calendar_event_id");--> statement-breakpoint
-- Tabela nova de negócio: mesma política de isolamento da migração 0003.
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.deployments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY echo_org_isolation ON public.deployments
  USING (current_setting('app.bypass_rls', true) = 'on' OR org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR org_id = nullif(current_setting('app.org_id', true), '')::uuid);
