import {
  requestInfoFromHeaders,
  loadAssignedServices,
  syncArchivedDeviceAlerts,
  upsertAssetFromDeviceReport,
} from "@nms/api-contract"
import {
  agentReleases,
  and,
  auditEvents,
  devices,
  eq,
  managementServices,
  organizations,
  sites,
  vpnIdentities,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  CHECK_IN_MAX_BODY_BYTES,
  checkInIssuePaths,
  checkInSchema,
  hasPoisonedKeys,
  hostnamesMatch,
  hubCheckInResponse,
  normalizeHostname,
  requestedDeviceIdFromUnknown,
  resolveAgentDownloadUrl,
  severityForEvent,
  validateReportedModules,
  type AuditEventType,
} from "@nms/shared"

import { ingestDeviceTelemetry } from "@/lib/device-telemetry"
import {
  ingestModuleObservations,
  loadAssignedModules,
} from "@/lib/agent-modules"
import { desiredCheckInRelease, settleDeviceCommands } from "@/lib/agent-fleet"
import { requestOrigin } from "@/lib/request-origin"

import { agentSecretMatches } from "@/lib/agent-secret"
import {
  addressKey,
  enforceRateLimit,
  rateLimitPolicies,
} from "@/lib/rate-limit-server"

/** How long an administrator's permission to rename stays usable. */
const HOSTNAME_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

async function recordCheckInFailure(
  request: Request,
  eventType: Extract<
    AuditEventType,
    | "device_check_in_failed"
    | "device_check_in_secret_mismatch"
    | "device_check_in_hostname_mismatch"
    | "device_module_payload_rejected"
  >,
  args: {
    reason: string
    device?: {
      id: string
      organizationId: string
      siteId: string | null
    } | null
    deviceId?: string | null
    details?: Record<string, unknown>
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
      ...args.details,
    },
  })
}

function renameAllowed(allowedAt: Date | null, now: Date) {
  return (
    allowedAt !== null &&
    now.getTime() - allowedAt.getTime() <= HOSTNAME_CHANGE_WINDOW_MS
  )
}

async function readJson(request: Request) {
  try {
    const raw = await request.text()
    if (raw.length > CHECK_IN_MAX_BODY_BYTES) {
      return { tooLarge: true as const, body: null }
    }
    if (!raw) return { tooLarge: false as const, body: null }
    return { tooLarge: false as const, body: JSON.parse(raw) as unknown }
  } catch {
    return { tooLarge: false as const, body: null }
  }
}

function modulesField(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { present: false, value: undefined as unknown }
  }
  if (!Object.prototype.hasOwnProperty.call(body, "modules")) {
    return { present: false, value: undefined as unknown }
  }
  return {
    present: true,
    value: (body as { modules?: unknown }).modules,
  }
}

