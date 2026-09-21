import { TRPCError } from "@trpc/server"
import { and, eq, gt, isNull } from "drizzle-orm"

import { hasPlatformWideAccess } from "@nms/auth"
import { devices, infrastructureAccessGrants } from "@nms/db"
import {
  decideInfrastructureAccess,
  infrastructureAccessDeniedMessage,
  infrastructureAccessExpiresAt,
  liveInfrastructureGrant,
  resolveInfrastructureAccessMinutes,
} from "@nms/shared"

import { requireActor } from "./access"
import { writeAuditEvent, writeAuditEvents } from "./audit"
import type { ApiContext } from "./context"

export async function infrastructureGrantViews(
  ctx: ApiContext,
  deviceId: string
) {
  return ctx.db
    .select({
      id: infrastructureAccessGrants.id,
      requestedByUserId: infrastructureAccessGrants.requestedByUserId,
      status: infrastructureAccessGrants.status,
      expiresAt: infrastructureAccessGrants.expiresAt,
      revokedAt: infrastructureAccessGrants.revokedAt,
      reason: infrastructureAccessGrants.reason,
    })
    .from(infrastructureAccessGrants)
    .where(eq(infrastructureAccessGrants.deviceId, deviceId))
}

export async function setDeviceInfrastructure(
  ctx: ApiContext,
  device: {
    id: string
    organizationId: string
    siteId: string | null
    infrastructure: boolean
  },
  infrastructure: boolean,
  now = new Date()
) {
  const actor = requireActor(ctx.actor)
  const decision = decideInfrastructureAccess({
    action: "classify",
    platformRole: actor.platformRole,
    infrastructure,
    actorId: actor.id,
    now,
  })
  if (!decision.allowed || !hasPlatformWideAccess(actor)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: infrastructureAccessDeniedMessage("not_platform_admin"),
    })
  }

  if (device.infrastructure === infrastructure) {
    return { id: device.id, infrastructure }
  }

  const [record] = await ctx.db
    .update(devices)
    .set({ infrastructure, updatedAt: now })
    .where(eq(devices.id, device.id))
    .returning({
      id: devices.id,
      infrastructure: devices.infrastructure,
    })

  await writeAuditEvent(ctx, {
    eventType: "device_infrastructure_changed",
    organizationId: device.organizationId,
    siteId: device.siteId,
    deviceId: device.id,
    eventData: {
      deviceId: device.id,
      infrastructure,
      previous: device.infrastructure,
    },
  })

  if (!infrastructure) {
    const revoked = await ctx.db
      .update(infrastructureAccessGrants)
      .set({
        status: "revoked",
        revokedAt: now,
        revokedByUserId: actor.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(infrastructureAccessGrants.deviceId, device.id),
          eq(infrastructureAccessGrants.status, "active"),
          isNull(infrastructureAccessGrants.revokedAt)
        )
      )
      .returning({ id: infrastructureAccessGrants.id })

    if (revoked.length > 0) {
      await writeAuditEvent(ctx, {
        eventType: "infrastructure_access_revoked",
        organizationId: device.organizationId,
        siteId: device.siteId,
        deviceId: device.id,
        eventData: {
          deviceId: device.id,
          grantIds: revoked.map((row) => row.id),
          reason: "infrastructure_cleared",
        },
      })
    }
  }

  return record ?? { id: device.id, infrastructure }
}

