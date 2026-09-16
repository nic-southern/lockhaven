import { TRPCError } from "@trpc/server"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import {
  devices,
  maintenanceWindows,
  organizations,
  sites,
  user,
} from "@nms/db"
import { isValidTimeZone, maintenanceWindowRecurrences } from "@nms/shared"

import { assertAuthorized, requireActor } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { combineConditions, eventScopeCondition } from "../scope"
import { adminProcedure, createTRPCRouter, permissionProcedure } from "../trpc"

const recurrenceSchema = z.enum(maintenanceWindowRecurrences)

const windowInput = z
  .object({
    organizationId: z.string().uuid(),
    siteId: z.string().uuid().nullable().optional(),
    deviceId: z.string().uuid().nullable().optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timeZone: z.string().trim().min(1).max(64).default("UTC"),
    recurrence: recurrenceSchema.default("none"),
    reason: z.string().trim().max(240).default(""),
  })
  .refine((value) => value.endsAt.getTime() > value.startsAt.getTime(), {
    message: "The end time must be after the start time.",
    path: ["endsAt"],
  })
  .refine((value) => isValidTimeZone(value.timeZone), {
    message: "Choose a valid time zone.",
    path: ["timeZone"],
  })

function assertCanManageWindow(ctx: ApiContext, organizationId: string) {
  assertAuthorized(ctx.actor, "organization:admin", {
    kind: "organization",
    organizationId,
  })
}

async function loadScopedTargets(
  ctx: ApiContext,
  input: {
    organizationId: string
    siteId?: string | null
    deviceId?: string | null
  }
) {
  const [organization] = await ctx.db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
  if (!organization) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }

  let siteId = input.siteId ?? null
  const deviceId = input.deviceId ?? null

  if (deviceId) {
    const [device] = await ctx.db
      .select({
        id: devices.id,
        organizationId: devices.organizationId,
        siteId: devices.siteId,
      })
      .from(devices)
      .where(eq(devices.id, deviceId))
    if (!device || device.organizationId !== input.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That device is not in this organization.",
      })
    }
    if (siteId && device.siteId && siteId !== device.siteId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That device does not belong to the selected site.",
      })
    }
    siteId = device.siteId
  } else if (siteId) {
    const [site] = await ctx.db
      .select({ id: sites.id, organizationId: sites.organizationId })
      .from(sites)
      .where(eq(sites.id, siteId))
    if (!site || site.organizationId !== input.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That site is not in this organization.",
      })
    }
  }

  return {
    organizationId: input.organizationId,
    siteId,
    deviceId,
  }
}

async function loadWindow(ctx: ApiContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(maintenanceWindows)
    .where(eq(maintenanceWindows.id, id))
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  assertCanManageWindow(ctx, row.organizationId)
  return row
}

export const maintenanceRouter = createTRPCRouter({
  list: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = eventScopeCondition(ctx.actor, {
      organizationId: maintenanceWindows.organizationId,
      siteId: maintenanceWindows.siteId,
      deviceId: maintenanceWindows.deviceId,
    })
    if (scope.kind === "none") return []

    const where = combineConditions([
      scope.kind === "where" ? scope.condition : undefined,
    ])

    const createdBy = user
    const rows = await ctx.db
      .select({
        id: maintenanceWindows.id,
        organizationId: maintenanceWindows.organizationId,
        organizationName: organizations.name,
        siteId: maintenanceWindows.siteId,
        siteName: sites.name,
        deviceId: maintenanceWindows.deviceId,
        deviceName: devices.displayName,
        deviceHostname: devices.hostname,
        startsAt: maintenanceWindows.startsAt,
        endsAt: maintenanceWindows.endsAt,
        timeZone: maintenanceWindows.timeZone,
        recurrence: maintenanceWindows.recurrence,
        reason: maintenanceWindows.reason,
        createdByUserId: maintenanceWindows.createdByUserId,
        createdByName: createdBy.name,
        createdAt: maintenanceWindows.createdAt,
        updatedAt: maintenanceWindows.updatedAt,
      })
      .from(maintenanceWindows)
      .leftJoin(
        organizations,
        eq(organizations.id, maintenanceWindows.organizationId)
      )
      .leftJoin(sites, eq(sites.id, maintenanceWindows.siteId))
      .leftJoin(devices, eq(devices.id, maintenanceWindows.deviceId))
      .leftJoin(createdBy, eq(createdBy.id, maintenanceWindows.createdByUserId))
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(maintenanceWindows.startsAt))

    return rows
  }),

  create: adminProcedure.input(windowInput).mutation(async ({ ctx, input }) => {
    const actor = requireActor(ctx.actor)
    assertCanManageWindow(ctx, input.organizationId)
    const scope = await loadScopedTargets(ctx, input)
    const now = new Date()

    return ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(maintenanceWindows)
        .values({
          organizationId: scope.organizationId,
          siteId: scope.siteId,
          deviceId: scope.deviceId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          timeZone: input.timeZone,
          recurrence: input.recurrence,
          reason: input.reason,
          createdByUserId: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      await writeAuditEvent(
        { ...ctx, db: tx },
        {
          eventType: "maintenance_window_created",
          organizationId: row.organizationId,
          siteId: row.siteId,
          deviceId: row.deviceId,
          eventData: {
            windowId: row.id,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
            timeZone: row.timeZone,
            recurrence: row.recurrence,
            reason: row.reason,
          },
        }
      )
      return row
    })
  }),

  update: adminProcedure
    .input(windowInput.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadWindow(ctx, input.id)
      assertCanManageWindow(ctx, input.organizationId)
      const scope = await loadScopedTargets(ctx, input)
      const now = new Date()

      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(maintenanceWindows)
          .set({
            organizationId: scope.organizationId,
            siteId: scope.siteId,
            deviceId: scope.deviceId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            timeZone: input.timeZone,
            recurrence: input.recurrence,
            reason: input.reason,
            updatedAt: now,
          })
          .where(eq(maintenanceWindows.id, existing.id))
          .returning()

        await writeAuditEvent(
          { ...ctx, db: tx },
          {
            eventType: "maintenance_window_updated",
            organizationId: row.organizationId,
            siteId: row.siteId,
            deviceId: row.deviceId,
            eventData: {
              windowId: row.id,
              startsAt: row.startsAt.toISOString(),
              endsAt: row.endsAt.toISOString(),
              timeZone: row.timeZone,
              recurrence: row.recurrence,
              reason: row.reason,
            },
          }
        )
        return row
      })
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadWindow(ctx, input.id)
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(maintenanceWindows)
          .where(eq(maintenanceWindows.id, existing.id))
        await writeAuditEvent(
          { ...ctx, db: tx },
          {
            eventType: "maintenance_window_deleted",
            organizationId: existing.organizationId,
            siteId: existing.siteId,
            deviceId: existing.deviceId,
            eventData: {
              windowId: existing.id,
              startsAt: existing.startsAt.toISOString(),
              endsAt: existing.endsAt.toISOString(),
              timeZone: existing.timeZone,
              recurrence: existing.recurrence,
              reason: existing.reason,
            },
          }
        )
      })
      return { id: existing.id }
    }),
})
