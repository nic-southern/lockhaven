ALTER TABLE "route_policies" ADD COLUMN "entries" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "route_policies" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "route_policies" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "route_policies" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "route_policies" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "route_policies"
SET "entries" = COALESCE(
  (
    SELECT jsonb_agg(jsonb_build_object('cidr', route, 'label', NULL, 'comment', NULL) ORDER BY ordinality)
    FROM unnest("route_policies"."routes") WITH ORDINALITY AS r(route, ordinality)
  ),
  '[]'::jsonb
)
WHERE "entries" = '[]'::jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_policies_organization_default_idx" ON "route_policies" USING btree ("organization_id") WHERE "route_policies"."is_default" = true;
