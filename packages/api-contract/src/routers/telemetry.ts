import { TRPCError } from "@trpc/server"
import { and, desc, eq, gte, ilike, isNotNull, lte, ne, or } from "drizzle-orm"
import { z } from "zod"

import {
  deviceMetricsLatest,
  deviceMetricsSamples,
  devicePackages,
  deviceTitles,
  devices,
} from "@nms/db"

import { assertAuthorized } from "../access"
import type { ApiContext } from "../context"
import { likePattern } from "../list"
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
              : undefined
          )
        )
        .orderBy(devicePackages.name)

      return {
        rebootRequired: latest?.rebootRequired ?? false,
        collectedAt: latest?.collectedAt ?? null,
        items: rows,
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
