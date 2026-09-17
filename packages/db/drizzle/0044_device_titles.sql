CREATE TABLE IF NOT EXISTS "device_titles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "key" text NOT NULL,
  "title" text NOT NULL,
  "build" text DEFAULT '' NOT NULL,
  "config_hash" text,
  "process_running" boolean,
  "process_name" text,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_titles" ADD CONSTRAINT "device_titles_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_titles_device_key_idx" ON "device_titles" USING btree ("device_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_titles_device_idx" ON "device_titles" USING btree ("device_id");
