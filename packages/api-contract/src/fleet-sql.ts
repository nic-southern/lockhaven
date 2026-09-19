import { or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"

import { devices, organizations, sites } from "@nms/db"
import {
  DEFAULT_AGENT_CHANNEL,
  agentChannels,
  agentReleasePlatforms,
  parseSemver,
  pickDesiredRelease,
  type AgentChannel,
  type AgentReleasePick,
  type AgentReleasePlatform,
} from "@nms/shared"

export function resolvedAgentChannelSql() {
  return sql<string>`coalesce(${sites.agentChannel}, ${organizations.agentChannel}, ${DEFAULT_AGENT_CHANNEL})`
}

function cpuArchitectureSql() {
  return sql`case
    when lower(coalesce(${devices.architecture}, '')) in ('amd64', 'x86_64', 'x64') then 'amd64'
    when lower(coalesce(${devices.architecture}, '')) in ('arm64', 'aarch64') then 'arm64'
    else ''
  end`
}

export function agentPlatformSql() {
  return sql<string>`case
    when ${devices.osFamily} ilike ${"%windows%"} and (${cpuArchitectureSql()}) = 'amd64' then 'windows-amd64'
    when ${devices.osFamily} ilike ${"%windows%"} and (${cpuArchitectureSql()}) = 'arm64' then 'windows-arm64'
    when ${devices.osFamily} ilike ${"%windows%"} then 'windows'
    when ${devices.osFamily} ilike ${"%android%"} then 'android'
    when ${devices.osFamily} ilike ${"%mac%"} or ${devices.osFamily} ilike ${"%darwin%"} then 'macos'
    when ${devices.osFamily} ilike ${"%linux%"} and (${cpuArchitectureSql()}) = 'amd64' then 'linux-amd64'
    when ${devices.osFamily} ilike ${"%linux%"} and (${cpuArchitectureSql()}) = 'arm64' then 'linux-arm64'
    when ${devices.osFamily} ilike ${"%linux%"} then 'linux'
    else 'all'
  end`
}

function sqlSemverParts(column: AnyPgColumn | SQL) {
  const cleaned = sql`regexp_replace(split_part(coalesce(${column}::text, '0'), '-', 1), '[^0-9.]', '', 'g')`
  return {
    major: sql`coalesce(nullif(split_part(${cleaned}, '.', 1), '')::int, 0)`,
    minor: sql`coalesce(nullif(split_part(${cleaned}, '.', 2), '')::int, 0)`,
    patch: sql`coalesce(nullif(split_part(${cleaned}, '.', 3), '')::int, 0)`,
  }
}

export function sqlSemverLessThan(column: AnyPgColumn | SQL, version: string) {
  const parsed = parseSemver(version)
  if (!parsed) return sql`false`
  const left = sqlSemverParts(column)
  return sql`(
    ${left.major} < ${parsed.major}
    or (${left.major} = ${parsed.major} and ${left.minor} < ${parsed.minor})
    or (${left.major} = ${parsed.major} and ${left.minor} = ${parsed.minor} and ${left.patch} < ${parsed.patch})
  )`
}

export function deviceBehindSql(releases: AgentReleasePick[]) {
  const clauses: SQL[] = []
  for (const channel of agentChannels) {
    for (const platform of agentReleasePlatforms) {
      const desired = pickDesiredRelease(
        releases,
        channel as AgentChannel,
        platform as AgentReleasePlatform
      )
      if (!desired) continue
      clauses.push(
        sql`(
          ${resolvedAgentChannelSql()} = ${channel}
          and ${agentPlatformSql()} = ${platform}
          and (
            ${devices.agentVersion} is null
            or ${sqlSemverLessThan(devices.agentVersion, desired.version)}
          )
        )`
      )
    }
  }
  if (clauses.length === 0) {
    return sql`false`
  }
  return or(...clauses) ?? sql`false`
}
