ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "snoozed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "escalated_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_snoozed_by_user_id_user_id_fk" FOREIGN KEY ("snoozed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_snoozed_until_idx" ON "alerts" USING btree ("snoozed_until") WHERE "snoozed_until" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "kind" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "severity" text,
  "escalate_after_minutes" integer,
  "thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_policies" ADD CONSTRAINT "alert_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_policies" ADD CONSTRAINT "alert_policies_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alert_policies_org_kind_idx" ON "alert_policies" USING btree ("organization_id","kind") WHERE "site_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alert_policies_site_kind_idx" ON "alert_policies" USING btree ("organization_id","site_id","kind") WHERE "site_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_policies_organization_idx" ON "alert_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "device_id" uuid,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "time_zone" text DEFAULT 'UTC' NOT NULL,
  "recurrence" text DEFAULT 'none' NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_windows_organization_starts_idx" ON "maintenance_windows" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_windows_site_idx" ON "maintenance_windows" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_windows_device_idx" ON "maintenance_windows" USING btree ("device_id");
