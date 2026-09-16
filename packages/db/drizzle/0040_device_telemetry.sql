CREATE TABLE IF NOT EXISTS "device_metrics_latest" (
  "device_id" uuid PRIMARY KEY NOT NULL,
  "collected_at" timestamp with time zone NOT NULL,
  "uptime_seconds" bigint NOT NULL,
  "cpu_load1" double precision,
  "cpu_load5" double precision,
  "cpu_load15" double precision,
  "cpu_cores" integer,
  "memory_total_bytes" bigint,
  "memory_available_bytes" bigint,
  "memory_used_bytes" bigint,
  "disks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "network" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "wg_handshake_age_seconds" integer,
  "reboot_required" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_metrics_latest" ADD CONSTRAINT "device_metrics_latest_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_metrics_samples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "uptime_seconds" bigint NOT NULL,
  "cpu_load1" double precision,
  "cpu_load5" double precision,
  "cpu_load15" double precision,
  "cpu_cores" integer,
  "memory_total_bytes" bigint,
  "memory_available_bytes" bigint,
  "memory_used_bytes" bigint,
  "disks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "network" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "wg_handshake_age_seconds" integer,
  "reboot_required" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_metrics_samples" ADD CONSTRAINT "device_metrics_samples_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_metrics_samples_device_sampled_idx" ON "device_metrics_samples" USING btree ("device_id","sampled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_metrics_samples_sampled_at_idx" ON "device_metrics_samples" USING btree ("sampled_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "name" text NOT NULL,
  "version" text NOT NULL,
  "source" text DEFAULT 'unknown' NOT NULL,
  "available_version" text,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_packages" ADD CONSTRAINT "device_packages_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_packages_device_name_source_idx" ON "device_packages" USING btree ("device_id","name","source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_packages_device_idx" ON "device_packages" USING btree ("device_id");
