import { TRPCError } from "@trpc/server"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import {
  alerts,
  assets,
  auditEvents,
  deviceModels,
  devices,
  notificationChannels,
  organizations,
  reportSchedules,
  sites,
} from "@nms/db"
import { emailChannelConfigSchema } from "@nms/notifications"
import {
  aroPerYearSchema,
  DEFAULT_ARO_PER_YEAR,
  MS_PER_DAY,
  reportCadenceSchema,
  reportTypeSchema,
  summarizeAssetRisk,
  utcDayEnd,
  utcDayStart,
} from "@nms/shared"

import { assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import {
  buildReportCsv,
  loadAccessLogReport,
  loadAlertReport,
  loadSessionReport,
  loadUptimeReport,
  type ReportFilter,
} from "../reporting-data"
import {
  combineConditions,
  deviceScopeCondition,
  eventScopeCondition,
  inventoryScopeCondition,
} from "../scope"
import { adminProcedure, createTRPCRouter, permissionProcedure } from "../trpc"

const MAX_RANGE_DAYS = 400

const rangeInput = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  organizationId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
})

const scheduleCreateInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(80),
  type: reportTypeSchema,
  cadence: reportCadenceSchema,
  channelId: z.string().uuid(),
  enabled: z.boolean().optional(),
})

const scheduleUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  type: reportTypeSchema.optional(),
  cadence: reportCadenceSchema.optional(),
  channelId: z.string().uuid().optional(),
  siteId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
})

function assertCanManage(ctx: ApiContext, organizationId: string) {
  assertAuthorized(ctx.actor, "organization:admin", {
    kind: "organization",
    organizationId,
  })
}

function normalizeRange(input: z.infer<typeof rangeInput>) {
  const from = utcDayStart(input.from)
  const isAlreadyExclusiveUtcMidnight =
    input.to.getUTCHours() === 0 &&
    input.to.getUTCMinutes() === 0 &&
    input.to.getUTCSeconds() === 0 &&
    input.to.getUTCMilliseconds() === 0 &&
    input.to.getTime() > from.getTime()
  const to = isAlreadyExclusiveUtcMidnight ? input.to : utcDayEnd(input.to)
  if (!(to.getTime() > from.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an end date after the start date.",
    })
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a shorter date range.",
    })
  }
  return { from, to }
}

function deviceFilter(
  ctx: ApiContext,
  input: z.infer<typeof rangeInput>
): ReportFilter {
  if (input.organizationId) {
    assertAuthorized(ctx.actor, "audit:view", {
      kind: "organization",
      organizationId: input.organizationId,
    })
  }
  const { from, to } = normalizeRange(input)
  return {
    from,
    to,
    organizationId: input.organizationId,
    siteId: input.siteId,
    scope: deviceScopeCondition(ctx.actor),
  }
}

function eventFilter(
  ctx: ApiContext,
  input: z.infer<typeof rangeInput>,
  columns: {
    organizationId:
      | typeof alerts.organizationId
      | typeof auditEvents.organizationId
    siteId: typeof alerts.siteId | typeof auditEvents.siteId
    deviceId: typeof alerts.deviceId | typeof auditEvents.deviceId
  }
): ReportFilter {
  if (input.organizationId) {
    assertAuthorized(ctx.actor, "audit:view", {
      kind: "organization",
      organizationId: input.organizationId,
    })
  }
  const { from, to } = normalizeRange(input)
  return {
    from,
    to,
    organizationId: input.organizationId,
    siteId: input.siteId,
    scope: eventScopeCondition(ctx.actor, columns),
  }
}

function publicSchedule(
  schedule: typeof reportSchedules.$inferSelect,
  extras: {
    organizationName: string
    siteName: string | null
    channelName: string
    channelType: string
  }
) {
  return {
    id: schedule.id,
    organizationId: schedule.organizationId,
    organizationName: extras.organizationName,
    siteId: schedule.siteId,
    siteName: extras.siteName,
    name: schedule.name,
    type: schedule.type,
    cadence: schedule.cadence,
    channelId: schedule.channelId,
    channelName: extras.channelName,
    channelType: extras.channelType,
    enabled: schedule.enabled,
    lastSentAt: schedule.lastSentAt,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  }
}

