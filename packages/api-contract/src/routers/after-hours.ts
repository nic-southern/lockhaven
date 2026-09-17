import { TRPCError } from "@trpc/server"
import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { siteAfterHoursRuns, sites } from "@nms/db"
import {
  afterHoursDeviceOutcomeLabels,
  afterHoursRunStatusLabels,
  afterHoursStepsSummary,
  canDecidePlaybookRun,
  sanitizeAfterHoursSteps,
  type AfterHoursRunStatus,
} from "@nms/shared"

import {
  actorOrganizationIds,
  assertAuthorized,
  assertCanApprovePlaybook,
  canApprovePlaybook,
  requireActor,
} from "../access"
import { queueAfterHoursRunCommands } from "../after-hours-engine"
import { writeAuditEvent } from "../audit"
import { combineConditions } from "../scope"
import { adminProcedure, createTRPCRouter, permissionProcedure } from "../trpc"

function publicRun(
  row: typeof siteAfterHoursRuns.$inferSelect,
  siteName: string | null,
  now: Date
) {
  const status: AfterHoursRunStatus =
    row.status === "pending_approval" &&
    row.expiresAt &&
    row.expiresAt.getTime() <= now.getTime()
      ? "expired"
      : row.status
  const steps = sanitizeAfterHoursSteps(row.steps)
  return {
    id: row.id,
    siteId: row.siteId,
    siteName,
    organizationId: row.organizationId,
    closedAt: row.closedAt,
    steps,
    stepsLabel: afterHoursStepsSummary(steps),
    requireApproval: row.requireApproval,
    status,
    statusLabel: afterHoursRunStatusLabels[status],
    queuedDeviceCount: row.queuedDeviceCount,
    skippedDeviceCount: row.skippedDeviceCount,
    devices: row.deviceResults.map((entry) => ({
      ...entry,
      outcomeLabel: afterHoursDeviceOutcomeLabels[entry.outcome],
    })),
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  }
}

export const afterHoursRouter = createTRPCRouter({
  runs: permissionProcedure("device:view")
    .input(
      z
        .object({
          organizationId: z.string().uuid().optional(),
          siteId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(100).optional(),
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
          : inArray(siteAfterHoursRuns.organizationId, organizationIds),
        input?.organizationId
          ? eq(siteAfterHoursRuns.organizationId, input.organizationId)
          : undefined,
        input?.siteId ? eq(siteAfterHoursRuns.siteId, input.siteId) : undefined,
      ])
      const now = new Date()
      const rows = await ctx.db
        .select({ run: siteAfterHoursRuns, siteName: sites.name })
        .from(siteAfterHoursRuns)
        .leftJoin(sites, eq(sites.id, siteAfterHoursRuns.siteId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(siteAfterHoursRuns.createdAt))
        .limit(input?.limit ?? 50)
      return rows.map((row) => publicRun(row.run, row.siteName, now))
    }),

  pendingApprovals: adminProcedure.query(async ({ ctx }) => {
    const actor = requireActor(ctx.actor)
    const organizationIds = actorOrganizationIds(actor)
    if (organizationIds !== null && organizationIds.length === 0) {
      return []
    }
    const now = new Date()
    const conditions = combineConditions([
      eq(siteAfterHoursRuns.status, "pending_approval"),
      organizationIds === null
        ? undefined
        : inArray(siteAfterHoursRuns.organizationId, organizationIds),
    ])
    const rows = await ctx.db
      .select({ run: siteAfterHoursRuns, siteName: sites.name })
      .from(siteAfterHoursRuns)
      .leftJoin(sites, eq(sites.id, siteAfterHoursRuns.siteId))
      .where(and(...conditions))
      .orderBy(desc(siteAfterHoursRuns.createdAt))
    return rows
      .filter((row) =>
        canApprovePlaybook(actor, row.run.organizationId, row.run.siteId)
      )
      .filter((row) =>
        canDecidePlaybookRun("pending_approval", row.run.expiresAt, now)
      )
      .map((row) => publicRun(row.run, row.siteName, now))
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
        .select({ run: siteAfterHoursRuns, siteName: sites.name })
        .from(siteAfterHoursRuns)
        .leftJoin(sites, eq(sites.id, siteAfterHoursRuns.siteId))
        .where(eq(siteAfterHoursRuns.id, input.id))
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertCanApprovePlaybook(actor, row.run.organizationId, row.run.siteId)

      if (
        row.run.status !== "pending_approval" ||
        !canDecidePlaybookRun("pending_approval", row.run.expiresAt, now)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This request can no longer be reviewed.",
        })
      }

      const steps = sanitizeAfterHoursSteps(row.run.steps)
      if (steps.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That action is not allowed.",
        })
      }
      const siteName = row.siteName ?? "Site"

      if (input.decision === "denied") {
        const [updated] = await ctx.db
          .update(siteAfterHoursRuns)
          .set({
            status: "denied",
            decidedByUserId: actor.id,
            decidedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(siteAfterHoursRuns.id, row.run.id),
              eq(siteAfterHoursRuns.status, "pending_approval")
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
          eventType: "after_hours_run_denied",
          eventData: {
            afterHoursRunId: updated.id,
            siteName,
            steps,
          },
        })
        return { id: updated.id, status: updated.status }
      }

      const [claimed] = await ctx.db
        .update(siteAfterHoursRuns)
        .set({
          decidedByUserId: actor.id,
          decidedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(siteAfterHoursRuns.id, row.run.id),
            eq(siteAfterHoursRuns.status, "pending_approval")
          )
        )
        .returning()
      if (!claimed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This request was already decided.",
        })
      }

      const queued = await queueAfterHoursRunCommands(ctx.db, {
        run: {
          id: claimed.id,
          siteId: claimed.siteId,
          organizationId: claimed.organizationId,
          steps,
        },
        siteName,
        actorUserId: actor.id,
        now,
      })

      await writeAuditEvent(ctx, {
        organizationId: claimed.organizationId,
        siteId: claimed.siteId,
        eventType: "after_hours_run_approved",
        eventData: {
          afterHoursRunId: claimed.id,
          siteName,
          steps,
          queuedDevices: queued.queuedDevices,
        },
      })

      return { id: claimed.id, status: queued.status }
    }),
})
