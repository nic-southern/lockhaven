import { open, stat } from "node:fs/promises"

import type Redis from "ioredis"

import {
  adminVpnProfiles,
  connectionDaily,
  connectionEvents,
  devices,
  eq,
  sql,
  vpnIdentities,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  FLOW_RETENTION_DAYS_DEFAULT,
  FLOW_ROLLUP_RETENTION_DAYS_DEFAULT,
} from "@nms/shared"
import {
  normalizeVpnIpv4,
  parseFlowLine,
  splitCompleteLines,
  type FlowRecord,
} from "@nms/vpn"

import { alertKeys, raiseAlert } from "./alerts"

const CURSOR_KEY = "lockhaven:worker:flow-cursor"

/** Upper bound on bytes consumed per run so one job never monopolises the worker. */
const MAX_BYTES_PER_RUN = 8 * 1024 * 1024
const INSERT_BATCH_SIZE = 500

export const flowLogPath =
  process.env.FLOW_LOG_PATH ?? "/var/log/lockhaven/flows.jsonl"

export function flowRetentionDays() {
  return positiveInt(
    process.env.FLOW_RETENTION_DAYS,
    FLOW_RETENTION_DAYS_DEFAULT
  )
}

export function flowRollupRetentionDays() {
  return positiveInt(
    process.env.FLOW_ROLLUP_RETENTION_DAYS,
    FLOW_ROLLUP_RETENTION_DAYS_DEFAULT
  )
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

type FlowCursor = {
  inode: number
  offset: number
  /** Trailing partial line carried into the next read. */
  rest: string
}

/**
 * Remembers how far into the log file the worker has read. Rotation
 * (`copytruncate`) shows up as a shrinking file or a new inode, either of
 * which resets the cursor to the start.
 */
export class FlowCursorStore {
  constructor(private readonly redis: Redis) {}

  async load(): Promise<FlowCursor | null> {
    const raw = await this.redis.get(CURSOR_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<FlowCursor>
      if (
        typeof parsed.inode !== "number" ||
        typeof parsed.offset !== "number"
      ) {
        return null
      }
      return {
        inode: parsed.inode,
        offset: parsed.offset,
        rest: typeof parsed.rest === "string" ? parsed.rest : "",
      }
    } catch {
      return null
    }
  }

  async save(cursor: FlowCursor) {
    await this.redis.set(CURSOR_KEY, JSON.stringify(cursor))
  }
}

type PeerSubject =
  | {
      kind: "device"
      deviceId: string
      organizationId: string
      siteId: string | null
      displayName: string
    }
  | { kind: "admin"; adminProfileId: string; organizationId: string }

/** Maps tunnel addresses to the device or admin profile that owns them. */
export async function loadPeerSubjects() {
  const subjects = new Map<string, PeerSubject>()

  const identities = await db
    .select({
      vpnIpv4: vpnIdentities.vpnIpv4,
      deviceId: vpnIdentities.deviceId,
      organizationId: devices.organizationId,
      siteId: devices.siteId,
      displayName: devices.displayName,
      hostname: devices.hostname,
    })
    .from(vpnIdentities)
    .innerJoin(devices, eq(devices.id, vpnIdentities.deviceId))

  for (const identity of identities) {
    subjects.set(normalizeVpnIpv4(String(identity.vpnIpv4)), {
      kind: "device",
      deviceId: identity.deviceId,
      organizationId: identity.organizationId,
      siteId: identity.siteId,
      displayName: identity.displayName || identity.hostname || "Device",
    })
  }

  const profiles = await db
    .select({
      id: adminVpnProfiles.id,
      vpnIpv4: adminVpnProfiles.vpnIpv4,
      organizationId: adminVpnProfiles.organizationId,
    })
    .from(adminVpnProfiles)

  for (const profile of profiles) {
    subjects.set(normalizeVpnIpv4(String(profile.vpnIpv4)), {
      kind: "admin",
      adminProfileId: profile.id,
      organizationId: profile.organizationId,
    })
  }

  return subjects
}

let warnedMissingLog = false

async function readNewBytes(cursor: FlowCursor | null) {
  let info
  try {
    info = await stat(flowLogPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!warnedMissingLog) {
        console.warn("flow log not present; skipping ingest", {
          path: flowLogPath,
        })
        warnedMissingLog = true
      }
      return null
    }
    throw error
  }
  warnedMissingLog = false

  const inode = Number(info.ino)
  let offset = cursor?.offset ?? 0
  let rest = cursor?.rest ?? ""
  if (!cursor || cursor.inode !== inode || info.size < offset) {
    offset = 0
    rest = ""
  }

  const available = info.size - offset
  if (available <= 0) {
    return { inode, offset, rest, text: "", bytesRead: 0 }
  }

  const length = Math.min(available, MAX_BYTES_PER_RUN)
  const handle = await open(flowLogPath, "r")
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return {
      inode,
      offset,
      rest,
      text: rest + buffer.subarray(0, bytesRead).toString("utf8"),
      bytesRead,
    }
  } finally {
    await handle.close()
  }
}

type ConnectionEventInsert = typeof connectionEvents.$inferInsert

