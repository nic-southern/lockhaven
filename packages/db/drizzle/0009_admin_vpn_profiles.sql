ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'vpn:admin_profile';--> statement-breakpoint
CREATE TABLE "admin_vpn_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"vpn_ipv4" "inet" NOT NULL,
	"wireguard_public_key" text NOT NULL,
	"label" text,
	"server_peer_enabled" boolean DEFAULT true NOT NULL,
	"last_handshake_at" timestamp with time zone,
	"latest_endpoint" text,
	"rx_bytes" integer DEFAULT 0 NOT NULL,
	"tx_bytes" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_vpn_profiles_vpn_ipv4_unique" UNIQUE("vpn_ipv4"),
	CONSTRAINT "admin_vpn_profiles_wireguard_public_key_unique" UNIQUE("wireguard_public_key")
);
--> statement-breakpoint
ALTER TABLE "admin_vpn_profiles" ADD CONSTRAINT "admin_vpn_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_vpn_profiles" ADD CONSTRAINT "admin_vpn_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_vpn_profiles_organization_user_idx" ON "admin_vpn_profiles" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_vpn_profiles_wireguard_public_key_idx" ON "admin_vpn_profiles" USING btree ("wireguard_public_key");