async function loadSchedule(ctx: ApiContext, id: string) {
  const [row] = await ctx.db
    .select({
      schedule: reportSchedules,
      organizationName: organizations.name,
      siteName: sites.name,
      channelName: notificationChannels.name,
      channelType: notificationChannels.type,
    })
    .from(reportSchedules)
    .innerJoin(
      organizations,
      eq(organizations.id, reportSchedules.organizationId)
    )
    .leftJoin(sites, eq(sites.id, reportSchedules.siteId))
    .innerJoin(
      notificationChannels,
      eq(notificationChannels.id, reportSchedules.channelId)
    )
    .where(eq(reportSchedules.id, id))
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  assertCanManage(ctx, row.schedule.organizationId)
  return row
}

async function assertEmailChannel(
  ctx: ApiContext,
  organizationId: string,
  channelId: string
) {
  const [channel] = await ctx.db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.id, channelId),
        eq(notificationChannels.organizationId, organizationId)
      )
    )
  if (!channel) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an email channel in this organization.",
    })
  }
  if (channel.type !== "email") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Scheduled reports are sent by email.",
    })
  }
  emailChannelConfigSchema.parse(channel.config)
  return channel
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

const assetRiskInput = z.object({
  organizationId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  aroPerYear: aroPerYearSchema.optional(),
})

