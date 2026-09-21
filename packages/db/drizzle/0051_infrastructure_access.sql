ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "infrastructure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "infrastructure_access_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "reason" text,
  "status" text DEFAULT 'active' NOT NULL,
  "duration_minutes" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "infrastructure_access_grants" ADD CONSTRAINT "infrastructure_access_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "infrastructure_access_grants" ADD CONSTRAINT "infrastructure_access_grants_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "infrastructure_access_grants" ADD CONSTRAINT "infrastructure_access_grants_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "infrastructure_access_grants" ADD CONSTRAINT "infrastructure_access_grants_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "infrastructure_access_grants" ADD CONSTRAINT "infrastructure_access_grants_status_check" CHECK ("status" IN ('active', 'expired', 'revoked'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "infrastructure_access_grants" ADD CONSTRAINT "infrastructure_access_grants_duration_check" CHECK ("duration_minutes" BETWEEN 1 AND 120);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "infrastructure_access_grants_device_idx" ON "infrastructure_access_grants" USING btree ("device_id", "status", "expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "infrastructure_access_grants_requester_idx" ON "infrastructure_access_grants" USING btree ("requested_by_user_id", "status");
