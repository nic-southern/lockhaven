ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "agent_last_check_in_at" timestamp with time zone;--> statement-breakpoint
UPDATE "devices" SET "agent_last_check_in_at" = "last_seen_at" WHERE "agent_last_check_in_at" IS NULL AND "agent_version" IS NOT NULL AND "check_in_secret_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "playbooks" DROP CONSTRAINT IF EXISTS "playbooks_alert_kind_check";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_alert_kind_check" CHECK ("alert_kind" IN ('new_endpoint','peer_flapping','device_offline','firewall_sync_failed','concentrator_probe','check_in_secret_mismatch','agent_outdated','warranty_expiring','archived_device_online','disk_full','agent_stale'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
