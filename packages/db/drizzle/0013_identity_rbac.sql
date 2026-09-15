ALTER TYPE "public"."platform_role" ADD VALUE IF NOT EXISTS 'member';--> statement-breakpoint
ALTER TYPE "public"."organization_role" ADD VALUE IF NOT EXISTS 'technician' BEFORE 'viewer';--> statement-breakpoint
ALTER TYPE "public"."site_role" ADD VALUE IF NOT EXISTS 'technician' BEFORE 'viewer';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'credential:reveal';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'device:delete';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'user:manage';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "two_factor_enforced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "invited_by" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"count" integer,
	"last_request" bigint
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"platform_role" "platform_role" DEFAULT 'admin' NOT NULL,
	"organization_id" uuid,
	"organization_role" "organization_role",
	"site_grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invited_by_user_id" text,
	"accepted_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitations_token_hash_unique" UNIQUE("token_hash")
);--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_accepted_user_id_user_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credential_id_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_key_idx" ON "rate_limit" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invitations_email_idx" ON "user_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_invitations_organization_id_idx" ON "user_invitations" USING btree ("organization_id");
