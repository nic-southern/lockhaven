ALTER TABLE "devices" ADD COLUMN "agent_version" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_organization_status_idx" ON "devices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_site_idx" ON "devices" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_last_seen_idx" ON "devices" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_tags_idx" ON "devices" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_sessions_started_at_idx" ON "remote_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_sessions_device_idx" ON "remote_sessions" USING btree ("device_id");
