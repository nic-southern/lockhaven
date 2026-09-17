import {
  buildWebhookEnvelope,
  serializeWebhookBody,
  type TicketNotificationSnapshot,
} from "./payload"
import { webhookHeaders } from "./signature"

export type SignedWebhookFetch = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
  }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export type TicketIngestResult = {
  created: boolean
  ticketId: string | null
  ticketNumber: string | null
  ticketsUrl: string | null
  preview: string
}

/** Public tickets ingest URL shown as a webhook placeholder. Not a secret. */
export function suggestedTicketsIngestUrl() {
  const value = process.env.TICKETS_INGEST_URL?.trim()
  return value && value.length > 0 ? value : null
}

/**
 * Lockhaven webhook channels point at `/ingest/lockhaven`. Device tickets use
 * the sibling `/ingest/session` path on the same host. Other destinations keep
 * the configured URL and receive the versioned envelope.
 */
export function sessionIngestUrlFromWebhook(url: string) {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, "")
    if (path.endsWith("/ingest/lockhaven")) {
      parsed.pathname = `${path.slice(0, -"/lockhaven".length)}/session`
      parsed.search = ""
      parsed.hash = ""
      return parsed.toString()
    }
    return null
  } catch {
    return null
  }
}

export function originFromUrl(url: string) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function sessionIngestBody(ticket: TicketNotificationSnapshot) {
  const body: Record<string, string> = {
    title: ticket.title,
    technicianName: ticket.technicianName,
    technicianEmail: ticket.technicianEmail,
  }
  if (ticket.deviceId) body.deviceId = ticket.deviceId
  if (ticket.deviceName) body.deviceName = ticket.deviceName
  if (ticket.siteId) body.siteId = ticket.siteId
  if (ticket.siteName) body.siteName = ticket.siteName
  if (ticket.sessionId) body.sessionId = ticket.sessionId
  if (ticket.accessRequestId) body.accessRequestId = ticket.accessRequestId
  if (ticket.recordingUrl) body.recordingUrl = ticket.recordingUrl
  if (ticket.reason) body.reason = ticket.reason
  if (ticket.serviceType) body.serviceType = ticket.serviceType
  if (ticket.notes) body.notes = ticket.notes
  return body
}

export function parseTicketIngestResponse(
  preview: string,
  sourceUrl: string
): TicketIngestResult {
  let created = true
  let ticketId: string | null = null
  let ticketNumber: string | null = null
  try {
    const parsed = JSON.parse(preview) as {
      created?: unknown
      ticket?: { id?: unknown; number?: unknown }
    }
    if (parsed.created === false) created = false
    if (typeof parsed.ticket?.id === "string" && parsed.ticket.id.length > 0) {
      ticketId = parsed.ticket.id
    }
    if (typeof parsed.ticket?.number === "number") {
      ticketNumber = `T-${String(parsed.ticket.number).padStart(4, "0")}`
    }
  } catch {
    created = true
  }
  return {
    created,
    ticketId,
    ticketNumber,
    ticketsUrl: originFromUrl(sourceUrl),
    preview,
  }
}

export async function postSignedWebhook(input: {
  url: string
  secret: string
  body: string
  now?: Date
  fetchImpl?: SignedWebhookFetch
}): Promise<{ status: number; preview: string }> {
  const signed = webhookHeaders(input.secret, input.body, input.now)
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl(input.url, {
    method: "POST",
    headers: signed.headers,
    body: input.body,
    signal: AbortSignal.timeout(15_000),
  })
  const preview = await response.text().then((text) => text.slice(0, 500))
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${preview ? `: ${preview}` : ""}`)
  }
  return { status: response.status, preview }
}

export async function deliverTicketOpened(input: {
  url: string
  secret: string
  ticket: TicketNotificationSnapshot
  now?: Date
  fetchImpl?: SignedWebhookFetch
}): Promise<{ lastResponse: string; result: TicketIngestResult }> {
  const sessionUrl = sessionIngestUrlFromWebhook(input.url)
  const body = sessionUrl
    ? JSON.stringify(sessionIngestBody(input.ticket))
    : serializeWebhookBody(
        buildWebhookEnvelope({
          event: "ticket.opened",
          ticket: input.ticket,
          occurredAt: input.now,
        })
      )
  const targetUrl = sessionUrl ?? input.url
  const posted = await postSignedWebhook({
    url: targetUrl,
    secret: input.secret,
    body,
    now: input.now,
    fetchImpl: input.fetchImpl,
  })
  return {
    lastResponse: `HTTP ${posted.status}`,
    result: parseTicketIngestResponse(posted.preview, targetUrl),
  }
}
