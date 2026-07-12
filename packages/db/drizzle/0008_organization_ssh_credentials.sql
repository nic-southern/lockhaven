CREATE TABLE "organization_ssh_credentials" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"password_ciphertext" text NOT NULL,
	"password_iv" text NOT NULL,
	"password_auth_tag" text NOT NULL,
	"username_ciphertext" text NOT NULL,
	"username_iv" text NOT NULL,
	"username_auth_tag" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_ssh_credentials" ADD CONSTRAINT "organization_ssh_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
