ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "tracking_tag_prefix" text DEFAULT 'LH' NOT NULL;
