ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "parent_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "folder_kind" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "assets"
    ADD CONSTRAINT "assets_parent_asset_id_assets_id_fk"
    FOREIGN KEY ("parent_asset_id") REFERENCES "public"."assets"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_organization_parent_asset_id_idx"
  ON "assets" USING btree ("organization_id", "parent_asset_id");
