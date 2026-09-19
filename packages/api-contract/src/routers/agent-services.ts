import { TRPCError } from "@trpc/server"
import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { z } from "zod"

import { agentServiceAssignments, agentServices, devices, sites } from "@nms/db"
import {
  agentServiceAssignSchema,
  agentServiceCreateSchema,
  agentServiceUpdateSchema,
  encodeAssignedServices,
  type AssignedAgentService,
} from "@nms/shared"

import { actorOrganizationIds, assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { combineConditions } from "../scope"
import { createTRPCRouter, permissionProcedure } from "../trpc"

function publicService(row: typeof agentServices.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    target: row.target,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function loadService(ctx: ApiContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(agentServices)
    .where(eq(agentServices.id, id))
  if (!row) throw new TRPCError({ code: "NOT_FOUND" })
  return row
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

async function assertDeviceInOrganization(
  ctx: ApiContext,
  organizationId: string,
  deviceId: string | null | undefined
) {
  if (!deviceId) return
  const [device] = await ctx.db
    .select({ id: devices.id, siteId: devices.siteId })
    .from(devices)
    .where(
      and(eq(devices.id, deviceId), eq(devices.organizationId, organizationId))
    )
  if (!device) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That device is not in this organization.",
    })
  }
  return device
}

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  return error.code === "23505"
}

export async function loadAssignedServices(
  db: ApiContext["db"],
  device: { id: string; organizationId: string; siteId: string | null }
): Promise<AssignedAgentService[]> {
  const assignmentScope = or(
    and(
      eq(agentServiceAssignments.organizationId, device.organizationId),
      isNull(agentServiceAssignments.siteId),
      isNull(agentServiceAssignments.deviceId)
    ),
    device.siteId
      ? and(
          eq(agentServiceAssignments.organizationId, device.organizationId),
          eq(agentServiceAssignments.siteId, device.siteId),
          isNull(agentServiceAssignments.deviceId)
        )
      : undefined,
    and(
      eq(agentServiceAssignments.organizationId, device.organizationId),
      eq(agentServiceAssignments.deviceId, device.id)
    )
  )

  const rows = await db
    .select({
      name: agentServices.name,
      target: agentServices.target,
    })
    .from(agentServiceAssignments)
    .innerJoin(
      agentServices,
      eq(agentServices.id, agentServiceAssignments.serviceId)
    )
    .where(
      and(
        eq(agentServices.organizationId, device.organizationId),
        assignmentScope
      )
    )

  return encodeAssignedServices(rows)
}

