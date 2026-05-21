import { createHash } from "node:crypto"

import { and, devices, eq, managementServices, vpnIdentities } from "@nms/db"
import { db } from "@nms/db/client"
import { checkInSchema } from "@nms/shared"

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

function hashDeviceSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}

export async function POST(request: Request) {
  const parsed = checkInSchema.safeParse(await request.json())

  if (!parsed.success) {
    return Response.json({ error: "Invalid check-in payload" }, { status: 400 })
  }

  const input = parsed.data
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, input.device_id))

  if (!device) {
    return Response.json({ error: "Device not found" }, { status: 404 })
  }

  if (!device.checkInSecretHash) {
    return Response.json(
      { error: "Device check-in is not configured" },
      { status: 403 }
    )
  }

  if (hashDeviceSecret(input.check_in_secret) !== device.checkInSecretHash) {
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
        lastSeenAt: now,
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
