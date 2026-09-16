import { TRPCError } from "@trpc/server"
import { and, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import { devices, managementServices, remoteSessions } from "@nms/db"
import { BROWSER_CONNECTION_METHOD } from "@nms/shared"

import { assertAuthorized, requireActor } from "../access"
import { writeAuditEvent } from "../audit"
import { permissionForServiceType, type RemoteServiceType } from "../helpers"
import { getRemoteAccessProvider } from "../remote-session-provider"
import { permissionProcedure } from "../trpc"

const GATEWAY_SESSION_ID_KEY = `${BROWSER_CONNECTION_METHOD}SessionId`

const terminateInput = z.object({
  sessionId: z.string().uuid(),
})

function endPermission(serviceType: string | null) {
  if (
    serviceType === "vnc" ||
    serviceType === "rdp" ||
    serviceType === "ssh" ||
    serviceType === "winrm_https"
  ) {
    return permissionForServiceType(serviceType as RemoteServiceType)
  }
  return "device:update" as const
}

export const sessionsTerminate = permissionProcedure("device:view")
  .input(terminateInput)
  .mutation(async ({ ctx, input }) => {
    const actor = requireActor(ctx.actor)

    const [row] = await ctx.db
      .select({
        session: remoteSessions,
        organizationId: devices.organizationId,
        siteId: devices.siteId,
        serviceType: managementServices.serviceType,
      })
      .from(remoteSessions)
      .innerJoin(devices, eq(devices.id, remoteSessions.deviceId))
      .leftJoin(
        managementServices,
        eq(managementServices.id, remoteSessions.managementServiceId)
      )
      .where(eq(remoteSessions.id, input.sessionId))

    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND" })
    }

    const permission = endPermission(row.serviceType)
    if (row.serviceType) {
      assertAuthorized(actor, permission, {
        kind: "service",
        organizationId: row.organizationId,
        siteId: row.siteId,
        deviceId: row.session.deviceId,
        serviceId: row.session.managementServiceId,
        serviceType: row.serviceType,
      })
    } else {
      assertAuthorized(actor, permission, {
        kind: "device",
        organizationId: row.organizationId,
        siteId: row.siteId,
      })
    }

    if (row.session.endedAt) {
      return {
        id: row.session.id,
        endedAt: row.session.endedAt,
        alreadyEnded: true,
      }
    }

    const gatewaySessionId = row.session.auditMetadata[GATEWAY_SESSION_ID_KEY]
    if (
      row.session.connectionMethod === BROWSER_CONNECTION_METHOD &&
      typeof gatewaySessionId === "string"
    ) {
      await getRemoteAccessProvider().closeSession(gatewaySessionId)
    }

    const now = new Date()
    const metadataPatch = {
      endReason: "terminated",
      terminatedBy: actor.id,
    }

    const updated = await ctx.db.transaction(async (tx) => {
      const [ended] = await tx
        .update(remoteSessions)
        .set({
          status: "ended",
          endedAt: now,
          auditMetadata: sql`${remoteSessions.auditMetadata} || ${JSON.stringify(metadataPatch)}::jsonb`,
        })
        .where(
          and(
            eq(remoteSessions.id, row.session.id),
            isNull(remoteSessions.endedAt)
          )
        )
        .returning({
          id: remoteSessions.id,
          endedAt: remoteSessions.endedAt,
        })

      if (!ended) {
        return null
      }

      await writeAuditEvent(
        { db: tx, actor: ctx.actor, request: ctx.request },
        {
          eventType: "remote_session_terminated",
          organizationId: row.organizationId,
          siteId: row.siteId,
          deviceId: row.session.deviceId,
          eventData: {
            remoteSessionId: row.session.id,
            serviceId: row.session.managementServiceId,
            serviceType: row.serviceType ?? null,
            connectionMethod: row.session.connectionMethod,
            reason: "terminated",
          },
        }
      )

      return ended
    })

    if (!updated) {
      const [current] = await ctx.db
        .select({
          id: remoteSessions.id,
          endedAt: remoteSessions.endedAt,
        })
        .from(remoteSessions)
        .where(eq(remoteSessions.id, row.session.id))
      return {
        id: current?.id ?? row.session.id,
        endedAt: current?.endedAt ?? now,
        alreadyEnded: true,
      }
    }

    return { id: updated.id, endedAt: updated.endedAt, alreadyEnded: false }
  })
