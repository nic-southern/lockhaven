CREATE TABLE IF NOT EXISTS "playbooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "alert_kind" text NOT NULL,
  "action" text NOT NULL,
  "require_approval" boolean DEFAULT false NOT NULL,
  "cooldown_minutes" integer DEFAULT 60 NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playbooks_org_kind_idx" ON "playbooks" USING btree ("organization_id","alert_kind") WHERE "site_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playbooks_site_kind_idx" ON "playbooks" USING btree ("organization_id","site_id","alert_kind") WHERE "site_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbooks_organization_idx" ON "playbooks" USING btree ("organization_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_alert_kind_check" CHECK ("alert_kind" IN ('new_endpoint','peer_flapping','device_offline','firewall_sync_failed','concentrator_probe','check_in_secret_mismatch','agent_outdated','warranty_expiring'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_action_check" CHECK ("action" IN ('reboot','restart','update'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playbook_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playbook_id" uuid NOT NULL,
  "alert_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "device_id" uuid,
  "action" text NOT NULL,
  "status" text DEFAULT 'pending_approval' NOT NULL,
  "skip_reason" text,
  "device_command_id" uuid,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_device_command_id_device_commands_id_fk" FOREIGN KEY ("device_command_id") REFERENCES "public"."device_commands"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playbook_runs_playbook_alert_idx" ON "playbook_runs" USING btree ("playbook_id","alert_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_runs_status_idx" ON "playbook_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_runs_device_created_idx" ON "playbook_runs" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "playbook_runs_organization_status_idx" ON "playbook_runs" USING btree ("organization_id","status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_action_check" CHECK ("action" IN ('reboot','restart','update'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_status_check" CHECK ("status" IN ('pending_approval','queued','skipped','denied','cancelled','expired','failed'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbook_runs" ADD CONSTRAINT "playbook_runs_skip_reason_check" CHECK ("skip_reason" IS NULL OR "skip_reason" IN ('no_device','unknown_action','cooldown','open_command','not_open','already_handled'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
