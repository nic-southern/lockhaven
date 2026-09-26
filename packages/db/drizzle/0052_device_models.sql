CREATE TABLE IF NOT EXISTS "device_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "manufacturer" text,
  "model" text NOT NULL,
  "notes" text,
  "purchase_cost" numeric(12, 2),
  "replacement_cost" numeric(12, 2),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_models" ADD CONSTRAINT "device_models_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_models_organization_name_idx" ON "device_models" USING btree ("organization_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_models_organization_idx" ON "device_models" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_models_organization_identity_idx" ON "device_models" USING btree ("organization_id", "manufacturer", "model");--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "device_model_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_device_model_id_device_models_id_fk" FOREIGN KEY ("device_model_id") REFERENCES "public"."device_models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_device_model_id_idx" ON "assets" USING btree ("device_model_id");
