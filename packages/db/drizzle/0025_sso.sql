ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "sso_mfa_trusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_sso_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "protocol" text DEFAULT 'oidc' NOT NULL,
  "use_platform_idp" boolean DEFAULT true NOT NULL,
  "allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "trust_idp_mfa" boolean DEFAULT false NOT NULL,
  "claims_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "default_organization_role" "organization_role" DEFAULT 'technician' NOT NULL,
  "provider_id" text,
  "issuer" text,
  "discovery_url" text,
  "client_id" text,
  "client_secret" jsonb,
  "saml_entry_point" text,
  "saml_certificate" text,
  "saml_audience" text,
  "saml_metadata_xml" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_sso_settings" ADD CONSTRAINT "organization_sso_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_sso_settings_organization_idx" ON "organization_sso_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_sso_settings_provider_idx" ON "organization_sso_settings" USING btree ("provider_id") WHERE "provider_id" IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_sso_settings" ADD CONSTRAINT "organization_sso_settings_protocol_check" CHECK ("protocol" IN ('oidc', 'saml'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sso_provider" (
  "id" text PRIMARY KEY NOT NULL,
  "issuer" text NOT NULL,
  "domain" text NOT NULL,
  "oidc_config" text,
  "saml_config" text,
  "user_id" text,
  "provider_id" text NOT NULL,
  "organization_id" text
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sso_provider_provider_id_idx" ON "sso_provider" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sso_provider_organization_idx" ON "sso_provider" USING btree ("organization_id");
