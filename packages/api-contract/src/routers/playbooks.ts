import { TRPCError } from "@trpc/server"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { alerts, devices, playbookRuns, playbooks, sites } from "@nms/db"
import {
  alertKindLabels,
  canDecidePlaybookRun,
  parsePlaybookAction,
  playbookActionLabels,
  playbookInputSchema,
  playbookRunStatusLabels,
  playbookSkipReasonLabels,
} from "@nms/shared"

import {
  actorOrganizationIds,
  assertAuthorized,
  assertCanApprovePlaybook,
  canApprovePlaybook,
  requireActor,
} from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { queuePlaybookCommand } from "../playbook-engine"
import { combineConditions } from "../scope"
import { adminProcedure, createTRPCRouter, permissionProcedure } from "../trpc"

const playbookUpdateInput = playbookInputSchema.extend({
  id: z.string().uuid(),
})

function publicPlaybook(row: typeof playbooks.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    siteId: row.siteId,
    name: row.name,
    enabled: row.enabled,
    alertKind: row.alertKind,
    action: row.action,
    requireApproval: row.requireApproval,
    cooldownMinutes: row.cooldownMinutes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actionLabel: playbookActionLabels[row.action],
    alertKindLabel: alertKindLabels[row.alertKind],
  }
}

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

async function loadPlaybook(
  ctx: ApiContext,
  id: string
): Promise<typeof playbooks.$inferSelect> {
  const [row] = await ctx.db
    .select()
    .from(playbooks)
    .where(eq(playbooks.id, id))
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  return row
}

