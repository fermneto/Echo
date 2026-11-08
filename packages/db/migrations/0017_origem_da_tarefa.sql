ALTER TABLE "tasks" ADD COLUMN "source" text DEFAULT 'linear' NOT NULL;--> statement-breakpoint
-- Tarefas que já estavam no espelho: no Jira o id é só número; no Linear é UUID.
UPDATE "tasks" SET "source" = 'jira' WHERE "linear_id" ~ '^[0-9]+$';