import { TRPCError } from "@trpc/server"
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import {
  deviceMetricsLatest,
  deviceMetricsSamples,
  devicePackages,
  deviceTitles,
  devices,
  sites,
} from "@nms/db"

import { assertAuthorized } from "../access"
import type { ApiContext } from "../context"
import { likePattern } from "../list"
import { combineConditions, deviceScopeCondition } from "../scope"
import { createTRPCRouter, permissionProcedure } from "../trpc"

async function requireViewableDevice(ctx: ApiContext, deviceId: string) {
  const [device] = await ctx.db
    .select({
      id: devices.id,
      organizationId: devices.organizationId,
      siteId: devices.siteId,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))

  if (!device) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }

  assertAuthorized(ctx.actor, "device:view", {
    kind: "device",
    organizationId: device.organizationId,
    siteId: device.siteId,
  })

  return device
}

const deviceIdInput = z.object({ deviceId: z.string().uuid() })

export const telemetryRouter = createTRPCRouter({
  metricsLatest: permissionProcedure("device:view")
    .input(deviceIdInput)
    .query(async ({ ctx, input }) => {
      await requireViewableDevice(ctx, input.deviceId)

      const [row] = await ctx.db
        .select()
        .from(deviceMetricsLatest)
        .where(eq(deviceMetricsLatest.deviceId, input.deviceId))

      return row ?? null
    }),
  metricsSamples: permissionProcedure("device:view")
    .input(
      deviceIdInput.extend({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.number().int().min(1).max(200).default(48),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireViewableDevice(ctx, input.deviceId)

      const conditions = [
        eq(deviceMetricsSamples.deviceId, input.deviceId),
        input.from
          ? gte(deviceMetricsSamples.sampledAt, input.from)
          : undefined,
        input.to ? lte(deviceMetricsSamples.sampledAt, input.to) : undefined,
      ].filter((value): value is NonNullable<typeof value> => Boolean(value))

      return ctx.db
        .select()
        .from(deviceMetricsSamples)
        .where(and(...conditions))
        .orderBy(desc(deviceMetricsSamples.sampledAt))
        .limit(input.limit)
    }),
  packages: permissionProcedure("device:view")
    .input(
      deviceIdInput.extend({
        search: z.string().trim().max(200).optional(),
        updatesOnly: z.boolean().optional(),
        installNowOnly: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireViewableDevice(ctx, input.deviceId)

      const [latest] = await ctx.db
        .select({
          rebootRequired: deviceMetricsLatest.rebootRequired,
          collectedAt: deviceMetricsLatest.collectedAt,
        })
        .from(deviceMetricsLatest)
        .where(eq(deviceMetricsLatest.deviceId, input.deviceId))

      const [summary] = await ctx.db
        .select({
          total: count(),
          installNow: sql<number>`count(*) filter (where ${devicePackages.installImmediately})`,
        })
        .from(devicePackages)
        .where(eq(devicePackages.deviceId, input.deviceId))

      const rows = await ctx.db
        .select()
        .from(devicePackages)
        .where(
          and(
            eq(devicePackages.deviceId, input.deviceId),
            input.search
              ? or(
                  ilike(devicePackages.name, likePattern(input.search)),
                  ilike(devicePackages.source, likePattern(input.search))
                )
              : undefined,
            input.updatesOnly
              ? and(
                  isNotNull(devicePackages.availableVersion),
                  ne(devicePackages.availableVersion, devicePackages.version)
                )
              : undefined,
            input.installNowOnly
              ? eq(devicePackages.installImmediately, true)
              : undefined
          )
        )
        .orderBy(devicePackages.name)

      return {
        rebootRequired: latest?.rebootRequired ?? false,
        collectedAt: latest?.collectedAt ?? null,
        reported: Number(summary?.total ?? 0) > 0,
        installNowCount: Number(summary?.installNow ?? 0),
        items: rows,
      }
    }),
  installNow: permissionProcedure("device:view")
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const scope = deviceScopeCondition(ctx.actor)
      if (scope.kind === "none") {
        return { reported: false, installNowCount: 0, items: [] }
      }

      const visibleDevice = combineConditions([
        scope.kind === "where" ? scope.condition : undefined,
        isNull(devices.archivedAt),
      ])
      const deviceWhere =
        visibleDevice.length > 0 ? and(...visibleDevice) : undefined

      const [reportedRow] = await ctx.db
        .select({ id: devicePackages.id })
        .from(devicePackages)
        .innerJoin(devices, eq(devices.id, devicePackages.deviceId))
        .where(deviceWhere)
        .limit(1)

      const installNowWhere = and(
        deviceWhere,
        eq(devicePackages.installImmediately, true)
      )
      const [countRow] = await ctx.db
        .select({ total: count() })
        .from(devicePackages)
        .innerJoin(devices, eq(devices.id, devicePackages.deviceId))
        .where(installNowWhere)

      const search = input.search
        ? or(
            ilike(devicePackages.name, likePattern(input.search)),
            ilike(devices.displayName, likePattern(input.search)),
            ilike(devices.hostname, likePattern(input.search)),
            ilike(sites.name, likePattern(input.search))
          )
        : undefined

      const items = await ctx.db
        .select({
          id: devicePackages.id,
          deviceId: devices.id,
          deviceName: devices.displayName,
          siteName: sites.name,
          name: devicePackages.name,
          version: devicePackages.version,
          availableVersion: devicePackages.availableVersion,
          updateSeverity: devicePackages.updateSeverity,
          installImmediately: devicePackages.installImmediately,
          lastSeenAt: devicePackages.lastSeenAt,
        })
        .from(devicePackages)
        .innerJoin(devices, eq(devices.id, devicePackages.deviceId))
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .where(and(installNowWhere, search))
        .orderBy(devices.displayName, devicePackages.name)
        .limit(input.limit)

      return {
        reported: Boolean(reportedRow),
        installNowCount: Number(countRow?.total ?? 0),
        items,
      }
    }),
  titles: permissionProcedure("device:view")
    .input(
      deviceIdInput.extend({
        search: z.string().trim().max(200).optional(),
        notRunningOnly: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireViewableDevice(ctx, input.deviceId)

      const rows = await ctx.db
        .select()
        .from(deviceTitles)
        .where(
          and(
            eq(deviceTitles.deviceId, input.deviceId),
            input.search
              ? or(
                  ilike(deviceTitles.title, likePattern(input.search)),
                  ilike(deviceTitles.build, likePattern(input.search)),
                  ilike(deviceTitles.key, likePattern(input.search)),
                  ilike(deviceTitles.configHash, likePattern(input.search))
                )
              : undefined,
            input.notRunningOnly
              ? eq(deviceTitles.processRunning, false)
              : undefined
          )
        )
        .orderBy(deviceTitles.title)

      const collectedAt = rows.reduce<Date | null>((latest, row) => {
        if (!latest || row.lastSeenAt > latest) return row.lastSeenAt
        return latest
      }, null)

      return {
        collectedAt,
        items: rows,
      }
    }),
})
