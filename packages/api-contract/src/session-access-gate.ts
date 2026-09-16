import { TRPCError } from "@trpc/server"
import { and, desc, eq, inArray } from "drizzle-orm"

import { accessRequests, sites } from "@nms/db"
import {
  ACCESS_REQUEST_TTL_HOURS_DEFAULT,
  accessRequestExpiresAt,
  canLaunchWithAccessRequest,
  effectiveAccessRequestStatus,
  resolveSiteAccessSettings,
  validateAccessReason,
  type AccessRequestStatus,
} from "@nms/shared"

import { enqueueAccessRequestNotifications } from "./access-request-notify"
import { writeAuditEvent } from "./audit"
import type { ApiContext } from "./context"
import { requireActor } from "./access"

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

export type SessionAccessGate =
  | {
      kind: "proceed"
      reason: string | null
      accessRequestId: string | null
    }
  | {
      kind: "pending"
      request: typeof accessRequests.$inferSelect
    }

export async function resolveSessionAccessGate(
  ctx: ApiContext,
  input: {
    deviceId: string
    organizationId: string
    siteId: string | null
    serviceId: string
    serviceType: string
    connectionMethod: string
    reason?: string
    accessRequestId?: string
    deviceName: string
  }
): Promise<SessionAccessGate> {
  const actor = requireActor(ctx.actor)
  const now = new Date()

  let site: typeof sites.$inferSelect | null = null
  if (input.siteId) {
    const [row] = await ctx.db
      .select()
      .from(sites)
      .where(eq(sites.id, input.siteId))
    site = row ?? null
  }

  const settings = resolveSiteAccessSettings(site)
  const reasonResult = validateAccessReason(
    settings.requireAccessReason,
    input.reason
  )
  if (!reasonResult.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: reasonResult.message,
    })
  }

  if (!settings.requireApproval) {
    return {
      kind: "proceed",
      reason: reasonResult.reason,
      accessRequestId: null,
    }
  }

  if (!input.siteId || !site) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Assign this device to a site before requesting access.",
    })
  }

  const hours = Number(process.env.ACCESS_REQUEST_TTL_HOURS)
  const expiresAt = accessRequestExpiresAt(
    now,
    Number.isFinite(hours) && hours > 0
      ? hours
      : ACCESS_REQUEST_TTL_HOURS_DEFAULT
  )

  if (input.accessRequestId) {
    const [existing] = await ctx.db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, input.accessRequestId))
    if (
      existing &&
      canLaunchWithAccessRequest({
        status: asStatus(existing.status),
        expiresAt: existing.expiresAt,
        now,
        requestedByUserId: existing.requestedByUserId,
        actorId: actor.id,
      }) &&
      existing.deviceId === input.deviceId &&
      existing.managementServiceId === input.serviceId
    ) {
      return {
        kind: "proceed",
        reason: existing.reason ?? reasonResult.reason,
        accessRequestId: existing.id,
      }
    }
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This access request cannot be used to start a session.",
    })
  }

  const [reusable] = await ctx.db
    .select()
    .from(accessRequests)
    .where(
      and(
        eq(accessRequests.requestedByUserId, actor.id),
        eq(accessRequests.deviceId, input.deviceId),
        eq(accessRequests.managementServiceId, input.serviceId),
        inArray(accessRequests.status, ["pending", "approved"])
      )
    )
    .orderBy(desc(accessRequests.createdAt))
    .limit(1)

  if (reusable) {
    const status = effectiveAccessRequestStatus(
      asStatus(reusable.status),
      reusable.expiresAt,
      now
    )
    if (status === "expired") {
      await ctx.db
        .update(accessRequests)
        .set({ status: "expired", updatedAt: now })
        .where(eq(accessRequests.id, reusable.id))
    } else if (
      canLaunchWithAccessRequest({
        status,
        expiresAt: reusable.expiresAt,
        now,
        requestedByUserId: reusable.requestedByUserId,
        actorId: actor.id,
      })
    ) {
      return {
        kind: "proceed",
        reason: reusable.reason ?? reasonResult.reason,
        accessRequestId: reusable.id,
      }
    } else if (status === "pending") {
      return { kind: "pending", request: reusable }
    }
  }

  const [created] = await ctx.db
    .insert(accessRequests)
    .values({
      organizationId: input.organizationId,
      siteId: input.siteId,
      deviceId: input.deviceId,
      managementServiceId: input.serviceId,
      requestedByUserId: actor.id,
      connectionMethod: input.connectionMethod,
      reason: reasonResult.reason,
      status: "pending",
      expiresAt,
    })
    .returning()

  await writeAuditEvent(ctx, {
    eventType: "access_request_created",
    organizationId: input.organizationId,
    siteId: input.siteId,
    deviceId: input.deviceId,
    eventData: {
      accessRequestId: created.id,
      serviceId: input.serviceId,
      serviceType: input.serviceType,
      reason: reasonResult.reason,
    },
  })

  await enqueueAccessRequestNotifications(ctx.db, {
    id: created.id,
    organizationId: input.organizationId,
    siteId: input.siteId,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    siteName: site.name,
    requesterName: actor.name ?? actor.email,
    requesterEmail: actor.email,
    reason: reasonResult.reason,
    serviceType: input.serviceType,
    expiresAt: created.expiresAt.toISOString(),
  })

  return { kind: "pending", request: created }
}

export async function consumeAccessRequest(
  ctx: ApiContext,
  accessRequestId: string | null,
  remoteSessionId: string
) {
  if (!accessRequestId) return
  const now = new Date()
  await ctx.db
    .update(accessRequests)
    .set({
      status: "consumed",
      remoteSessionId,
      updatedAt: now,
    })
    .where(eq(accessRequests.id, accessRequestId))
}
