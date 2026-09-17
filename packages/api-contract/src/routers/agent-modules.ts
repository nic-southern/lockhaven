import { randomUUID } from "node:crypto"

import { TRPCError } from "@trpc/server"
import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import {
  agentModuleAssignments,
  agentModules,
  deviceModuleObservations,
  devices,
  sites,
} from "@nms/db"
import {
  agentCollectorTypeLabels,
  agentModuleAssignSchema,
  agentModuleCreateSchema,
  agentModuleKindLabels,
  agentModuleUpdateSchema,
  hubModuleDefinitionSchema,
  type AgentModuleCollector,
  type AgentModuleCollectorDraft,
} from "@nms/shared"

import { actorOrganizationIds, assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { combineConditions } from "../scope"
import { createTRPCRouter, permissionProcedure } from "../trpc"

function withCollectorIds(
  collectors: AgentModuleCollectorDraft[]
): AgentModuleCollector[] {
  return collectors.map((collector) => ({
    ...collector,
    id: randomUUID(),
  }))
}

function publicModule(row: typeof agentModules.$inferSelect) {
  const parsed = hubModuleDefinitionSchema.safeParse({
    id: row.id,
    kind: row.kind,
    name: row.name,
    collectors: row.collectors,
  })
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    kind: row.kind,
    kindLabel: agentModuleKindLabels[row.kind],
    collectors: parsed.success ? parsed.data.collectors : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function loadModule(ctx: ApiContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(agentModules)
    .where(eq(agentModules.id, id))
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
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

export const agentModulesRouter = createTRPCRouter({
  list: permissionProcedure("device:view")
    .input(
      z
        .object({
          organizationId: z.string().uuid().optional(),
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
          : inArray(agentModules.organizationId, organizationIds),
        input?.organizationId
          ? eq(agentModules.organizationId, input.organizationId)
          : undefined,
      ])

      const rows = await ctx.db
        .select()
        .from(agentModules)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(agentModules.name)

      const assignments = rows.length
        ? await ctx.db
            .select({
              id: agentModuleAssignments.id,
              moduleId: agentModuleAssignments.moduleId,
              organizationId: agentModuleAssignments.organizationId,
              siteId: agentModuleAssignments.siteId,
              deviceId: agentModuleAssignments.deviceId,
              siteName: sites.name,
              deviceName: devices.displayName,
            })
            .from(agentModuleAssignments)
            .leftJoin(sites, eq(sites.id, agentModuleAssignments.siteId))
            .leftJoin(devices, eq(devices.id, agentModuleAssignments.deviceId))
            .where(
              inArray(
                agentModuleAssignments.moduleId,
                rows.map((row) => row.id)
              )
            )
        : []

      const assignmentsByModule = new Map<string, typeof assignments>()
      for (const assignment of assignments) {
        const list = assignmentsByModule.get(assignment.moduleId) ?? []
        list.push(assignment)
        assignmentsByModule.set(assignment.moduleId, list)
      }

      return rows.map((row) => ({
        ...publicModule(row),
        assignments: (assignmentsByModule.get(row.id) ?? []).map(
          (assignment) => ({
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
          })
        ),
      }))
    }),

  create: permissionProcedure("organization:admin")
    .input(agentModuleCreateSchema)
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      const collectors = withCollectorIds(input.collectors)
      const [record] = await ctx.db
        .insert(agentModules)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          kind: input.kind,
          collectors,
          createdByUserId: ctx.actor?.id ?? null,
          updatedAt: new Date(),
        })
        .returning()
      await writeAuditEvent(ctx, {
        organizationId: record.organizationId,
        eventType: "agent_module_created",
        eventData: {
          moduleId: record.id,
          name: record.name,
          kind: record.kind,
        },
      })
      return publicModule(record)
    }),

  update: permissionProcedure("organization:admin")
    .input(agentModuleUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadModule(ctx, input.id)
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      const collectors = withCollectorIds(input.collectors)
      const [record] = await ctx.db
        .update(agentModules)
        .set({
          name: input.name,
          collectors,
          updatedAt: new Date(),
        })
        .where(eq(agentModules.id, existing.id))
        .returning()
      await writeAuditEvent(ctx, {
        organizationId: existing.organizationId,
        eventType: "agent_module_updated",
        eventData: {
          moduleId: record.id,
          name: record.name,
        },
      })
      return publicModule(record)
    }),

  delete: permissionProcedure("organization:admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadModule(ctx, input.id)
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      await ctx.db.delete(agentModules).where(eq(agentModules.id, existing.id))
      await writeAuditEvent(ctx, {
        organizationId: existing.organizationId,
        eventType: "agent_module_deleted",
        eventData: {
          moduleId: existing.id,
          name: existing.name,
        },
      })
      return { id: existing.id }
    }),

  assign: permissionProcedure("organization:admin")
    .input(agentModuleAssignSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadModule(ctx, input.moduleId)
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
          .insert(agentModuleAssignments)
          .values({
            moduleId: existing.id,
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
          eventType: "agent_module_assigned",
          eventData: {
            moduleId: existing.id,
            assignmentId: record.id,
            siteId: record.siteId,
            deviceId: record.deviceId,
          },
        })
        return record
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That module is already assigned there.",
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
        .from(agentModuleAssignments)
        .where(eq(agentModuleAssignments.id, input.id))
      if (!assignment) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: assignment.organizationId,
      })
      await ctx.db
        .delete(agentModuleAssignments)
        .where(eq(agentModuleAssignments.id, assignment.id))
      await writeAuditEvent(ctx, {
        organizationId: assignment.organizationId,
        siteId: assignment.siteId,
        deviceId: assignment.deviceId,
        eventType: "agent_module_unassigned",
        eventData: {
          moduleId: assignment.moduleId,
          assignmentId: assignment.id,
        },
      })
      return { id: assignment.id }
    }),

  observations: permissionProcedure("device:view")
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
      if (!device) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })

      const rows = await ctx.db
        .select({
          id: deviceModuleObservations.id,
          moduleId: deviceModuleObservations.moduleId,
          moduleName: agentModules.name,
          collectorId: deviceModuleObservations.collectorId,
          collectorType: deviceModuleObservations.collectorType,
          payload: deviceModuleObservations.payload,
          lastSeenAt: deviceModuleObservations.lastSeenAt,
        })
        .from(deviceModuleObservations)
        .innerJoin(
          agentModules,
          eq(agentModules.id, deviceModuleObservations.moduleId)
        )
        .where(eq(deviceModuleObservations.deviceId, input.deviceId))
        .orderBy(desc(deviceModuleObservations.lastSeenAt))

      return rows.map((row) => ({
        ...row,
        collectorTypeLabel:
          agentCollectorTypeLabels[
            row.collectorType as keyof typeof agentCollectorTypeLabels
          ] ?? row.collectorType,
      }))
    }),
})