export const agentServicesRouter = createTRPCRouter({
  list: permissionProcedure("device:view")
    .input(
      z.object({ organizationId: z.string().uuid().optional() }).optional()
    )
    .query(async ({ ctx, input }) => {
      const organizationIds = actorOrganizationIds(ctx.actor)
      if (organizationIds !== null && organizationIds.length === 0) return []
      if (input?.organizationId) {
        assertAuthorized(ctx.actor, "device:view", {
          kind: "organization",
          organizationId: input.organizationId,
        })
      }
      const conditions = combineConditions([
        organizationIds === null
          ? undefined
          : inArray(agentServices.organizationId, organizationIds),
        input?.organizationId
          ? eq(agentServices.organizationId, input.organizationId)
          : undefined,
      ])
      const rows = await ctx.db
        .select()
        .from(agentServices)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(agentServices.name)

      const assignments = rows.length
        ? await ctx.db
            .select({
              id: agentServiceAssignments.id,
              serviceId: agentServiceAssignments.serviceId,
              organizationId: agentServiceAssignments.organizationId,
              siteId: agentServiceAssignments.siteId,
              deviceId: agentServiceAssignments.deviceId,
              siteName: sites.name,
              deviceName: devices.displayName,
            })
            .from(agentServiceAssignments)
            .leftJoin(sites, eq(sites.id, agentServiceAssignments.siteId))
            .leftJoin(devices, eq(devices.id, agentServiceAssignments.deviceId))
            .where(
              inArray(
                agentServiceAssignments.serviceId,
                rows.map((row) => row.id)
              )
            )
        : []

      return rows.map((row) => ({
        ...publicService(row),
        assignments: assignments
          .filter((assignment) => assignment.serviceId === row.id)
          .map((assignment) => ({
            id: assignment.id,
            organizationId: assignment.organizationId,
            siteId: assignment.siteId,
            deviceId: assignment.deviceId,
            siteName: assignment.siteName,
            deviceName: assignment.deviceName,
            scope: assignment.deviceId
              ? ("device" as const)
              : assignment.siteId
                ? ("site" as const)
                : ("organization" as const),
          })),
      }))
    }),

  forDevice: permissionProcedure("device:view")
    .input(z.object({ deviceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [device] = await ctx.db
        .select({
          id: devices.id,
          organizationId: devices.organizationId,
          siteId: devices.siteId,
        })
        .from(devices)
        .where(eq(devices.id, input.deviceId))
      if (!device) throw new TRPCError({ code: "NOT_FOUND" })
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })
      return loadAssignedServices(ctx.db, device)
    }),

  create: permissionProcedure("organization:admin")
    .input(agentServiceCreateSchema)
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      try {
        const [record] = await ctx.db
          .insert(agentServices)
          .values({
            organizationId: input.organizationId,
            name: input.name,
            target: input.target,
            createdByUserId: ctx.actor?.id ?? null,
            updatedAt: new Date(),
          })
          .returning()
        await writeAuditEvent(ctx, {
          organizationId: record.organizationId,
          eventType: "agent_service_created",
          eventData: {
            serviceId: record.id,
            name: record.name,
          },
        })
        return publicService(record)
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A service with that name already exists.",
          })
        }
        throw error
      }
    }),

  update: permissionProcedure("organization:admin")
    .input(agentServiceUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadService(ctx, input.id)
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      try {
        const [record] = await ctx.db
          .update(agentServices)
          .set({
            name: input.name,
            target: input.target,
            updatedAt: new Date(),
          })
          .where(eq(agentServices.id, existing.id))
          .returning()
        await writeAuditEvent(ctx, {
          organizationId: existing.organizationId,
          eventType: "agent_service_updated",
          eventData: { serviceId: record.id, name: record.name },
        })
        return publicService(record)
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A service with that name already exists.",
          })
        }
        throw error
      }
    }),

  delete: permissionProcedure("organization:admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadService(ctx, input.id)
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      await ctx.db
        .delete(agentServices)
        .where(eq(agentServices.id, existing.id))
      await writeAuditEvent(ctx, {
        organizationId: existing.organizationId,
        eventType: "agent_service_deleted",
        eventData: { serviceId: existing.id, name: existing.name },
      })
      return { id: existing.id }
    }),

  assign: permissionProcedure("organization:admin")
    .input(agentServiceAssignSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadService(ctx, input.serviceId)
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      await assertSiteInOrganization(ctx, existing.organizationId, input.siteId)
      const device = await assertDeviceInOrganization(
        ctx,
        existing.organizationId,
        input.deviceId
      )
      if (device) {
        assertAuthorized(ctx.actor, "organization:admin", {
          kind: "device",
          organizationId: existing.organizationId,
          siteId: device.siteId,
        })
      }
      try {
        const [record] = await ctx.db
          .insert(agentServiceAssignments)
          .values({
            serviceId: existing.id,
            organizationId: existing.organizationId,
            siteId: input.siteId ?? null,
            deviceId: input.deviceId ?? null,
            createdByUserId: ctx.actor?.id ?? null,
          })
          .returning()
        await writeAuditEvent(ctx, {
          organizationId: existing.organizationId,
          siteId: record.siteId,
          deviceId: record.deviceId,
          eventType: "agent_service_assigned",
          eventData: {
            serviceId: existing.id,
            assignmentId: record.id,
            name: existing.name,
          },
        })
        return record
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That service is already assigned there.",
          })
        }
        throw error
      }
    }),

  unassign: permissionProcedure("organization:admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [assignment] = await ctx.db
        .select()
        .from(agentServiceAssignments)
        .where(eq(agentServiceAssignments.id, input.id))
      if (!assignment) throw new TRPCError({ code: "NOT_FOUND" })
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: assignment.organizationId,
      })
      await ctx.db
        .delete(agentServiceAssignments)
        .where(eq(agentServiceAssignments.id, assignment.id))
      await writeAuditEvent(ctx, {
        organizationId: assignment.organizationId,
        siteId: assignment.siteId,
        deviceId: assignment.deviceId,
        eventType: "agent_service_unassigned",
        eventData: {
          serviceId: assignment.serviceId,
          assignmentId: assignment.id,
        },
      })
      return { id: assignment.id }
    }),
})
