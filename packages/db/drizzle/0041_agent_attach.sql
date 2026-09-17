CREATE INDEX IF NOT EXISTS "devices_organization_serial_idx" ON "devices" USING btree ("organization_id","serial_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_organization_hostname_idx" ON "devices" USING btree ("organization_id","hostname");
