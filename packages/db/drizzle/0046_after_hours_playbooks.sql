ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "after_hours_playbooks_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "after_hours_start_after_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sites" ADD CONSTRAINT "sites_after_hours_start_after_minutes_check" CHECK ("after_hours_start_after_minutes" >= 0 AND "after_hours_start_after_minutes" <= 720);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "after_hours_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "window_key" text NOT NULL,
  "closed_at" timestamp with time zone NOT NULL,
  "opens_at" timestamp with time zone,
  "status" text DEFAULT 'running' NOT NULL,
  "require_approval" boolean DEFAULT false NOT NULL,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "summary" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "after_hours_runs_status_check" CHECK ("status" IN ('pending_approval','running','completed','denied','expired','cancelled'))
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "after_hours_runs" ADD CONSTRAINT "after_hours_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "after_hours_runs" ADD CONSTRAINT "after_hours_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "after_hours_runs" ADD CONSTRAINT "after_hours_runs_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "after_hours_runs_site_window_idx" ON "after_hours_runs" USING btree ("site_id","window_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "after_hours_runs_status_idx" ON "after_hours_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "after_hours_runs_organization_idx" ON "after_hours_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "playbook_runs" ALTER COLUMN "playbook_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "playbook_runs" ALTER COLUMN "alert_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "playbook_runs" ADD COLUMN IF NOT EXISTS "after_hours_run_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_after_hours_run_id_after_hours_runs_id_fk" FOREIGN KEY ("after_hours_run_id") REFERENCES "public"."after_hours_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_source_check" CHECK (("playbook_id" IS NOT NULL AND "alert_id" IS NOT NULL) OR "after_hours_run_id" IS NOT NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playbook_runs_after_hours_step_idx" ON "playbook_runs" USING btree ("after_hours_run_id","device_id","action") WHERE "after_hours_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_runs_after_hours_run_idx" ON "playbook_runs" USING btree ("after_hours_run_id");--> statement-breakpoint
ALTER TABLE "playbook_runs" DROP CONSTRAINT IF EXISTS "playbook_runs_skip_reason_check";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_skip_reason_check" CHECK ("skip_reason" IS NULL OR "skip_reason" IN ('no_device','unknown_action','cooldown','open_command','not_open','already_handled','device_offline','device_archived'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
