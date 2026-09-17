CREATE TABLE IF NOT EXISTS "agent_modules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "collectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_modules_kind_check" CHECK ("kind" IN ('observations'))
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_modules" ADD CONSTRAINT "agent_modules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_modules" ADD CONSTRAINT "agent_modules_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_modules_organization_idx" ON "agent_modules" USING btree ("organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_module_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "module_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "device_id" uuid,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_module_assignments" ADD CONSTRAINT "agent_module_assignments_module_id_agent_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."agent_modules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_module_assignments" ADD CONSTRAINT "agent_module_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_module_assignments" ADD CONSTRAINT "agent_module_assignments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_module_assignments" ADD CONSTRAINT "agent_module_assignments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_module_assignments_org_idx" ON "agent_module_assignments" USING btree ("module_id") WHERE "site_id" IS NULL AND "device_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_module_assignments_site_idx" ON "agent_module_assignments" USING btree ("module_id", "site_id") WHERE "site_id" IS NOT NULL AND "device_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_module_assignments_device_idx" ON "agent_module_assignments" USING btree ("module_id", "device_id") WHERE "device_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_module_assignments_organization_idx" ON "agent_module_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_module_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "module_id" uuid NOT NULL,
  "collector_id" text NOT NULL,
  "collector_type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_module_observations" ADD CONSTRAINT "device_module_observations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_module_observations" ADD CONSTRAINT "device_module_observations_module_id_agent_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."agent_modules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_module_observations_unique_idx" ON "device_module_observations" USING btree ("device_id", "module_id", "collector_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_module_observations_device_idx" ON "device_module_observations" USING btree ("device_id");
