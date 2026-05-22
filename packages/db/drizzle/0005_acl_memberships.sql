CREATE TYPE "public"."platform_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."site_role" AS ENUM('operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "organization_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "site_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "site_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" TYPE "public"."platform_role" USING "role"::"public"."platform_role";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'admin';--> statement-breakpoint
ALTER TABLE "route_policies" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_memberships" ADD CONSTRAINT "site_memberships_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_memberships" ADD CONSTRAINT "site_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_memberships" ADD CONSTRAINT "site_memberships_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_policies" ADD CONSTRAINT "route_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_policies" DROP CONSTRAINT "route_policies_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "route_policies_organization_name_idx" ON "route_policies" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_organization_user_idx" ON "organization_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_memberships_site_user_idx" ON "site_memberships" USING btree ("site_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "site_memberships_user_id_idx" ON "site_memberships" USING btree ("user_id");--> statement-breakpoint
