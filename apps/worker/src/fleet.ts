import { eq } from "drizzle-orm"

import { agentReleases, devices, organizations, sites } from "@nms/db"
import { db } from "@nms/db/client"
import {
  isAgentBehind,
  normalizeAgentPlatform,
  pickDesiredRelease,
  resolveAgentChannel,
  type AgentChannel,
} from "@nms/shared"

import { alertKeys, raiseAlert, resolveAlert } from "./alerts"

/**
 * Raise or clear the condition alert when a device's agent is behind the
 * latest published release for its channel.
 */
export async function evaluateAgentVersions() {
  const [deviceRows, releaseRows] = await Promise.all([
    db
      .select({
        id: devices.id,
        organizationId: devices.organizationId,
        siteId: devices.siteId,
        displayName: devices.displayName,
        agentVersion: devices.agentVersion,
        osFamily: devices.osFamily,
        architecture: devices.architecture,
        status: devices.status,
        archivedAt: devices.archivedAt,
        organizationChannel: organizations.agentChannel,
        siteChannel: sites.agentChannel,
      })
      .from(devices)
      .innerJoin(organizations, eq(organizations.id, devices.organizationId))
      .leftJoin(sites, eq(sites.id, devices.siteId)),
    db
      .select({
        version: agentReleases.version,
        channel: agentReleases.channel,
        platform: agentReleases.platform,
        downloadUrl: agentReleases.downloadUrl,
      })
      .from(agentReleases),
  ])

  for (const device of deviceRows) {
    const key = alertKeys.agentOutdated(device.id)
    if (
      device.status === "revoked" ||
      device.status === "pending" ||
      device.archivedAt
    ) {
      await resolveAlert(key, {
        reason: device.archivedAt ? "archived" : "not_enrolled",
      })
      continue
    }

    if (!device.agentVersion) {
      await resolveAlert(key, { reason: "unknown_version" })
      continue
    }

    const channel = resolveAgentChannel(
      device.siteChannel,
      device.organizationChannel
    ) as AgentChannel
    const desired = pickDesiredRelease(
      releaseRows,
      channel,
      normalizeAgentPlatform(device.osFamily, device.architecture)
    )

    if (!desired || !isAgentBehind(device.agentVersion, desired.version)) {
      await resolveAlert(key, {
        reason: desired ? "current" : "no_release",
        currentVersion: device.agentVersion,
        desiredVersion: desired?.version ?? null,
      })
      continue
    }

    await raiseAlert({
      kind: "agent_outdated",
      dedupeKey: key,
      organizationId: device.organizationId,
      siteId: device.siteId,
      deviceId: device.id,
      mode: "condition",
      title: "Agent outdated",
      detail: {
        deviceName: device.displayName,
        currentVersion: device.agentVersion,
        desiredVersion: desired.version,
        channel,
      },
    })
  }
}
