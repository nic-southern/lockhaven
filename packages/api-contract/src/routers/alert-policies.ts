import { TRPCError } from "@trpc/server"
import { and, eq, isNull, or } from "drizzle-orm"
import { z } from "zod"

import { alertPolicies, sites } from "@nms/db"
import {
  alertKindSchema,
  alertKinds,
  auditSeveritySchema,
  pickEffectiveAlertPolicy,
  type AlertPolicyFields,
} from "@nms/shared"

import { assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { createTRPCRouter, permissionProcedure } from "../trpc"

function assertCanManage(ctx: ApiContext, organizationId: string) {
  assertAuthorized(ctx.actor, "organization:admin", {
    kind: "organization",
    organizationId,
  })
}

const thresholdsSchema = z
  .object({
    offlineHours: z.number().int().min(1).max(168).optional(),
  })
  .strict()

const upsertInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().nullable().optional(),
  kind: alertKindSchema,
  enabled: z.boolean(),
  severity: auditSeveritySchema.nullable(),
  escalateAfterMinutes: z.number().int().min(1).max(10_080).nullable(),
  thresholds: thresholdsSchema.default({}),
})

async function assertSiteInOrganization(
  ctx: ApiContext,
  organizationId: string,
  siteId: string | null | undefined
) {
  if (!siteId) return
  const [site] = await ctx.db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)))
  if (!site) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That site is not in this organization.",
    })
  }
}

function asFields(row: typeof alertPolicies.$inferSelect): AlertPolicyFields {
  return {
    organizationId: row.organizationId,
    siteId: row.siteId,
    kind: row.kind,
    enabled: row.enabled,
    severity: row.severity,
    escalateAfterMinutes: row.escalateAfterMinutes,
    thresholds: row.thresholds ?? {},
  }
}

export const alertPoliciesRouter = createTRPCRouter({
  list: permissionProcedure("organization:admin")
    .input(
      z.object({
        organizationId: z.string().uuid(),
        siteId: z.string().uuid().nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      assertCanManage(ctx, input.organizationId)
      await assertSiteInOrganization(ctx, input.organizationId, input.siteId)

      const rows = await ctx.db
        .select()
        .from(alertPolicies)
        .where(
          and(
            eq(alertPolicies.organizationId, input.organizationId),
            input.siteId
              ? or(
                  isNull(alertPolicies.siteId),
                  eq(alertPolicies.siteId, input.siteId)
                )
              : isNull(alertPolicies.siteId)
          )
        )

      const orgRows = rows.filter((row) => row.siteId === null)
      const siteRows = input.siteId
        ? rows.filter((row) => row.siteId === input.siteId)
        : []

      return {
        items: rows,
        kinds: alertKinds.map((kind) => ({
          kind,
          effective: pickEffectiveAlertPolicy(
            [...orgRows, ...siteRows].map(asFields),
            kind,
            input.organizationId,
            input.siteId ?? null
          ),
          orgPolicy: orgRows.find((row) => row.kind === kind) ?? null,
          sitePolicy: siteRows.find((row) => row.kind === kind) ?? null,
        })),
      }
    }),

  upsert: permissionProcedure("organization:admin")
    .input(upsertInput)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx, input.organizationId)
      const siteId = input.siteId ?? null
      await assertSiteInOrganization(ctx, input.organizationId, siteId)
      const now = new Date()

      const existing = await ctx.db
        .select()
        .from(alertPolicies)
        .where(
          and(
            eq(alertPolicies.organizationId, input.organizationId),
            eq(alertPolicies.kind, input.kind),
            siteId
              ? eq(alertPolicies.siteId, siteId)
              : isNull(alertPolicies.siteId)
          )
        )

      const values = {
        organizationId: input.organizationId,
        siteId,
        kind: input.kind,
        enabled: input.enabled,
        severity: input.severity,
        escalateAfterMinutes: input.escalateAfterMinutes,
        thresholds: input.thresholds,
        updatedAt: now,
      }

      const record = await ctx.db.transaction(async (tx) => {
        const [row] = existing[0]
          ? await tx
              .update(alertPolicies)
              .set(values)
              .where(eq(alertPolicies.id, existing[0].id))
              .returning()
          : await tx
              .insert(alertPolicies)
              .values({ ...values, createdAt: now })
              .returning()

        await writeAuditEvent(
          { ...ctx, db: tx },
          {
            eventType: "alert_policy_updated",
            organizationId: input.organizationId,
            siteId,
            eventData: {
              policyId: row.id,
              kind: row.kind,
              enabled: row.enabled,
              severity: row.severity,
              escalateAfterMinutes: row.escalateAfterMinutes,
              thresholds: row.thresholds,
              siteId,
              created: !existing[0],
              previous: existing[0]
                ? {
                    enabled: existing[0].enabled,
                    severity: existing[0].severity,
                    escalateAfterMinutes: existing[0].escalateAfterMinutes,
                    thresholds: existing[0].thresholds,
                  }
                : null,
            },
          }
        )
        return row
      })

      return record
    }),
})
