ALTER TABLE "vpn_identities" ALTER COLUMN "rx_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "vpn_identities" ALTER COLUMN "tx_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "admin_vpn_profiles" ALTER COLUMN "rx_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "admin_vpn_profiles" ALTER COLUMN "tx_bytes" SET DATA TYPE bigint;