export const reportsRouter = createTRPCRouter({
  /**
   * Morning expected-loss slice for linked in-service assets.
   * Dollar totals fail closed when no catalog/asset cost is set.
   */
  assetRisk: permissionProcedure("audit:view")
    .input(assetRiskInput.optional())
    .query(async ({ ctx, input }) => {
      const organizationId = input?.organizationId
      const siteId = input?.siteId
      const aroPerYear = input?.aroPerYear ?? DEFAULT_ARO_PER_YEAR
      if (organizationId) {
        assertAuthorized(ctx.actor, "audit:view", {
          kind: "organization",
          organizationId,
        })
      }
      const scope = inventoryScopeCondition(ctx.actor, {
        organizationId: assets.organizationId,
        siteId: assets.siteId,
      })
      if (scope.kind === "none") {
        return summarizeAssetRisk([], aroPerYear)
      }
      const conditions = combineConditions([
        scope.kind === "where" ? scope.condition : undefined,
        organizationId ? eq(assets.organizationId, organizationId) : undefined,
        siteId ? eq(assets.siteId, siteId) : undefined,
      ])
      const rows = await ctx.db
        .select({
          id: assets.id,
          tag: assets.tag,
          status: assets.status,
          siteId: assets.siteId,
          organizationId: assets.organizationId,
          assetPurchaseCost: assets.purchaseCost,
          deviceId: devices.id,
          siteName: sites.name,
          organizationName: organizations.name,
          deviceModelName: deviceModels.name,
          modelReplacementCost: deviceModels.replacementCost,
          modelPurchaseCost: deviceModels.purchaseCost,
        })
        .from(assets)
        .innerJoin(organizations, eq(organizations.id, assets.organizationId))
        .leftJoin(sites, eq(sites.id, assets.siteId))
        .leftJoin(deviceModels, eq(deviceModels.id, assets.deviceModelId))
        .leftJoin(devices, eq(devices.assetId, assets.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
      return summarizeAssetRisk(
        rows.map((row) => ({
          id: row.id,
          tag: row.tag,
          status: row.status,
          linked: Boolean(row.deviceId),
          siteId: row.siteId,
          siteName: row.siteName,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          deviceModelName: row.deviceModelName,
          modelReplacementCost: row.modelReplacementCost,
          modelPurchaseCost: row.modelPurchaseCost,
          assetPurchaseCost: row.assetPurchaseCost,
        })),
        aroPerYear
      )
    }),

  uptime: permissionProcedure("audit:view")
    .input(rangeInput)
    .query(async ({ ctx, input }) => {
      return loadUptimeReport(ctx.db, deviceFilter(ctx, input))
    }),

  sessions: permissionProcedure("audit:view")
    .input(rangeInput)
    .query(async ({ ctx, input }) => {
      return loadSessionReport(ctx.db, deviceFilter(ctx, input))
    }),

  alerts: permissionProcedure("audit:view")
    .input(rangeInput)
    .query(async ({ ctx, input }) => {
      return loadAlertReport(
        ctx.db,
        eventFilter(ctx, input, {
          organizationId: alerts.organizationId,
          siteId: alerts.siteId,
          deviceId: alerts.deviceId,
        })
      )
    }),

  accessLog: permissionProcedure("audit:view")
    .input(rangeInput)
    .query(async ({ ctx, input }) => {
      return loadAccessLogReport(
        ctx.db,
        eventFilter(ctx, input, {
          organizationId: auditEvents.organizationId,
          siteId: auditEvents.siteId,
          deviceId: auditEvents.deviceId,
        })
      )
    }),

  export: permissionProcedure("audit:view")
    .input(rangeInput.extend({ type: reportTypeSchema }))
    .query(async ({ ctx, input }) => {
      const filter =
        input.type === "alerts" || input.type === "access"
          ? eventFilter(ctx, input, {
              organizationId:
                input.type === "alerts"
                  ? alerts.organizationId
                  : auditEvents.organizationId,
              siteId:
                input.type === "alerts" ? alerts.siteId : auditEvents.siteId,
              deviceId:
                input.type === "alerts"
                  ? alerts.deviceId
                  : auditEvents.deviceId,
            })
          : deviceFilter(ctx, input)
      return buildReportCsv(ctx.db, input.type, filter)
    }),

  schedules: adminProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertCanManage(ctx, input.organizationId)
      const rows = await ctx.db
        .select({
          schedule: reportSchedules,
          organizationName: organizations.name,
          siteName: sites.name,
          channelName: notificationChannels.name,
          channelType: notificationChannels.type,
        })
        .from(reportSchedules)
        .innerJoin(
          organizations,
          eq(organizations.id, reportSchedules.organizationId)
        )
        .leftJoin(sites, eq(sites.id, reportSchedules.siteId))
        .innerJoin(
          notificationChannels,
          eq(notificationChannels.id, reportSchedules.channelId)
        )
        .where(eq(reportSchedules.organizationId, input.organizationId))
        .orderBy(desc(reportSchedules.createdAt))
      return rows.map((row) =>
        publicSchedule(row.schedule, {
          organizationName: row.organizationName,
          siteName: row.siteName,
          channelName: row.channelName,
          channelType: row.channelType,
        })
      )
    }),

  createSchedule: adminProcedure
    .input(scheduleCreateInput)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx, input.organizationId)
      await assertSiteInOrganization(ctx, input.organizationId, input.siteId)
      await assertEmailChannel(ctx, input.organizationId, input.channelId)
      const now = new Date()
      const [schedule] = await ctx.db
        .insert(reportSchedules)
        .values({
          organizationId: input.organizationId,
          siteId: input.siteId ?? null,
          name: input.name,
          type: input.type,
          cadence: input.cadence,
          channelId: input.channelId,
          enabled: input.enabled ?? true,
          createdByUserId: ctx.actor?.id ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      await writeAuditEvent(ctx, {
        organizationId: schedule.organizationId,
        siteId: schedule.siteId,
        eventType: "report_schedule_created",
        eventData: {
          scheduleId: schedule.id,
          type: schedule.type,
          cadence: schedule.cadence,
        },
      })
      const loaded = await loadSchedule(ctx, schedule.id)
      return publicSchedule(loaded.schedule, {
        organizationName: loaded.organizationName,
        siteName: loaded.siteName,
        channelName: loaded.channelName,
        channelType: loaded.channelType,
      })
    }),

  updateSchedule: adminProcedure
    .input(scheduleUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const current = await loadSchedule(ctx, input.id)
      const organizationId = current.schedule.organizationId
      if (input.siteId !== undefined) {
        await assertSiteInOrganization(ctx, organizationId, input.siteId)
      }
      if (input.channelId) {
        await assertEmailChannel(ctx, organizationId, input.channelId)
      }
      const now = new Date()
      const [schedule] = await ctx.db
        .update(reportSchedules)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
          ...(input.channelId !== undefined
            ? { channelId: input.channelId }
            : {}),
          ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          updatedAt: now,
        })
        .where(eq(reportSchedules.id, input.id))
        .returning()
      await writeAuditEvent(ctx, {
        organizationId: schedule.organizationId,
        siteId: schedule.siteId,
        eventType: "report_schedule_updated",
        eventData: {
          scheduleId: schedule.id,
          type: schedule.type,
          cadence: schedule.cadence,
          enabled: schedule.enabled,
        },
      })
      const loaded = await loadSchedule(ctx, schedule.id)
      return publicSchedule(loaded.schedule, {
        organizationName: loaded.organizationName,
        siteName: loaded.siteName,
        channelName: loaded.channelName,
        channelType: loaded.channelType,
      })
    }),

  deleteSchedule: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const current = await loadSchedule(ctx, input.id)
      await ctx.db
        .delete(reportSchedules)
        .where(eq(reportSchedules.id, input.id))
      await writeAuditEvent(ctx, {
        organizationId: current.schedule.organizationId,
        siteId: current.schedule.siteId,
        eventType: "report_schedule_deleted",
        eventData: {
          scheduleId: current.schedule.id,
          type: current.schedule.type,
          cadence: current.schedule.cadence,
        },
      })
      return { ok: true }
    }),
})
