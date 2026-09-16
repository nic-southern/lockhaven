ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "contacts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "business_hours" jsonb;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "site_id" uuid,
  "tag" text NOT NULL,
  "vendor" text,
  "model" text,
  "serial" text,
  "hostname" text,
  "status" text DEFAULT 'stock' NOT NULL,
  "purchase_date" date,
  "purchase_cost" numeric(12, 2),
  "warranty_expires_on" date,
  "notes" text,
  "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_organization_tag_idx" ON "assets" USING btree ("organization_id", "tag");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_organization_serial_idx" ON "assets" USING btree ("organization_id", "serial") WHERE "serial" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_organization_status_idx" ON "assets" USING btree ("organization_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_site_idx" ON "assets" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_warranty_expires_on_idx" ON "assets" USING btree ("warranty_expires_on");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_status_check" CHECK ("status" IN ('stock', 'in_service', 'maintenance', 'retired', 'disposed'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "field_type" text DEFAULT 'text' NOT NULL,
  "applies_to" text DEFAULT 'both' NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "options" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_definitions_organization_key_idx" ON "custom_field_definitions" USING btree ("organization_id", "key");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_field_type_check" CHECK ("field_type" IN ('text', 'number', 'date', 'select', 'boolean'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_applies_to_check" CHECK ("applies_to" IN ('device', 'asset', 'both'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_asset_id_idx" ON "devices" USING btree ("asset_id") WHERE "asset_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "asset_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_asset_idx" ON "alerts" USING btree ("asset_id");
