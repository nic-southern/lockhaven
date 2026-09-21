ALTER TABLE "device_packages" ADD COLUMN IF NOT EXISTS "update_severity" text;--> statement-breakpoint
ALTER TABLE "device_packages" ADD COLUMN IF NOT EXISTS "install_immediately" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_packages" ADD CONSTRAINT "device_packages_update_severity_check" CHECK (
   "update_severity" IS NULL OR "update_severity" IN ('security', 'critical')
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_packages" ADD CONSTRAINT "device_packages_install_immediately_check" CHECK (
   "install_immediately" = false OR "update_severity" IS NOT NULL
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_packages_install_immediately_idx" ON "device_packages" USING btree ("install_immediately") WHERE "install_immediately";
