ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "archived_by_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_archived_by_user_id_user_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_archived_at_idx" ON "devices" USING btree ("archived_at") WHERE "archived_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "playbooks" DROP CONSTRAINT IF EXISTS "playbooks_alert_kind_check";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_alert_kind_check" CHECK ("alert_kind" IN ('new_endpoint','peer_flapping','device_offline','firewall_sync_failed','concentrator_probe','check_in_secret_mismatch','agent_outdated','warranty_expiring','archived_device_online'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
