import { and, devices, eq, isNull, remoteSessions, sql } from "@nms/db"
import { db } from "@nms/db/client"
import {
  GuacamoleRemoteAccessProvider,
  guacamoleConfigSchema,
  type RemoteAccessProvider,
  type RemoteAccessSessionActivity,
} from "@nms/remote-access"
import { BROWSER_CONNECTION_METHOD } from "@nms/shared"

import { recordEvent } from "./audit"

/** A browser session that never connects is closed after this long. */
export const SESSION_LAUNCH_WINDOW_MS = 15 * 60 * 1000

/**
 * Native launches hand credentials to a local client the hub cannot observe,
 * so their records close after the launch window with that noted.
 */
export const NATIVE_SESSION_WINDOW_MS = 15 * 60 * 1000

const GATEWAY_SESSION_ID_KEY = `${BROWSER_CONNECTION_METHOD}SessionId`

let cachedProvider: RemoteAccessProvider | null | undefined

function gatewayProvider(): RemoteAccessProvider | null {
  if (cachedProvider !== undefined) return cachedProvider
  const databaseUrl = process.env.GUACAMOLE_DATABASE_URL
  if (!databaseUrl) {
    cachedProvider = null
    return cachedProvider
  }
  cachedProvider = new GuacamoleRemoteAccessProvider(
    guacamoleConfigSchema.parse({
      baseUrl: process.env.GUACAMOLE_BASE_URL ?? "http://127.0.0.1:8080/",
      databaseUrl,
    })
  )
  return cachedProvider
}

type OpenSession = {
  id: string
  deviceId: string
  adminUserId: string
  managementServiceId: string
  status: string
  connectionMethod: string
  startedAt: Date
  auditMetadata: Record<string, unknown>
  organizationId: string
  siteId: string | null
}

async function loadOpenSessions(): Promise<OpenSession[]> {
  return db
    .select({
      id: remoteSessions.id,
      deviceId: remoteSessions.deviceId,
      adminUserId: remoteSessions.adminUserId,
      managementServiceId: remoteSessions.managementServiceId,
      status: remoteSessions.status,
      connectionMethod: remoteSessions.connectionMethod,
      startedAt: remoteSessions.startedAt,
      auditMetadata: remoteSessions.auditMetadata,
      organizationId: devices.organizationId,
      siteId: devices.siteId,
    })
    .from(remoteSessions)
    .innerJoin(devices, eq(devices.id, remoteSessions.deviceId))
    .where(isNull(remoteSessions.endedAt))
}

async function endSession(
  session: OpenSession,
  args: {
    status: string
    endedAt: Date
    reason: string
    connectedAt?: Date | null
    observed: boolean
  }
) {
  const durationSeconds = args.connectedAt
    ? Math.max(
        0,
        Math.round((args.endedAt.getTime() - args.connectedAt.getTime()) / 1000)
      )
    : null

  const metadataPatch = {
    endReason: args.reason,
    connectedAt: args.connectedAt?.toISOString() ?? null,
    durationSeconds,
  }

  await db
    .update(remoteSessions)
    .set({
      status: args.status,
      endedAt: args.endedAt,
      auditMetadata: sql`${remoteSessions.auditMetadata} || ${JSON.stringify(metadataPatch)}::jsonb`,
    })
    .where(
      and(eq(remoteSessions.id, session.id), isNull(remoteSessions.endedAt))
    )

  await recordEvent({
    eventType: "remote_session_ended",
    actorUserId: session.adminUserId,
    organizationId: session.organizationId,
    siteId: session.siteId,
    deviceId: session.deviceId,
    eventData: {
      remoteSessionId: session.id,
      serviceId: session.managementServiceId,
      serviceType: session.auditMetadata.serviceType ?? null,
      connectionMethod: session.connectionMethod,
      reason: args.reason,
      observed: args.observed,
      durationSeconds,
    },
  })
}

async function markConnected(session: OpenSession, connectedAt: Date) {
  await db
    .update(remoteSessions)
    .set({
      status: "active",
      auditMetadata: sql`${remoteSessions.auditMetadata} || ${JSON.stringify({ connectedAt: connectedAt.toISOString() })}::jsonb`,
    })
    .where(eq(remoteSessions.id, session.id))
}

/**
 * Reconciles open session records against the gateway's connection history
 * so the Console shows real start/end times instead of "starting" forever.
 */
export async function refreshRemoteSessions(now = new Date()) {
  const open = await loadOpenSessions()
  if (open.length === 0) return { checked: 0, ended: 0 }

  const gatewaySessions = open.filter(
    (session) =>
      session.connectionMethod === BROWSER_CONNECTION_METHOD &&
      typeof session.auditMetadata[GATEWAY_SESSION_ID_KEY] === "string"
  )
  const provider = gatewayProvider()
  let activity = new Map<string, RemoteAccessSessionActivity>()
  let gatewayReachable = false

  if (provider && gatewaySessions.length > 0) {
    try {
      activity = await provider.getSessionActivity(
        gatewaySessions.map(
          (session) => session.auditMetadata[GATEWAY_SESSION_ID_KEY] as string
        )
      )
      gatewayReachable = true
    } catch (error) {
      console.error("session activity lookup failed", error)
    }
  }

  let ended = 0

  for (const session of open) {
    const ageMs = now.getTime() - session.startedAt.getTime()

    if (session.connectionMethod !== BROWSER_CONNECTION_METHOD) {
      if (ageMs >= NATIVE_SESSION_WINDOW_MS) {
        await endSession(session, {
          status: "closed",
          endedAt: now,
          reason: "launch_window_elapsed",
          connectedAt: null,
          observed: false,
        })
        ended += 1
      }
      continue
    }

    const gatewayId = session.auditMetadata[GATEWAY_SESSION_ID_KEY]
    const record =
      typeof gatewayId === "string" ? activity.get(gatewayId) : undefined

    if (!gatewayReachable) {
      // Without the gateway we can only expire records that never started.
      if (
        !record &&
        ageMs >= SESSION_LAUNCH_WINDOW_MS &&
        session.status === "starting"
      ) {
        await endSession(session, {
          status: "expired",
          endedAt: now,
          reason: "never_connected",
          connectedAt: null,
          observed: false,
        })
        ended += 1
      }
      continue
    }

    if (record?.active) {
      if (session.status !== "active" && record.connectedAt) {
        await markConnected(session, record.connectedAt)
      }
      continue
    }

    if (record?.connectedAt && record.disconnectedAt) {
      await endSession(session, {
        status: "ended",
        endedAt: record.disconnectedAt,
        reason: "disconnected",
        connectedAt: record.connectedAt,
        observed: true,
      })
      ended += 1
      continue
    }

    if (ageMs >= SESSION_LAUNCH_WINDOW_MS) {
      await endSession(session, {
        status: "expired",
        endedAt: now,
        reason: "never_connected",
        connectedAt: null,
        observed: true,
      })
      ended += 1
    }
  }

  return { checked: open.length, ended }
}
