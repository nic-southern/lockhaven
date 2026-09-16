CREATE TABLE IF NOT EXISTS "notification_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "min_severity" text DEFAULT 'info' NOT NULL,
  "alert_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "site_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_channels_organization_idx" ON "notification_channels" USING btree ("organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "alert_id" uuid,
  "event" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_response" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_organization_created_idx" ON "notification_deliveries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_channel_created_idx" ON "notification_deliveries" USING btree ("channel_id","created_at");
