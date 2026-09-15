import { createHash, timingSafeEqual } from "node:crypto"

import { requestInfoFromHeaders } from "@nms/api-contract"
import {
  and,
  auditEvents,
  devices,
  eq,
  managementServices,
  vpnIdentities,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  checkInSchema,
  severityForEvent,
  type AuditEventType,
} from "@nms/shared"

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

function hashDeviceSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}

/** Compares hex digests without leaking where they first differ. */
function secretMatches(provided: string, expectedHash: string) {
  const providedHash = Buffer.from(hashDeviceSecret(provided), "hex")
  const expected = Buffer.from(expectedHash, "hex")
  if (providedHash.length !== expected.length) return false
  return timingSafeEqual(providedHash, expected)
}

async function recordCheckInFailure(
  request: Request,
  eventType: Extract<
    AuditEventType,
    "device_check_in_failed" | "device_check_in_secret_mismatch"
  >,
  args: {
    reason: string
    device?: {
      id: string
      organizationId: string
      siteId: string | null
    } | null
    deviceId?: string | null
  }
) {
  const info = requestInfoFromHeaders(request.headers)
  await db.insert(auditEvents).values({
    organizationId: args.device?.organizationId ?? null,
    siteId: args.device?.siteId ?? null,
    deviceId: args.device?.id ?? null,
    eventType,
    severity: severityForEvent(eventType),
    actorIp: info.ipAddress,
    userAgent: info.userAgent,
    eventData: {
      reason: args.reason,
      requestedDeviceId: args.deviceId ?? args.device?.id ?? null,
    },
  })
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as unknown
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const parsed = checkInSchema.safeParse(await readJson(request))

  if (!parsed.success) {
    await recordCheckInFailure(request, "device_check_in_failed", {
      reason: "invalid_payload",
    })
    return Response.json({ error: "Invalid check-in payload" }, { status: 400 })
  }

  const input = parsed.data
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, input.device_id))

  if (!device) {
    await recordCheckInFailure(request, "device_check_in_failed", {
      reason: "device_not_found",
      deviceId: input.device_id,
    })
    return Response.json({ error: "Device not found" }, { status: 404 })
  }

  if (!device.checkInSecretHash) {
    await recordCheckInFailure(request, "device_check_in_failed", {
      reason: "check_in_not_configured",
      device,
    })
    return Response.json(
      { error: "Device check-in is not configured" },
      { status: 403 }
    )
  }

  if (!secretMatches(input.check_in_secret, device.checkInSecretHash)) {
    await recordCheckInFailure(request, "device_check_in_secret_mismatch", {
      reason: "secret_mismatch",
      device,
    })
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [identity] = await db
    .select()
    .from(vpnIdentities)
    .where(eq(vpnIdentities.deviceId, device.id))

  const now = new Date()
  const serviceReachable = input.services.some((service) => service.listening)
  const status = input.vpn.interface_up
    ? serviceReachable
      ? "service_online"
      : "vpn_online"
    : "offline"

  await db.transaction(async (tx: TransactionClient) => {
    await tx
      .update(devices)
      .set({
        hostname: input.hostname,
        osFamily: input.os_family,
        osVersion: input.os_version,
        agentVersion: input.agent_version,
        lastSeenAt: now,
        updatedAt: now,
        status,
      })
      .where(eq(devices.id, input.device_id))

    if (identity) {
      await tx
        .update(vpnIdentities)
        .set({
          lastHandshakeAt: input.vpn.interface_up
            ? now
            : identity.lastHandshakeAt,
          latestEndpoint: input.vpn.vpn_ipv4,
        })
        .where(eq(vpnIdentities.deviceId, input.device_id))
    }

    for (const service of input.services) {
      await tx
        .update(managementServices)
        .set({
          healthStatus: service.listening ? "online" : "offline",
          lastCheckedAt: now,
        })
        .where(
          and(
            eq(managementServices.deviceId, input.device_id),
            eq(managementServices.serviceType, service.type)
          )
        )
    }
  })

  return Response.json({ ok: true })
}