export async function POST(request: Request) {
  const addressLimited = await enforceRateLimit(
    `check-in:ip:${addressKey(request.headers)}`,
    rateLimitPolicies.checkInPerAddress
  )
  if (addressLimited) return addressLimited

  const { tooLarge, body } = await readJson(request)
  if (tooLarge) {
    await recordCheckInFailure(request, "device_check_in_failed", {
      reason: "payload_too_large",
    })
    return Response.json({ error: "Invalid check-in payload" }, { status: 400 })
  }
  const modules = modulesField(body)
  if (modules.present && hasPoisonedKeys(modules.value)) {
    const requestedDeviceId = requestedDeviceIdFromUnknown(body)
    const [device] = requestedDeviceId
      ? await db
          .select({
            id: devices.id,
            organizationId: devices.organizationId,
            siteId: devices.siteId,
          })
          .from(devices)
          .where(eq(devices.id, requestedDeviceId))
      : []
    await recordCheckInFailure(request, "device_module_payload_rejected", {
      reason: "poisoned_payload",
      device: device ?? null,
      deviceId: requestedDeviceId,
      details: { detail: "Module payload contains forbidden keys." },
    })
    return Response.json({ error: "Invalid check-in payload" }, { status: 400 })
  }
  const parsed = checkInSchema.safeParse(body)

  if (!parsed.success) {
    const requestedDeviceId = requestedDeviceIdFromUnknown(body)
    const [device] = requestedDeviceId
      ? await db
          .select({
            id: devices.id,
            organizationId: devices.organizationId,
            siteId: devices.siteId,
          })
          .from(devices)
          .where(eq(devices.id, requestedDeviceId))
      : []
    const issues = checkInIssuePaths(parsed.error)
    const moduleIssue = issues.some(
      (path) => path === "modules" || path.startsWith("modules.")
    )
    await recordCheckInFailure(
      request,
      moduleIssue ? "device_module_payload_rejected" : "device_check_in_failed",
      {
        reason: moduleIssue ? "invalid_module_payload" : "invalid_payload",
        device: device ?? null,
        deviceId: requestedDeviceId,
        details: { issues },
      }
    )
    return Response.json({ error: "Invalid check-in payload" }, { status: 400 })
  }

  const input = parsed.data
  const deviceLimited = await enforceRateLimit(
    `check-in:device:${input.device_id}`,
    rateLimitPolicies.checkInPerDevice
  )
  if (deviceLimited) return deviceLimited

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

  if (!agentSecretMatches(input.check_in_secret, device.checkInSecretHash)) {
    await recordCheckInFailure(request, "device_check_in_secret_mismatch", {
      reason: "secret_mismatch",
      device,
    })
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()

  // A device that suddenly reports a different name is either renamed on
  // purpose or someone replaying its secret from another machine. Only an
  // administrator's recent permission distinguishes the two.
  const hostnameChanged =
    device.hostname !== null && !hostnamesMatch(device.hostname, input.hostname)
  const adoptHostname =
    device.hostname === null ||
    (hostnameChanged && renameAllowed(device.hostnameChangeAllowedAt, now))

  if (hostnameChanged && !adoptHostname) {
    await recordCheckInFailure(request, "device_check_in_hostname_mismatch", {
      reason: "hostname_mismatch",
      device,
      details: {
        expectedHostname: device.hostname,
        reportedHostname: normalizeHostname(input.hostname),
      },
    })
    return Response.json(
      {
        error:
          "This device reported a different hostname than the one on record. Ask an administrator to allow the change and check in again.",
        code: "hostname_mismatch",
      },
      { status: 409 }
    )
  }

  const [identity] = await db
    .select()
    .from(vpnIdentities)
    .where(eq(vpnIdentities.deviceId, device.id))

  const serviceReachable = input.services.some((service) => service.listening)
  const status = input.vpn.interface_up
    ? serviceReachable
      ? "service_online"
      : "vpn_online"
    : "offline"

  const [
    [organization],
    siteRows,
    releaseRows,
    assignedModules,
    assignedServices,
  ] = await Promise.all([
    db
      .select({ agentChannel: organizations.agentChannel })
      .from(organizations)
      .where(eq(organizations.id, device.organizationId)),
    device.siteId
      ? db
          .select({ agentChannel: sites.agentChannel })
          .from(sites)
          .where(eq(sites.id, device.siteId))
      : Promise.resolve([] as Array<{ agentChannel: string | null }>),
    db
      .select({
        version: agentReleases.version,
        channel: agentReleases.channel,
        platform: agentReleases.platform,
        downloadUrl: agentReleases.downloadUrl,
        sha256: agentReleases.sha256,
      })
      .from(agentReleases),
    loadAssignedModules(db, device),
    loadAssignedServices(db, device),
  ])

  const moduleDecision = validateReportedModules(assignedModules, input.modules)
  if (!moduleDecision.ok) {
    await recordCheckInFailure(request, "device_module_payload_rejected", {
      reason: moduleDecision.reason,
      device,
      deviceId: device.id,
      details: { detail: moduleDecision.detail },
    })
    return Response.json({ error: "Invalid check-in payload" }, { status: 400 })
  }

  const desired = desiredCheckInRelease({
    releases: releaseRows,
    siteChannel: siteRows[0]?.agentChannel,
    organizationChannel: organization?.agentChannel,
    osFamily: input.os_family,
    architecture: input.architecture ?? device.architecture,
  })
  const downloadUrl = desired
    ? (resolveAgentDownloadUrl(
        requestOrigin(request.headers),
        desired.downloadUrl
      ) ?? undefined)
    : undefined

  const commands = await db.transaction(async (tx: TransactionClient) => {
    await tx
      .update(devices)
      .set({
        ...(adoptHostname
          ? { hostname: input.hostname, hostnameChangeAllowedAt: null }
          : {}),
        osFamily: input.os_family,
        osVersion: input.os_version,
        ...(input.architecture ? { architecture: input.architecture } : {}),
        agentVersion: input.agent_version,
        lastSeenAt: now,
        agentLastCheckInAt: now,
        updatedAt: now,
        status,
      })
      .where(eq(devices.id, input.device_id))

    if (hostnameChanged && adoptHostname) {
      const info = requestInfoFromHeaders(request.headers)
      await tx.insert(auditEvents).values({
        organizationId: device.organizationId,
        siteId: device.siteId,
        deviceId: device.id,
        eventType: "device_hostname_changed",
        severity: severityForEvent("device_hostname_changed"),
        actorIp: info.ipAddress,
        userAgent: info.userAgent,
        eventData: {
          deviceId: device.id,
          previousHostname: device.hostname,
          hostname: input.hostname,
          allowedAt: device.hostnameChangeAllowedAt?.toISOString() ?? null,
        },
      })
    }

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

    await ingestDeviceTelemetry(tx, {
      deviceId: input.device_id,
      now,
      metrics: input.metrics,
      packages: input.packages,
      titles: input.titles,
    })

    await ingestModuleObservations(tx, {
      deviceId: input.device_id,
      now,
      reports: moduleDecision.reports,
      assignedModuleIds: assignedModules.map((assigned) => assigned.id),
      replaceCollectors: input.modules !== undefined,
    })

    await upsertAssetFromDeviceReport(tx, {
      id: device.id,
      organizationId: device.organizationId,
      siteId: device.siteId,
      assetId: device.assetId,
      serialNumber: device.serialNumber,
      hostname: adoptHostname ? input.hostname : device.hostname,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
    })

    return settleDeviceCommands(tx, {
      deviceId: input.device_id,
      organizationId: device.organizationId,
      siteId: device.siteId,
      results: input.command_results,
      now,
    })
  })

  if (device.archivedAt) {
    await syncArchivedDeviceAlerts({
      deviceId: device.id,
      organizationId: device.organizationId,
      siteId: device.siteId,
      displayName: device.displayName || input.hostname || "Device",
      archived: true,
      present: true,
      source: "agent_check_in",
    })
  }

  return Response.json(
    hubCheckInResponse({
      desiredAgentVersion: desired?.version,
      downloadUrl,
      sha256: desired?.sha256,
      commands,
      modules: assignedModules,
      assignedServices,
    })
  )
}
