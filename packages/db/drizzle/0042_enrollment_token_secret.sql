ALTER TABLE "enrollment_tokens" ADD COLUMN IF NOT EXISTS "token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD COLUMN IF NOT EXISTS "token_iv" text;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD COLUMN IF NOT EXISTS "token_auth_tag" text;
