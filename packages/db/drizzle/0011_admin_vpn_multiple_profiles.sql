DROP INDEX IF EXISTS "admin_vpn_profiles_organization_user_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_vpn_profiles_organization_user_idx" ON "admin_vpn_profiles" USING btree ("organization_id","user_id");
