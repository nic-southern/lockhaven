ALTER TABLE "device_models" ADD COLUMN IF NOT EXISTS "default_purchase_date" date;--> statement-breakpoint
ALTER TABLE "device_models" ADD COLUMN IF NOT EXISTS "retire_after_months" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "retire_after_months" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "retire_on" date;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_retire_on_idx" ON "assets" USING btree ("retire_on");
