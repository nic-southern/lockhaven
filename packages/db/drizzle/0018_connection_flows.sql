CREATE TABLE IF NOT EXISTS "connection_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "organization_id" uuid,
  "site_id" uuid,
  "device_id" uuid,
  "admin_profile_id" uuid,
  "direction" text NOT NULL,
  "verdict" text NOT NULL,
  "protocol" text NOT NULL,
  "src_ip" inet NOT NULL,
  "dst_ip" inet NOT NULL,
  "dst_port" integer,
  "bytes" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_events" ADD CONSTRAINT "connection_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_events" ADD CONSTRAINT "connection_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_events" ADD CONSTRAINT "connection_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_events" ADD CONSTRAINT "connection_events_admin_profile_id_admin_vpn_profiles_id_fk" FOREIGN KEY ("admin_profile_id") REFERENCES "public"."admin_vpn_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_events_occurred_at_idx" ON "connection_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_events_device_occurred_idx" ON "connection_events" USING btree ("device_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_events_organization_occurred_idx" ON "connection_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_events_admin_occurred_idx" ON "connection_events" USING btree ("admin_profile_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_events_destination_idx" ON "connection_events" USING btree ("dst_ip","dst_port");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connection_daily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "day" timestamp with time zone NOT NULL,
  "subject_key" text NOT NULL,
  "organization_id" uuid,
  "site_id" uuid,
  "device_id" uuid,
  "admin_profile_id" uuid,
  "direction" text NOT NULL,
  "verdict" text NOT NULL,
  "protocol" text NOT NULL,
  "dst_ip" inet NOT NULL,
  "dst_port" integer DEFAULT 0 NOT NULL,
  "connections" integer DEFAULT 0 NOT NULL,
  "bytes" bigint DEFAULT 0 NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_daily" ADD CONSTRAINT "connection_daily_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_daily" ADD CONSTRAINT "connection_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_daily" ADD CONSTRAINT "connection_daily_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_daily" ADD CONSTRAINT "connection_daily_admin_profile_id_admin_vpn_profiles_id_fk" FOREIGN KEY ("admin_profile_id") REFERENCES "public"."admin_vpn_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connection_daily_bucket_idx" ON "connection_daily" USING btree ("day","subject_key","direction","verdict","protocol","dst_ip","dst_port");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_daily_device_day_idx" ON "connection_daily" USING btree ("device_id","day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_daily_organization_day_idx" ON "connection_daily" USING btree ("organization_id","day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connection_daily_day_idx" ON "connection_daily" USING btree ("day");
