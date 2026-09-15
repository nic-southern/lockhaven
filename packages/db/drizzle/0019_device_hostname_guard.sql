ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "hostname_change_allowed_at" timestamp with time zone;