export async function requestDeviceInfrastructureAccess(
  ctx: ApiContext,
  device: {
    id: string
    organizationId: string
    siteId: string | null
    infrastructure: boolean
  },
  input: { minutes?: number | null; reason?: string | null },
  now = new Date()
) {
  const actor = requireActor(ctx.actor)
  const decision = decideInfrastructureAccess({
    action: "request",
    platformRole: actor.platformRole,
    infrastructure: device.infrastructure,
    actorId: actor.id,
    now,
  })
  if (!decision.allowed || !hasPlatformWideAccess(actor)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: infrastructureAccessDeniedMessage(decision.code),
    })
  }

  const duration = resolveInfrastructureAccessMinutes(input.minutes)
  if (!duration.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: duration.message })
  }

  const reason = input.reason?.trim() || null
  const expiresAt = infrastructureAccessExpiresAt(now, duration.minutes)

  const [created] = await ctx.db
    .insert(infrastructureAccessGrants)
    .values({
      organizationId: device.organizationId,
      deviceId: device.id,
      requestedByUserId: actor.id,
      reason,
      status: "active",
      durationMinutes: duration.minutes,
      expiresAt,
    })
    .returning({
      id: infrastructureAccessGrants.id,
      expiresAt: infrastructureAccessGrants.expiresAt,
      durationMinutes: infrastructureAccessGrants.durationMinutes,
      reason: infrastructureAccessGrants.reason,
    })

  await writeAuditEvents(ctx, [
    {
      eventType: "infrastructure_access_requested",
      organizationId: device.organizationId,
      siteId: device.siteId,
      deviceId: device.id,
      eventData: {
        grantId: created.id,
        deviceId: device.id,
        durationMinutes: duration.minutes,
        expiresAt: expiresAt.toISOString(),
        reason,
      },
    },
    {
      eventType: "infrastructure_access_granted",
      organizationId: device.organizationId,
      siteId: device.siteId,
      deviceId: device.id,
      eventData: {
        grantId: created.id,
        deviceId: device.id,
        durationMinutes: duration.minutes,
        expiresAt: expiresAt.toISOString(),
      },
    },
  ])

  return created
}

export async function revokeDeviceInfrastructureAccess(
  ctx: ApiContext,
  device: {
    id: string
    organizationId: string
    siteId: string | null
    infrastructure: boolean
  },
  now = new Date()
) {
  const actor = requireActor(ctx.actor)
  const decision = decideInfrastructureAccess({
    action: "classify",
    platformRole: actor.platformRole,
    infrastructure: device.infrastructure,
    actorId: actor.id,
    now,
  })
  if (!decision.allowed || !hasPlatformWideAccess(actor)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: infrastructureAccessDeniedMessage("not_platform_admin"),
    })
  }

  const revoked = await ctx.db
    .update(infrastructureAccessGrants)
    .set({
      status: "revoked",
      revokedAt: now,
      revokedByUserId: actor.id,
      updatedAt: now,
    })
    .where(
      and(
        eq(infrastructureAccessGrants.deviceId, device.id),
        eq(infrastructureAccessGrants.requestedByUserId, actor.id),
        eq(infrastructureAccessGrants.status, "active"),
        isNull(infrastructureAccessGrants.revokedAt),
        gt(infrastructureAccessGrants.expiresAt, now)
      )
    )
    .returning({ id: infrastructureAccessGrants.id })

  if (revoked.length > 0) {
    await writeAuditEvent(ctx, {
      eventType: "infrastructure_access_revoked",
      organizationId: device.organizationId,
      siteId: device.siteId,
      deviceId: device.id,
      eventData: {
        deviceId: device.id,
        grantIds: revoked.map((row) => row.id),
      },
    })
  }

  return { revoked: revoked.length }
}

export async function assertInfrastructureSessionAllowed(
  ctx: ApiContext,
  device: { id: string; infrastructure: boolean },
  now = new Date()
) {
  if (!device.infrastructure) {
    return { grantId: null as string | null, reason: null as string | null }
  }

  const actor = requireActor(ctx.actor)
  const grants = await infrastructureGrantViews(ctx, device.id)
  const decision = decideInfrastructureAccess({
    action: "connect",
    platformRole: actor.platformRole,
    infrastructure: true,
    actorId: actor.id,
    grants,
    now,
  })
  if (!decision.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: infrastructureAccessDeniedMessage(decision.code),
    })
  }

  const live = grants.find((grant) => grant.id === decision.grantId)
  return { grantId: decision.grantId, reason: live?.reason ?? null }
}

export async function liveInfrastructureAccessForActor(
  ctx: ApiContext,
  deviceId: string,
  actorId: string,
  now = new Date()
) {
  const grants = await infrastructureGrantViews(ctx, deviceId)
  return liveInfrastructureGrant(grants, actorId, now)
}
