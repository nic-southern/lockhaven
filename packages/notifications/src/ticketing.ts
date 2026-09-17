import { z } from "zod"

import type { NotificationDeliveryEvent } from "@nms/shared"

import { webhookHeaders } from "./signature"

/** Events the tickets ingest accepts on POST /ingest/lockhaven. */
export const ticketingLockhavenEvents = [
  "alert.opened",
  "alert.resolved",
  "alert.escalated",
  "access.requested",
  "channel.test",
] as const satisfies readonly NotificationDeliveryEvent[]

const ticketingLockhavenEventSet = new Set<string>(ticketingLockhavenEvents)

export function normalizeIngestUrl(url: string) {
  return url.trim().replace(/\/+$/, "")
}

export function ticketingIngestUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = env.TICKETING_INGEST_URL?.trim()
  return raw ? normalizeIngestUrl(raw) : null
}

export function ticketingIngestSecret(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const secret = env.TICKETING_INGEST_SECRET?.trim()
  if (!secret || secret === "replace_me" || secret.length < 8) {
    return null
  }
  return secret
}

export function ticketingIngestBase(url: string) {
  return normalizeIngestUrl(url).replace(/\/lockhaven$/i, "")
}

export function ticketingLockhavenUrl(url: string) {
  const base = ticketingIngestBase(url)
  return `${base}/lockhaven`
}

export function ticketingSessionUrl(url: string) {
  return `${ticketingIngestBase(url)}/session`
}

export function ticketingAssetUrl(url: string) {
  return `${ticketingIngestBase(url)}/asset`
}

export function looksLikeLockhavenIngestUrl(url: string) {
  return /\/ingest\/lockhaven$/i.test(normalizeIngestUrl(url))
}

export function isTicketingIngestUrl(url: string, expected: string | null) {
  const normalized = normalizeIngestUrl(url)
  if (looksLikeLockhavenIngestUrl(normalized)) return true
  if (!expected) return false
  const want = normalizeIngestUrl(expected)
  const wantLockhaven = ticketingLockhavenUrl(want).toLowerCase()
  const wantBase = ticketingIngestBase(want).toLowerCase()
  const have = normalized.toLowerCase()
  return have === wantLockhaven || have === wantBase
}

export function pickTicketingWebhookUrl(
  urls: string[],
  expected: string | null
) {
  const normalized = urls
    .map((url) => normalizeIngestUrl(url))
    .filter((url) => url.length > 0)
  if (expected) {
    const want = normalizeIngestUrl(expected)
    const wantLockhaven = ticketingLockhavenUrl(want).toLowerCase()
    const wantExact = want.toLowerCase()
    const match = normalized.find((url) => {
      const have = url.toLowerCase()
      return have === wantLockhaven || have === wantExact
    })
    if (match) return match
  }
  return normalized.find((url) => looksLikeLockhavenIngestUrl(url)) ?? null
}

export function ticketingIngestAcceptsEvent(event: string) {
  return ticketingLockhavenEventSet.has(event)
}

export const sessionTicketSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  deviceId: z.string().min(1).optional(),
  deviceName: z.string().min(1).optional(),
  siteId: z.string().min(1).optional(),
  siteName: z.string().min(1).optional(),
  technicianName: z.string().trim().min(1),
  technicianEmail: z.string().email(),
  sessionId: z.string().min(1).optional(),
  accessRequestId: z.string().min(1).optional(),
  recordingUrl: z.string().max(2048).optional(),
  reason: z.string().max(4000).optional(),
  serviceType: z.string().max(80).optional(),
  notes: z.string().max(8000).optional(),
})

export const assetTicketSchema = z.object({
  title: z.string().trim().min(1).max(240),
  assetId: z.string().min(1).optional(),
  assetTag: z.string().trim().min(1).max(120),
  siteId: z.string().min(1).optional(),
  siteName: z.string().min(1).optional(),
  requesterName: z.string().trim().min(1),
  requesterEmail: z.string().email(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  category: z
    .enum(["hardware", "software", "network", "access", "account", "other"])
    .optional(),
  notes: z.string().max(8000).optional(),
})

export type SessionTicketInput = z.input<typeof sessionTicketSchema>
export type AssetTicketInput = z.input<typeof assetTicketSchema>

export const ingestAckSchema = z.object({
  ok: z.boolean().optional(),
  ignored: z.boolean().optional(),
  created: z.boolean().optional(),
  reason: z.string().optional(),
  ticket: z
    .object({
      id: z.string().optional(),
      number: z.number().optional(),
    })
    .passthrough()
    .optional(),
})

export type IngestAck = z.infer<typeof ingestAckSchema>

export async function postSignedJson(input: {
  url: string
  secret: string
  payload: unknown
  now?: Date
}): Promise<IngestAck> {
  const body = JSON.stringify(input.payload)
  const signed = webhookHeaders(input.secret, body, input.now)
  const response = await fetch(input.url, {
    method: "POST",
    headers: signed.headers,
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const preview = await response.text()
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}${preview ? `: ${preview.slice(0, 500)}` : ""}`
    )
  }
  if (!preview.trim()) {
    return { ok: true }
  }
  try {
    return ingestAckSchema.parse(JSON.parse(preview))
  } catch {
    return { ok: true }
  }
}

export type AlertTicketContext = {
  siteName?: string | null
  deviceName?: string | null
  hostname?: string | null
  assetId?: string | null
  assetTag?: string | null
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

/**
 * Fills names the tickets ingest reads from alert.detail without overwriting
 * values the worker already set.
 */
export function mergeAlertTicketContext(
  detail: Record<string, unknown>,
  context: AlertTicketContext
): Record<string, unknown> {
  const next = { ...detail }
  if (!stringField(next.siteName) && context.siteName) {
    next.siteName = context.siteName
  }
  if (!stringField(next.site) && context.siteName) {
    next.site = context.siteName
  }
  const deviceName =
    stringField(next.deviceName) ||
    stringField(next.device) ||
    context.deviceName ||
    context.hostname ||
    null
  if (deviceName) {
    next.deviceName = deviceName
  }
  if (!stringField(next.hostname) && context.hostname) {
    next.hostname = context.hostname
  }
  if (!stringField(next.assetId) && context.assetId) {
    next.assetId = context.assetId
  }
  if (!stringField(next.assetTag) && context.assetTag) {
    next.assetTag = context.assetTag
  }
  return next
}
