ALTER TABLE "audit_events" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "severity" text DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_ip" inet;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "user_agent" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
UPDATE "audit_events" SET "severity" = CASE "event_type"
  WHEN 'admin_login_failed' THEN 'warning'
  WHEN 'user_suspended' THEN 'warning'
  WHEN 'device_revoked' THEN 'warning'
  WHEN 'device_deleted' THEN 'warning'
  WHEN 'two_factor_reset' THEN 'notice'
  WHEN 'passkey_removed' THEN 'notice'
  WHEN 'password_changed' THEN 'notice'
  WHEN 'session_revoked' THEN 'notice'
  WHEN 'user_invited' THEN 'notice'
  WHEN 'user_role_changed' THEN 'notice'
  WHEN 'user_membership_changed' THEN 'notice'
  WHEN 'user_site_access_changed' THEN 'notice'
  WHEN 'user_password_reset_forced' THEN 'notice'
  WHEN 'credential_revealed' THEN 'notice'
  WHEN 'enrollment_token_revoked' THEN 'notice'
  WHEN 'route_policy_deleted' THEN 'notice'
  WHEN 'route_policy_devices_reassigned' THEN 'notice'
  ELSE 'info'
END
WHERE "severity" = 'info';--> statement-breakpoint
UPDATE "audit_events" SET "site_id" = d."site_id"
FROM "devices" d
WHERE "audit_events"."device_id" = d."id" AND "audit_events"."site_id" IS NULL;--> statement-breakpoint
UPDATE "audit_events" SET "organization_id" = d."organization_id"
FROM "devices" d
WHERE "audit_events"."device_id" = d."id" AND "audit_events"."organization_id" IS NULL;--> statement-breakpoint
UPDATE "audit_events"
SET "actor_ip" = NULLIF("event_data"->>'ipAddress', '')::inet,
    "user_agent" = NULLIF("event_data"->>'userAgent', '')
WHERE "actor_ip" IS NULL
  AND "event_data" ? 'ipAddress'
  AND ("event_data"->>'ipAddress') ~ '^[0-9a-fA-F:.]+$';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_organization_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_device_created_idx" ON "audit_events" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_event_type_created_idx" ON "audit_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_severity_created_idx" ON "audit_events" USING btree ("severity","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vpn_peer_samples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "online" boolean NOT NULL,
  "endpoint" text,
  "last_handshake_at" timestamp with time zone,
  "rx_bytes" bigint DEFAULT 0 NOT NULL,
  "tx_bytes" bigint DEFAULT 0 NOT NULL,
  "reason" text DEFAULT 'interval' NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vpn_peer_samples" ADD CONSTRAINT "vpn_peer_samples_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vpn_peer_samples_device_sampled_idx" ON "vpn_peer_samples" USING btree ("device_id","sampled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vpn_peer_samples_sampled_at_idx" ON "vpn_peer_samples" USING btree ("sampled_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "site_id" uuid,
  "device_id" uuid,
  "kind" text NOT NULL,
  "severity" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "title" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dedupe_key" text NOT NULL,
  "occurrences" integer DEFAULT 1 NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by_user_id" text,
  "resolved_at" timestamp with time zone,
  "resolved_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_user_id_user_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alerts_open_dedupe_idx" ON "alerts" USING btree ("dedupe_key") WHERE "alerts"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_status_severity_idx" ON "alerts" USING btree ("status","severity","last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_organization_status_idx" ON "alerts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_device_idx" ON "alerts" USING btree ("device_id");