export const playbooksRouter = createTRPCRouter({
  list: permissionProcedure("device:view")
    .input(
      z
        .object({
          organizationId: z.string().uuid().optional(),
          siteId: z.string().uuid().nullable().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const organizationIds = actorOrganizationIds(ctx.actor)
      if (organizationIds !== null && organizationIds.length === 0) {
        return []
      }
      if (input?.organizationId) {
        assertAuthorized(ctx.actor, "device:view", {
          kind: "organization",
          organizationId: input.organizationId,
        })
      }

      const conditions = combineConditions([
        organizationIds === null
          ? undefined
          : inArray(playbooks.organizationId, organizationIds),
        input?.organizationId
          ? eq(playbooks.organizationId, input.organizationId)
          : undefined,
        input?.siteId === undefined
          ? undefined
          : input.siteId
            ? eq(playbooks.siteId, input.siteId)
            : undefined,
      ])

      const rows = await ctx.db
        .select({
          playbook: playbooks,
          siteName: sites.name,
        })
        .from(playbooks)
        .leftJoin(sites, eq(sites.id, playbooks.siteId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(playbooks.name)

      return rows.map((row) => ({
        ...publicPlaybook(row.playbook),
        siteName: row.siteName,
      }))
    }),

  create: permissionProcedure("organization:admin")
    .input(playbookInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      const action = parsePlaybookAction(input.action)
      if (!action) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That action is not allowed.",
        })
      }
      await assertSiteInOrganization(ctx, input.organizationId, input.siteId)

      try {
        const [record] = await ctx.db
          .insert(playbooks)
          .values({
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            name: input.name,
            enabled: input.enabled,
            alertKind: input.alertKind,
            action,
            requireApproval: input.requireApproval,
            cooldownMinutes: input.cooldownMinutes,
            createdByUserId: ctx.actor?.id ?? null,
            updatedAt: new Date(),
          })
          .returning()

        await writeAuditEvent(ctx, {
          organizationId: record.organizationId,
          eventType: "playbook_created",
          eventData: {
            playbookId: record.id,
            name: record.name,
            alertKind: record.alertKind,
            action: record.action,
            requireApproval: record.requireApproval,
          },
        })

        return publicPlaybook(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (
          message.includes("playbooks_org_kind") ||
          message.includes("playbooks_site_kind")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A playbook for that alert already exists in this scope.",
          })
        }
        throw error
      }
    }),

  update: permissionProcedure("organization:admin")
    .input(playbookUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadPlaybook(ctx, input.id)
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      if (input.organizationId !== existing.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Move this playbook by creating a new one.",
        })
      }
      const action = parsePlaybookAction(input.action)
      if (!action) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That action is not allowed.",
        })
      }
      await assertSiteInOrganization(ctx, input.organizationId, input.siteId)

      try {
        const [record] = await ctx.db
          .update(playbooks)
          .set({
            siteId: input.siteId ?? null,
            name: input.name,
            enabled: input.enabled,
            alertKind: input.alertKind,
            action,
            requireApproval: input.requireApproval,
            cooldownMinutes: input.cooldownMinutes,
            updatedAt: new Date(),
          })
          .where(eq(playbooks.id, input.id))
          .returning()

        await writeAuditEvent(ctx, {
          organizationId: record.organizationId,
          eventType: "playbook_updated",
          eventData: {
            playbookId: record.id,
            name: record.name,
            alertKind: record.alertKind,
            action: record.action,
            requireApproval: record.requireApproval,
            enabled: record.enabled,
          },
        })

        return publicPlaybook(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        if (
          message.includes("playbooks_org_kind") ||
          message.includes("playbooks_site_kind")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A playbook for that alert already exists in this scope.",
          })
        }
        throw error
      }
    }),

  delete: permissionProcedure("organization:admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadPlaybook(ctx, input.id)
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      await ctx.db.delete(playbooks).where(eq(playbooks.id, input.id))
      await writeAuditEvent(ctx, {
        organizationId: existing.organizationId,
        eventType: "playbook_deleted",
        eventData: {
          playbookId: existing.id,
          name: existing.name,
          alertKind: existing.alertKind,
          action: existing.action,
        },
      })
      return { id: existing.id }
    }),

  runs: permissionProcedure("device:view")
    .input(
      z
        .object({
          organizationId: z.string().uuid().optional(),
          playbookId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const organizationIds = actorOrganizationIds(ctx.actor)
      if (organizationIds !== null && organizationIds.length === 0) {
        return []
      }
      const conditions = combineConditions([
        organizationIds === null
          ? undefined
          : inArray(playbookRuns.organizationId, organizationIds),
        input?.organizationId
          ? eq(playbookRuns.organizationId, input.organizationId)
          : undefined,
        input?.playbookId
          ? eq(playbookRuns.playbookId, input.playbookId)
          : undefined,
      ])
      const rows = await ctx.db
        .select({
          id: playbookRuns.id,
          playbookId: playbookRuns.playbookId,
          playbookName: playbooks.name,
          alertId: playbookRuns.alertId,
          alertTitle: alerts.title,
          alertKind: alerts.kind,
          organizationId: playbookRuns.organizationId,
          siteId: playbookRuns.siteId,
          siteName: sites.name,
          deviceId: playbookRuns.deviceId,
          deviceName: devices.displayName,
          action: playbookRuns.action,
          status: playbookRuns.status,
          skipReason: playbookRuns.skipReason,
          deviceCommandId: playbookRuns.deviceCommandId,
          expiresAt: playbookRuns.expiresAt,
          createdAt: playbookRuns.createdAt,
          decidedAt: playbookRuns.decidedAt,
        })
        .from(playbookRuns)
        .innerJoin(playbooks, eq(playbooks.id, playbookRuns.playbookId))
        .innerJoin(alerts, eq(alerts.id, playbookRuns.alertId))
        .leftJoin(devices, eq(devices.id, playbookRuns.deviceId))
        .leftJoin(sites, eq(sites.id, playbookRuns.siteId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(playbookRuns.createdAt))
        .limit(input?.limit ?? 50)

      return rows.map((row) => ({
        ...row,
        actionLabel: playbookActionLabels[row.action],
        statusLabel: playbookRunStatusLabels[row.status],
        skipReasonLabel: row.skipReason
          ? playbookSkipReasonLabels[row.skipReason]
          : null,
      }))
    }),

  pendingApprovals: adminProcedure.query(async ({ ctx }) => {
    const actor = requireActor(ctx.actor)
    const organizationIds = actorOrganizationIds(actor)
    if (organizationIds !== null && organizationIds.length === 0) {
      return []
    }
    const now = new Date()
    const conditions = combineConditions([
      eq(playbookRuns.status, "pending_approval"),
      organizationIds === null
        ? undefined
        : inArray(playbookRuns.organizationId, organizationIds),
    ])
    const rows = await ctx.db
      .select({
        id: playbookRuns.id,
        playbookId: playbookRuns.playbookId,
        playbookName: playbooks.name,
        alertId: playbookRuns.alertId,
        alertTitle: alerts.title,
        organizationId: playbookRuns.organizationId,
        siteId: playbookRuns.siteId,
        siteName: sites.name,
        deviceId: playbookRuns.deviceId,
        deviceName: devices.displayName,
        action: playbookRuns.action,
        status: playbookRuns.status,
        expiresAt: playbookRuns.expiresAt,
        createdAt: playbookRuns.createdAt,
      })
      .from(playbookRuns)
      .innerJoin(playbooks, eq(playbooks.id, playbookRuns.playbookId))
      .innerJoin(alerts, eq(alerts.id, playbookRuns.alertId))
      .leftJoin(devices, eq(devices.id, playbookRuns.deviceId))
      .leftJoin(sites, eq(sites.id, playbookRuns.siteId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(playbookRuns.createdAt))

    return rows
      .filter((row) =>
        canApprovePlaybook(actor, row.organizationId, row.siteId)
      )
      .filter((row) => canDecidePlaybookRun(row.status, row.expiresAt, now))
      .map((row) => ({
        ...row,
        actionLabel: playbookActionLabels[row.action],
      }))
  }),

  decide: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "denied"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const now = new Date()
      const [row] = await ctx.db
        .select({
          run: playbookRuns,
          playbookName: playbooks.name,
        })
        .from(playbookRuns)
        .innerJoin(playbooks, eq(playbooks.id, playbookRuns.playbookId))
        .where(eq(playbookRuns.id, input.id))
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      assertCanApprovePlaybook(actor, row.run.organizationId, row.run.siteId)

      if (!canDecidePlaybookRun(row.run.status, row.run.expiresAt, now)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This request can no longer be reviewed.",
        })
      }

      const action = parsePlaybookAction(row.run.action)
      if (!action) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That action is not allowed.",
        })
      }

      if (input.decision === "denied") {
        const [updated] = await ctx.db
          .update(playbookRuns)
          .set({
            status: "denied",
            decidedByUserId: actor.id,
            decidedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(playbookRuns.id, row.run.id),
              eq(playbookRuns.status, "pending_approval")
            )
          )
          .returning()
        if (!updated) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This request was already decided.",
          })
        }
        await writeAuditEvent(ctx, {
          organizationId: updated.organizationId,
          siteId: updated.siteId,
          deviceId: updated.deviceId,
          eventType: "playbook_run_denied",
          eventData: {
            playbookRunId: updated.id,
            playbookId: updated.playbookId,
            playbookName: row.playbookName,
            action: updated.action,
            alertId: updated.alertId,
          },
        })
        return { id: updated.id, status: updated.status }
      }

      if (!row.run.deviceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This playbook has no device to act on.",
        })
      }

      const [claimed] = await ctx.db
        .update(playbookRuns)
        .set({
          decidedByUserId: actor.id,
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(playbookRuns.id, row.run.id),
            eq(playbookRuns.status, "pending_approval")
          )
        )
        .returning()
      if (!claimed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This request was already decided.",
        })
      }

      const queued = await queuePlaybookCommand(ctx.db, {
        playbookId: claimed.playbookId,
        playbookName: row.playbookName,
        alertId: claimed.alertId,
        organizationId: claimed.organizationId,
        siteId: claimed.siteId,
        deviceId: claimed.deviceId,
        action,
        createdByUserId: actor.id,
        runId: claimed.id,
        now,
      })
      if (queued !== "queued") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "The same action is already waiting for this device.",
        })
      }

      await writeAuditEvent(ctx, {
        organizationId: claimed.organizationId,
        siteId: claimed.siteId,
        deviceId: claimed.deviceId,
        eventType: "playbook_run_approved",
        eventData: {
          playbookRunId: claimed.id,
          playbookId: claimed.playbookId,
          playbookName: row.playbookName,
          action,
          alertId: claimed.alertId,
        },
      })

      return { id: claimed.id, status: "queued" as const }
    }),

  overview: permissionProcedure("device:view").query(async ({ ctx }) => {
    const organizationIds = actorOrganizationIds(ctx.actor)
    if (organizationIds !== null && organizationIds.length === 0) {
      return {
        playbookCount: 0,
        enabledCount: 0,
        pendingApprovalCount: 0,
        queuedCount: 0,
      }
    }
    const playbookScope =
      organizationIds === null
        ? undefined
        : inArray(playbooks.organizationId, organizationIds)
    const runScope =
      organizationIds === null
        ? undefined
        : inArray(playbookRuns.organizationId, organizationIds)

    const [[playbookCount], [enabledCount], [pendingCount], [queuedCount]] =
      await Promise.all([
        ctx.db.select({ total: count() }).from(playbooks).where(playbookScope),
        ctx.db
          .select({ total: count() })
          .from(playbooks)
          .where(
            playbookScope
              ? and(eq(playbooks.enabled, true), playbookScope)
              : eq(playbooks.enabled, true)
          ),
        ctx.db
          .select({ total: count() })
          .from(playbookRuns)
          .where(
            runScope
              ? and(eq(playbookRuns.status, "pending_approval"), runScope)
              : eq(playbookRuns.status, "pending_approval")
          ),
        ctx.db
          .select({ total: count() })
          .from(playbookRuns)
          .where(
            runScope
              ? and(eq(playbookRuns.status, "queued"), runScope)
              : eq(playbookRuns.status, "queued")
          ),
      ])

    return {
      playbookCount: Number(playbookCount?.total ?? 0),
      enabledCount: Number(enabledCount?.total ?? 0),
      pendingApprovalCount: Number(pendingCount?.total ?? 0),
      queuedCount: Number(queuedCount?.total ?? 0),
    }
  }),
})
