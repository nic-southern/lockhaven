ALTER TABLE "management_service_credentials" ADD COLUMN "username_ciphertext" text;--> statement-breakpoint
ALTER TABLE "management_service_credentials" ADD COLUMN "username_iv" text;--> statement-breakpoint
ALTER TABLE "management_service_credentials" ADD COLUMN "username_auth_tag" text;