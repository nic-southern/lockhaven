ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "after_hours_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "after_hours_steps" jsonb DEFAULT '["update","reboot"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "after_hours_require_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_after_hours_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "closed_at" timestamp with time zone NOT NULL,
  "steps" jsonb NOT NULL,
  "require_approval" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "device_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "queued_device_count" integer DEFAULT 0 NOT NULL,
  "skipped_device_count" integer DEFAULT 0 NOT NULL,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_after_hours_runs" ADD CONSTRAINT "site_after_hours_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_after_hours_runs" ADD CONSTRAINT "site_after_hours_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_after_hours_runs" ADD CONSTRAINT "site_after_hours_runs_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_after_hours_runs_site_created_idx" ON "site_after_hours_runs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_after_hours_runs_organization_status_idx" ON "site_after_hours_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_after_hours_runs_status_idx" ON "site_after_hours_runs" USING btree ("status","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_after_hours_runs" ADD CONSTRAINT "site_after_hours_runs_status_check" CHECK ("status" IN ('pending_approval','queued','skipped','denied','expired'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
