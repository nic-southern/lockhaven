ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "is_container" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "assets" SET "is_container" = true WHERE "folder_kind" IS NOT NULL AND btrim("folder_kind") <> '';--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN IF EXISTS "folder_kind";
