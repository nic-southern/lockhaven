ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "agent_channel" text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "agent_channel" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organizations" ADD CONSTRAINT "organizations_agent_channel_check" CHECK ("agent_channel" IN ('stable', 'beta'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sites" ADD CONSTRAINT "sites_agent_channel_check" CHECK ("agent_channel" IS NULL OR "agent_channel" IN ('stable', 'beta'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "platform" text NOT NULL,
  "version" text NOT NULL,
  "channel" text NOT NULL,
  "download_url" text NOT NULL,
  "sha256" text NOT NULL,
  "notes" text,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_releases" ADD CONSTRAINT "agent_releases_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_releases_channel_platform_version_idx" ON "agent_releases" USING btree ("channel", "platform", "version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_releases_channel_idx" ON "agent_releases" USING btree ("channel");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_releases" ADD CONSTRAINT "agent_releases_platform_check" CHECK ("platform" IN ('linux', 'windows', 'macos', 'android', 'all'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_releases" ADD CONSTRAINT "agent_releases_channel_check" CHECK ("channel" IN ('stable', 'beta'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_by_user_id" text,
  "sent_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "result_detail" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_commands_device_status_idx" ON "device_commands" USING btree ("device_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_commands_created_at_idx" ON "device_commands" USING btree ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_kind_check" CHECK ("kind" IN ('reboot', 'restart', 'update'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_status_check" CHECK ("status" IN ('pending', 'sent', 'succeeded', 'failed', 'refused', 'cancelled'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
