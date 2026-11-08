CREATE TABLE "team_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"week" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"story" jsonb,
	"storage_key" text,
	"duration_s" integer,
	"chapters" jsonb,
	"cost_usd" numeric(10, 4),
	"session_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_videos" ADD CONSTRAINT "team_videos_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_videos" ADD CONSTRAINT "team_videos_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_videos_team_week" ON "team_videos" USING btree ("org_id","team_id","week");--> statement-breakpoint
ALTER TABLE public.team_videos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.team_videos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY echo_org_isolation ON public.team_videos
  USING (current_setting('app.bypass_rls', true) = 'on' OR org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR org_id = nullif(current_setting('app.org_id', true), '')::uuid);
