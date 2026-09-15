import { sql } from "drizzle-orm"

import { devices, managementServices, vpnIdentities } from "@nms/db"
import { DEVICE_ONLINE_WINDOW_MS, type DeviceConnectivity } from "@nms/shared"

// Inlined (not bound) so the same expression can appear in SELECT and GROUP BY.
const onlineWindow = sql.raw(
  `interval '${Math.round(DEVICE_ONLINE_WINDOW_MS / 1000)} seconds'`
)

/** SQL twin of `deriveConnectivity`; keep the two in sync. */
export const connectivityExpression = () => sql<DeviceConnectivity>`case
  when ${vpnIdentities.revokedAt} is not null then 'revoked'
  when ${vpnIdentities.lastHandshakeAt} is null then 'never'
  when ${vpnIdentities.lastHandshakeAt} > now() - ${onlineWindow} then 'online'
  else 'offline'
end`

export const enabledServiceTypes = () => sql<string[]>`coalesce((
  select array_agg(distinct ${managementServices.serviceType}::text order by ${managementServices.serviceType}::text)
  from ${managementServices}
  where ${managementServices.deviceId} = ${devices.id}
    and ${managementServices.enabled} = true
), '{}'::text[])`

export const onlineServiceCount = () => sql<number>`(
  select count(*)::int
  from ${managementServices}
  where ${managementServices.deviceId} = ${devices.id}
    and ${managementServices.enabled} = true
    and ${managementServices.healthStatus} = 'online'
)`

export const offlineServiceCount = () => sql<number>`(
  select count(*)::int
  from ${managementServices}
  where ${managementServices.deviceId} = ${devices.id}
    and ${managementServices.enabled} = true
    and ${managementServices.healthStatus} = 'offline'
)`
