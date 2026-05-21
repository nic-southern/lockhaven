CREATE TABLE "management_service_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"management_service_id" uuid NOT NULL,
	"password_ciphertext" text NOT NULL,
	"password_iv" text NOT NULL,
	"password_auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_service_credentials_management_service_id_unique" UNIQUE("management_service_id")
);
--> statement-breakpoint
ALTER TABLE "management_service_credentials" ADD CONSTRAINT "management_service_credentials_management_service_id_management_services_id_fk" FOREIGN KEY ("management_service_id") REFERENCES "public"."management_services"("id") ON DELETE cascade ON UPDATE no action;