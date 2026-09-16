import { TRPCError } from "@trpc/server"
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import { z } from "zod"

import {
  accessRequests,
  devices,
  managementServices,
  sites,
  user,
} from "@nms/db"
import {
  canApproveAccessRequest,
  canDenyAccessRequest,
  effectiveAccessRequestStatus,
  type AccessRequestStatus,
} from "@nms/shared"

import {
  actorOrganizationIds,
  actorSiteIds,
  assertCanApproveAccess,
  canApproveAccess,
  requireActor,
} from "../access"
import { writeAuditEvent } from "../audit"
import {
  buildOrderBy,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
} from "../list"
import { combineConditions } from "../scope"
import { adminProcedure, createTRPCRouter } from "../trpc"

const decideInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "denied"]),
})

function asStatus(value: string): AccessRequestStatus {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "denied" ||
    value === "expired" ||
    value === "consumed"
  ) {
    return value
  }
  return "pending"
}

export const accessRequestsRouter = createTRPCRouter({
  queue: adminProcedure
    .input(listQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const query = resolveListQuery(input, { defaultLimit: 50 })
      const organizationIds = actorOrganizationIds(actor)
      const siteIds = actorSiteIds(actor) ?? []

      if (
        organizationIds !== null &&
        organizationIds.length === 0 &&
        siteIds.length === 0
      ) {
        return paginate([], query, 0)
      }

      const now = new Date()
      await ctx.db
        .update(accessRequests)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            inArray(accessRequests.status, ["pending", "approved"]),
            sql`${accessRequests.expiresAt} <= ${now}`
          )
        )

      const conditions = combineConditions([
        organizationIds === null
          ? undefined
          : organizationIds.length > 0 && siteIds.length > 0
            ? or(
                inArray(accessRequests.organizationId, organizationIds),
                inArray(accessRequests.siteId, siteIds)
              )
            : organizationIds.length > 0
              ? inArray(accessRequests.organizationId, organizationIds)
              : inArray(accessRequests.siteId, siteIds),
        query.filters.status
          ? inArray(accessRequests.status, query.filters.status)
          : eq(accessRequests.status, "pending"),
        query.filters.siteId
          ? inArray(accessRequests.siteId, query.filters.siteId)
          : undefined,
        query.search
          ? or(
              ilike(devices.displayName, likePattern(query.search)),
              ilike(devices.hostname, likePattern(query.search)),
              ilike(user.email, likePattern(query.search)),
              ilike(user.name, likePattern(query.search)),
              ilike(sites.name, likePattern(query.search))
            )
          : undefined,
      ])
      const where = conditions.length > 0 ? and(...conditions) : undefined

      const base = () =>
        ctx.db
          .select({
            id: accessRequests.id,
            organizationId: accessRequests.organizationId,
            siteId: accessRequests.siteId,
            siteName: sites.name,
            deviceId: accessRequests.deviceId,
            deviceName: devices.displayName,
            deviceHostname: devices.hostname,
            serviceId: accessRequests.managementServiceId,
            serviceType: managementServices.serviceType,
            requestedByUserId: accessRequests.requestedByUserId,
            requesterName: user.name,
            requesterEmail: user.email,
            connectionMethod: accessRequests.connectionMethod,
            reason: accessRequests.reason,
            status: accessRequests.status,
            expiresAt: accessRequests.expiresAt,
            createdAt: accessRequests.createdAt,
            decidedAt: accessRequests.decidedAt,
          })
          .from(accessRequests)
          .innerJoin(devices, eq(devices.id, accessRequests.deviceId))
          .innerJoin(sites, eq(sites.id, accessRequests.siteId))
          .leftJoin(
            managementServices,
            eq(managementServices.id, accessRequests.managementServiceId)
          )
          .leftJoin(user, eq(user.id, accessRequests.requestedByUserId))

      const [[totalRow], rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(accessRequests)
          .innerJoin(devices, eq(devices.id, accessRequests.deviceId))
          .innerJoin(sites, eq(sites.id, accessRequests.siteId))
          .leftJoin(user, eq(user.id, accessRequests.requestedByUserId))
          .where(where),
        base()
          .where(where)
          .orderBy(
            ...buildOrderBy(
              query.sort,
              {
                createdAt: accessRequests.createdAt,
                expiresAt: accessRequests.expiresAt,
                deviceName: devices.displayName,
                status: accessRequests.status,
              },
              [desc(accessRequests.createdAt), desc(accessRequests.id)]
            )
          )
          .limit(query.limit + 1)
          .offset(query.offset),
      ])

      const items = rows.filter((row) =>
        canApproveAccess(actor, row.organizationId, row.siteId)
      )

      return paginate(items, query, Number(totalRow?.total ?? 0))
    }),

  mine: adminProcedure
    .input(
      z
        .object({
          deviceId: z.string().uuid().optional(),
          serviceId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const now = new Date()
      await ctx.db
        .update(accessRequests)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(accessRequests.requestedByUserId, actor.id),
            inArray(accessRequests.status, ["pending", "approved"]),
            sql`${accessRequests.expiresAt} <= ${now}`
          )
        )

      const conditions = combineConditions([
        eq(accessRequests.requestedByUserId, actor.id),
        inArray(accessRequests.status, ["pending", "approved", "denied"]),
        input?.deviceId
          ? eq(accessRequests.deviceId, input.deviceId)
          : undefined,
        input?.serviceId
          ? eq(accessRequests.managementServiceId, input.serviceId)
          : undefined,
      ])

      const rows = await ctx.db
        .select({
          id: accessRequests.id,
          organizationId: accessRequests.organizationId,
          siteId: accessRequests.siteId,
          siteName: sites.name,
          deviceId: accessRequests.deviceId,
          deviceName: devices.displayName,
          serviceId: accessRequests.managementServiceId,
          serviceType: managementServices.serviceType,
          connectionMethod: accessRequests.connectionMethod,
          reason: accessRequests.reason,
          status: accessRequests.status,
          expiresAt: accessRequests.expiresAt,
          createdAt: accessRequests.createdAt,
          decidedAt: accessRequests.decidedAt,
        })
        .from(accessRequests)
        .innerJoin(devices, eq(devices.id, accessRequests.deviceId))
        .innerJoin(sites, eq(sites.id, accessRequests.siteId))
        .leftJoin(
          managementServices,
          eq(managementServices.id, accessRequests.managementServiceId)
        )
        .where(and(...conditions))
        .orderBy(desc(accessRequests.createdAt))
        .limit(20)

      return rows.map((row) => ({
        ...row,
        status: effectiveAccessRequestStatus(
          asStatus(row.status),
          row.expiresAt,
          now
        ),
      }))
    }),

  decide: adminProcedure.input(decideInput).mutation(async ({ ctx, input }) => {
    const actor = requireActor(ctx.actor)
    const now = new Date()

    const [row] = await ctx.db
      .select({
        request: accessRequests,
        deviceName: devices.displayName,
      })
      .from(accessRequests)
      .innerJoin(devices, eq(devices.id, accessRequests.deviceId))
      .where(eq(accessRequests.id, input.id))

    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND" })
    }

    assertCanApproveAccess(
      actor,
      row.request.organizationId,
      row.request.siteId
    )

    const current = effectiveAccessRequestStatus(
      asStatus(row.request.status),
      row.request.expiresAt,
      now
    )
    if (current === "expired" && row.request.status !== "expired") {
      await ctx.db
        .update(accessRequests)
        .set({ status: "expired", updatedAt: now })
        .where(eq(accessRequests.id, row.request.id))
    }

    if (input.decision === "approved") {
      if (!canApproveAccessRequest(current, row.request.expiresAt, now)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This request can no longer be approved.",
        })
      }
    } else if (!canDenyAccessRequest(current, row.request.expiresAt, now)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This request can no longer be declined.",
      })
    }

    const [updated] = await ctx.db
      .update(accessRequests)
      .set({
        status: input.decision,
        decidedByUserId: actor.id,
        decidedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(accessRequests.id, row.request.id),
          eq(accessRequests.status, "pending")
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
      eventType:
        input.decision === "approved"
          ? "access_request_approved"
          : "access_request_denied",
      organizationId: updated.organizationId,
      siteId: updated.siteId,
      deviceId: updated.deviceId,
      eventData: {
        accessRequestId: updated.id,
        requesterUserId: updated.requestedByUserId,
        reason: updated.reason,
        deviceName: row.deviceName,
      },
    })

    return updated
  }),
})
