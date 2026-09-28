CREATE TABLE IF NOT EXISTS "field_auth_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "user_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "state" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "field_auth_handoffs"
    ADD CONSTRAINT "field_auth_handoffs_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "field_auth_handoffs_code_hash_unique"
  ON "field_auth_handoffs" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_auth_handoffs_user_id_idx"
  ON "field_auth_handoffs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_auth_handoffs_expires_at_idx"
  ON "field_auth_handoffs" USING btree ("expires_at");
