import { createHash, randomBytes } from "node:crypto"

import {
  auditEvents,
  devices,
  enrollmentTokens,
  eq,
  managementServices,
  organizations,
  routePolicies,
  vpnIdentities,
} from "@nms/db"
import { db } from "@nms/db/client"
import { enrollmentRequestSchema, enrollmentResponseSchema } from "@nms/shared"
import { allocateVpnIpv4, buildClientAllowedIps } from "@nms/vpn"

const env = {
  vpnServerPublicKey: process.env.VPN_SERVER_PUBLIC_KEY,
  vpnPublicHostname: process.env.VPN_PUBLIC_HOSTNAME ?? "vpn.example.com",
  vpnPublicPort: Number(process.env.VPN_PUBLIC_PORT ?? 51820),
  vpnServerIp: process.env.VPN_SERVER_IP ?? "10.80.0.1",
}

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

function hashEnrollmentToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function hashDeviceSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}

export async function POST(request: Request) {
  const parsed = enrollmentRequestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid enrollment request" },
      { status: 400 }
    )
  }

  const input = parsed.data
  const tokenHash = hashEnrollmentToken(input.token)
  const checkInSecret = randomBytes(32).toString("base64url")
  const checkInSecretHash = hashDeviceSecret(checkInSecret)

  if (!env.vpnServerPublicKey) {
    return Response.json(
      { error: "VPN server key is not configured" },
      { status: 500 }
    )
  }

  const result = await db.transaction(async (tx: TransactionClient) => {
    const [token] = await tx
      .select()
      .from(enrollmentTokens)
      .where(eq(enrollmentTokens.tokenHash, tokenHash))

    if (
      !token ||
      (!token.siteWide && token.uses >= token.maxUses) ||
      (token.expiresAt !== null && token.expiresAt.getTime() <= Date.now())
    ) {
      return null
    }

    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, token.organizationId))

    if (!organization) {
      return null
    }

    const existingIps = (
      await tx.select({ vpnIpv4: vpnIdentities.vpnIpv4 }).from(vpnIdentities)
    ).map((row: { vpnIpv4: string }) => row.vpnIpv4)
    const routePolicyRoutes = token.routePolicyId
      ? ((
          await tx
            .select({ routes: routePolicies.routes })
            .from(routePolicies)
            .where(eq(routePolicies.id, token.routePolicyId))
        )[0]?.routes ?? [])
      : []

    const vpnIpv4 = allocateVpnIpv4(existingIps, input.os_family)
    const [device] = await tx
      .insert(devices)
      .values({
        organizationId: token.organizationId,
        siteId: token.siteId ?? null,
        hostname: input.hostname,
        displayName: input.hostname,
        osFamily: input.os_family,
        osVersion: input.os_version,
        architecture: input.architecture,
        serialNumber: input.serial_number,
        checkInSecretHash,
        status: "enrolled",
      })
      .returning()

    const [identity] = await tx
      .insert(vpnIdentities)
      .values({
        deviceId: device.id,
        vpnIpv4,
        wireguardPublicKey: input.wireguard_public_key,
        routePolicyId: token.routePolicyId,
      })
      .returning()

    for (const service of input.services) {
      await tx.insert(managementServices).values({
        deviceId: device.id,
        serviceType: service.type,
        protocol: service.protocol,
        port: service.port,
      })
    }

    await tx
      .update(enrollmentTokens)
      .set({ uses: token.uses + 1 })
      .where(eq(enrollmentTokens.id, token.id))

    await tx.insert(auditEvents).values({
      organizationId: token.organizationId,
      deviceId: device.id,
      eventType: "device_enrolled",
      eventData: {
        vpnIpv4,
        serviceCount: input.services.length,
        organization: organization.name,
      },
    })

    return { device, identity, routePolicyRoutes }
  })

  if (!result) {
    return Response.json(
      { error: "Enrollment token not found" },
      { status: 404 }
    )
  }

  const response = enrollmentResponseSchema.parse({
    device_id: result.device.id,
    vpn_ipv4: result.identity.vpnIpv4,
    check_in_secret: checkInSecret,
    wireguard: {
      server_public_key: env.vpnServerPublicKey,
      endpoint: `${env.vpnPublicHostname}:${env.vpnPublicPort}`,
      allowed_ips: buildClientAllowedIps({
        serverIp: env.vpnServerIp,
        routePolicyRoutes: result.routePolicyRoutes,
      }),
      persistent_keepalive: 25,
    },
  })

  return Response.json(response)
}
