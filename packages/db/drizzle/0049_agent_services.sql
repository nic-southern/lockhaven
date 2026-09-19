ALTER TABLE "device_commands" ADD COLUMN IF NOT EXISTS "service_name" text;--> statement-breakpoint
ALTER TABLE "device_commands" DROP CONSTRAINT IF EXISTS "device_commands_kind_check";--> statement-breakpoint
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_kind_check" CHECK ("kind" IN ('reboot', 'restart', 'update', 'restart_service'));--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_service_name_check" CHECK (
   "service_name" IS NULL OR char_length("service_name") BETWEEN 1 AND 64
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "target" text NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_services_name_check" CHECK (char_length("name") BETWEEN 1 AND 64),
  CONSTRAINT "agent_services_target_check" CHECK (
    char_length("target") BETWEEN 1 AND 64
    AND "target" ~ '^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$'
    AND "target" !~ '\.\.'
  )
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_services_organization_name_idx" ON "agent_services" USING btree ("organization_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_services_organization_idx" ON "agent_services" USING btree ("organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_service_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "device_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_service_assignments" ADD CONSTRAINT "agent_service_assignments_service_id_agent_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."agent_services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_service_assignments" ADD CONSTRAINT "agent_service_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_service_assignments" ADD CONSTRAINT "agent_service_assignments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_service_assignments" ADD CONSTRAINT "agent_service_assignments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_service_assignments" ADD CONSTRAINT "agent_service_assignments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_service_assignments_org_idx" ON "agent_service_assignments" USING btree ("service_id") WHERE "site_id" IS NULL AND "device_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_service_assignments_site_idx" ON "agent_service_assignments" USING btree ("service_id", "site_id") WHERE "site_id" IS NOT NULL AND "device_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_service_assignments_device_idx" ON "agent_service_assignments" USING btree ("service_id", "device_id") WHERE "device_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_service_assignments_organization_idx" ON "agent_service_assignments" USING btree ("organization_id");
