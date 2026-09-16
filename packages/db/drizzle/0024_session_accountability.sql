ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "require_access_reason" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "require_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "remote_sessions" ADD COLUMN IF NOT EXISTS "reason" text;--> statement-breakpoint
ALTER TABLE "remote_sessions" ADD COLUMN IF NOT EXISTS "recording_path" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "access_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "management_service_id" uuid NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "connection_method" text NOT NULL,
  "reason" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "remote_session_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_management_service_id_management_services_id_fk" FOREIGN KEY ("management_service_id") REFERENCES "public"."management_services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_remote_session_id_remote_sessions_id_fk" FOREIGN KEY ("remote_session_id") REFERENCES "public"."remote_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_pending_idx" ON "access_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_site_status_idx" ON "access_requests" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_requester_idx" ON "access_requests" USING btree ("requested_by_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_device_idx" ON "access_requests" USING btree ("device_id","status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'denied', 'expired', 'consumed'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
