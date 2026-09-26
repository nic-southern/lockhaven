import { requestInfoFromHeaders } from "@nms/api-contract"
import { auditEvents } from "@nms/db"
import { db } from "@nms/db/client"
import {
  agentAttachRequestSchema,
  agentAttachResponseSchema,
  severityForEvent,
} from "@nms/shared"

import {
  bindAgentToDevice,
  clientVpnSettings,
  issueCheckInSecret,
  loadAttachCandidates,
  loadEnrollmentToken,
  matchForToken,
  recordAgentAttachEvent,
} from "@/lib/agent-attach"
import { upsertAssetFromDeviceReport } from "@nms/api-contract"
import {
  addressKey,
  enforceRateLimit,
  rateLimitPolicies,
} from "@/lib/rate-limit-server"

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

async function readJson(request: Request) {
  try {
    return (await request.json()) as unknown
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(
    `enroll:ip:${addressKey(request.headers)}`,
    rateLimitPolicies.enrollPerAddress,
    "Too many enrollment attempts from this address. Try again in a minute."
  )
  if (limited) return limited

  const parsed = agentAttachRequestSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return Response.json({ error: "Invalid attach request" }, { status: 400 })
  }

  const input = parsed.data
  const info = requestInfoFromHeaders(request.headers)
  const { checkInSecret, checkInSecretHash } = issueCheckInSecret()

  type AttachFailure =
    | "token_not_found"
    | "token_exhausted"
    | "token_expired"
    | "not_found"
    | "ambiguous"
    | "out_of_scope"
    | "revoked"
    | "hostname_conflict"
    | "tunnel_missing"
    | "vpn_unconfigured"

  let failure: AttachFailure | null = null
  let failureScope: {
    organizationId?: string | null
    siteId?: string | null
    tokenId?: string | null
  } = {}

  const result = await db.transaction(async (tx: TransactionClient) => {
    const tokenResult = await loadEnrollmentToken(tx, input.token)
    if (!tokenResult.ok) {
      failure = tokenResult.reason
      failureScope = {
        organizationId: tokenResult.token?.organizationId,
        siteId: tokenResult.token?.siteId,
        tokenId: tokenResult.token?.id,
      }
      return null
    }

    const token = tokenResult.token
    failureScope = {
      organizationId: token.organizationId,
      siteId: token.siteId,
      tokenId: token.id,
    }

    const wireguard = clientVpnSettings([])
    if (!wireguard) {
      failure = "vpn_unconfigured"
      return null
    }

    const identity = {
      hostname: input.hostname,
      serialNumber: input.serial_number,
      deviceId: input.device_id,
      wireguardPublicKey: input.wireguard_public_key,
    }
    const candidates = await loadAttachCandidates(
      tx,
      token.organizationId,
      identity,
      token.siteId
    )
    const match = matchForToken(candidates, identity, token)
    if (!match.ok) {
      failure = match.reason
      return null
    }

    const bound = await bindAgentToDevice(tx, {
      deviceId: match.deviceId,
      identity,
      osFamily: input.os_family,
      osVersion: input.os_version,
      architecture: input.architecture,
      checkInSecretHash,
    })
    if (!bound?.identity) {
      failure = "tunnel_missing"
      return null
    }

    await upsertAssetFromDeviceReport(tx, {
      id: bound.device.id,
      organizationId: bound.device.organizationId,
      siteId: bound.device.siteId,
      assetId: bound.device.assetId,
      serialNumber: bound.device.serialNumber ?? input.serial_number,
      hostname: bound.device.hostname ?? input.hostname,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
    })

    const settings = clientVpnSettings(bound.routePolicyRoutes) ?? wireguard

    await recordAgentAttachEvent(tx, {
      organizationId: token.organizationId,
      siteId: token.siteId,
      deviceId: bound.device.id,
      actorIp: info.ipAddress,
      userAgent: info.userAgent,
      eventData: {
        tokenId: token.id,
        match: match.reason,
        hostname: input.hostname,
      },
    })

    return {
      deviceId: bound.device.id,
      vpnIpv4: bound.identity.vpnIpv4,
      wireguard: settings,
    }
  })

  if (!result) {
    await db.insert(auditEvents).values({
      organizationId: failureScope.organizationId ?? null,
      siteId: failureScope.siteId ?? null,
      eventType: "device_agent_attach_failed",
      severity: severityForEvent("device_agent_attach_failed"),
      actorIp: info.ipAddress,
      userAgent: info.userAgent,
      eventData: {
        reason: failure,
        tokenId: failureScope.tokenId ?? null,
        hostname: input.hostname,
      },
    })

    if (failure === "vpn_unconfigured") {
      return Response.json(
        { error: "VPN server key is not configured" },
        { status: 500 }
      )
    }

    if (
      failure === "token_not_found" ||
      failure === "token_exhausted" ||
      failure === "token_expired"
    ) {
      return Response.json(
        { error: "Enrollment token not found" },
        { status: 404 }
      )
    }

    const status =
      failure === "ambiguous" ||
      failure === "hostname_conflict" ||
      failure === "revoked"
        ? 409
        : 404
    return Response.json(
      {
        error:
          failure === "ambiguous"
            ? "More than one listed device matches this host."
            : failure === "hostname_conflict"
              ? "This hostname is already used by a different device."
              : failure === "revoked"
                ? "This device can no longer accept an agent."
                : "No listed device matches this host.",
        code: failure ?? "not_found",
      },
      { status }
    )
  }

  return Response.json(
    agentAttachResponseSchema.parse({
      device_id: result.deviceId,
      vpn_ipv4: result.vpnIpv4,
      check_in_secret: checkInSecret,
      attached: true,
      tunnel_ready: true,
      wireguard: result.wireguard,
      ssh: null,
    })
  )
}