function toInsert(
  record: FlowRecord,
  subject: PeerSubject | undefined
): ConnectionEventInsert {
  return {
    occurredAt: record.occurredAt,
    organizationId: subject?.organizationId ?? null,
    siteId: subject?.kind === "device" ? subject.siteId : null,
    deviceId: subject?.kind === "device" ? subject.deviceId : null,
    adminProfileId: subject?.kind === "admin" ? subject.adminProfileId : null,
    direction: record.direction,
    verdict: record.verdict,
    protocol: record.protocol,
    srcIp: record.srcIp,
    dstIp: record.dstIp,
    dstPort: record.dstPort,
    bytes: record.bytes,
  }
}

/**
 * Tails the ulogd2 JSON log, attributes each new connection to a peer, and
 * stores it. Dropped attempts to reach the concentrator itself open a
 * `concentrator_probe` alert for the device.
 */
export async function ingestFlows(store: FlowCursorStore) {
  const cursor = await store.load()
  const chunk = await readNewBytes(cursor)
  if (!chunk) return { lines: 0, inserted: 0, skipped: 0 }

  const { lines, rest } = splitCompleteLines(chunk.text)
  if (lines.length === 0) {
    if (chunk.bytesRead > 0 || cursor?.inode !== chunk.inode) {
      await store.save({
        inode: chunk.inode,
        offset: chunk.offset + chunk.bytesRead,
        rest,
      })
    }
    return { lines: 0, inserted: 0, skipped: 0 }
  }

  const subjects = await loadPeerSubjects()
  const rows: ConnectionEventInsert[] = []
  const probes = new Map<
    string,
    { subject: Extract<PeerSubject, { kind: "device" }>; ports: Set<string> }
  >()
  let skipped = 0

  for (const line of lines) {
    const record = parseFlowLine(line)
    if (!record) {
      if (line.trim() !== "") skipped += 1
      continue
    }
    const subject = subjects.get(record.srcIp)
    rows.push(toInsert(record, subject))

    if (
      record.direction === "hub" &&
      record.verdict === "drop" &&
      subject?.kind === "device"
    ) {
      const entry = probes.get(subject.deviceId) ?? {
        subject,
        ports: new Set<string>(),
      }
      entry.ports.add(
        record.dstPort === null
          ? record.protocol
          : `${record.protocol}/${record.dstPort}`
      )
      probes.set(subject.deviceId, entry)
    }
  }

  for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
    await db
      .insert(connectionEvents)
      .values(rows.slice(index, index + INSERT_BATCH_SIZE))
  }

  for (const { subject, ports } of probes.values()) {
    await raiseAlert({
      kind: "concentrator_probe",
      dedupeKey: alertKeys.concentratorProbe(subject.deviceId),
      organizationId: subject.organizationId,
      siteId: subject.siteId,
      deviceId: subject.deviceId,
      title: `${subject.displayName} tried to reach the hub on a blocked port`,
      detail: {
        device: subject.displayName,
        targets: [...ports].sort().slice(0, 20),
      },
    })
  }

  await store.save({
    inode: chunk.inode,
    offset: chunk.offset + chunk.bytesRead,
    rest,
  })

  return { lines: lines.length, inserted: rows.length, skipped }
}

/**
 * Recomputes the daily rollup for recent days from raw events. Rebuilding
 * whole days keeps the job idempotent, so a crash mid-run never double
 * counts.
 */
export async function rollupConnections(now = new Date(), days = 2) {
  const since = new Date(now)
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - (days - 1))

  await db.execute(sql`
    insert into ${connectionDaily} (
      day, subject_key, organization_id, site_id, device_id, admin_profile_id,
      direction, verdict, protocol, dst_ip, dst_port,
      connections, bytes, first_seen_at, last_seen_at, updated_at
    )
    select
      date_trunc('day', occurred_at at time zone 'UTC') at time zone 'UTC' as day,
      coalesce('device:' || device_id::text, 'admin:' || admin_profile_id::text, 'ip:' || host(src_ip)) as subject_key,
      max(organization_id::text)::uuid,
      max(site_id::text)::uuid,
      device_id,
      admin_profile_id,
      direction,
      verdict,
      protocol,
      dst_ip,
      coalesce(dst_port, 0),
      count(*)::int,
      coalesce(sum(bytes), 0)::bigint,
      min(occurred_at),
      max(occurred_at),
      now()
    from ${connectionEvents}
    where occurred_at >= ${since}
    group by 1, 2, device_id, admin_profile_id, direction, verdict, protocol, dst_ip, coalesce(dst_port, 0)
    on conflict (day, subject_key, direction, verdict, protocol, dst_ip, dst_port)
    do update set
      organization_id = excluded.organization_id,
      site_id = excluded.site_id,
      connections = excluded.connections,
      bytes = excluded.bytes,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      updated_at = now()
  `)
}

export async function pruneConnectionHistory(now = new Date()) {
  const rawCutoff = new Date(
    now.getTime() - flowRetentionDays() * 24 * 60 * 60 * 1000
  )
  const rollupCutoff = new Date(
    now.getTime() - flowRollupRetentionDays() * 24 * 60 * 60 * 1000
  )
  await db
    .delete(connectionEvents)
    .where(sql`${connectionEvents.occurredAt} < ${rawCutoff}`)
  await db
    .delete(connectionDaily)
    .where(sql`${connectionDaily.day} < ${rollupCutoff}`)
}
