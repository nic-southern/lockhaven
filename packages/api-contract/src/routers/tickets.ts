import { TRPCError } from "@trpc/server"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import {
  alerts,
  devices,
  notificationChannels,
  notificationDeliveries,
  remoteSessions,
  sites,
  type NotificationChannel,
} from "@nms/db"
import {
  buildWebhookEnvelope,
  channelMatchesSite,
  deliverTicketOpened,
  parseTicketIngestResponse,
  postSignedWebhook,
  serializeWebhookBody,
  suggestedTicketsIngestUrl,
  webhookChannelConfigSchema,
  type TicketIngestResult,
  type TicketNotificationSnapshot,
} from "@nms/notifications"
import { decryptSecret } from "@nms/remote-access"

import { assertAuthorized, requireActor } from "../access"
import { asAlertSnapshot } from "../alert-deliveries"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { createTRPCRouter, permissionProcedure } from "../trpc"

function getCredentialSecret() {
  const secret = process.env.REMOTE_CREDENTIALS_KEY
  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing remote credential secret",
    })
  }
  return secret
}

function appBaseUrl() {
  return (
    process.env.APP_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  )
}

function webhookDestination(channel: NotificationChannel) {
  const config = webhookChannelConfigSchema.parse(channel.config)
  return {
    type: "webhook" as const,
    url: config.url,
    secret: decryptSecret(config.secret, getCredentialSecret()),
  }
}

function technicianFromActor(actor: { name: string | null; email: string }) {
  const email = actor.email.trim()
  if (!email.includes("@")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Your account needs an email address before you can open a ticket.",
    })
  }
  return {
    technicianName: actor.name?.trim() || email,
    technicianEmail: email,
  }
}

async function loadEnabledWebhookChannels(
  ctx: ApiContext,
  organizationId: string,
  siteId: string | null
) {
  const channels = await ctx.db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.organizationId, organizationId),
        eq(notificationChannels.enabled, true),
        eq(notificationChannels.type, "webhook")
      )
    )
  return channels.filter((channel) =>
    channelMatchesSite({ siteIds: channel.siteIds ?? [] }, siteId)
  )
}

async function recordDelivery(
  ctx: ApiContext,
  input: {
    channel: NotificationChannel
    event: "ticket.opened" | "alert.opened"
    alertId?: string | null
    payload: Record<string, unknown>
    status: "sent" | "failed"
    lastResponse: string
    now: Date
  }
) {
  await ctx.db.insert(notificationDeliveries).values({
    channelId: input.channel.id,
    organizationId: input.channel.organizationId,
    alertId: input.alertId ?? null,
    event: input.event,
    status: input.status,
    attempts: 1,
    nextAttemptAt: input.now,
    lastResponse: input.lastResponse,
    payload: input.payload,
    createdAt: input.now,
    updatedAt: input.now,
    sentAt: input.status === "sent" ? input.now : null,
  })
}

function summarizeResults(results: TicketIngestResult[]) {
  const first = results[0]
  if (!first) {
    return {
      opened: false as const,
      created: false,
      ticketNumber: null as string | null,
      ticketsUrl: null as string | null,
    }
  }
  return {
    opened: true as const,
    created: results.some((result) => result.created),
    ticketNumber: first.ticketNumber,
    ticketsUrl: first.ticketsUrl,
  }
}

async function latestDeviceSession(ctx: ApiContext, deviceId: string) {
  const [session] = await ctx.db
    .select({
      id: remoteSessions.id,
      reason: remoteSessions.reason,
      recordingPath: remoteSessions.recordingPath,
    })
    .from(remoteSessions)
    .where(eq(remoteSessions.deviceId, deviceId))
    .orderBy(desc(remoteSessions.startedAt))
    .limit(1)
  if (!session) return null
  return {
    id: session.id,
    reason: session.reason,
    recordingUrl: session.recordingPath
      ? new URL(
          `/api/sessions/${session.id}/recording/play`,
          appBaseUrl()
        ).toString()
      : null,
  }
}

export const ticketsRouter = createTRPCRouter({
  suggestedIngestUrl: permissionProcedure("device:view").query(() => ({
    url: suggestedTicketsIngestUrl(),
  })),

  openOnDevice: permissionProcedure("device:view")
    .input(
      z.object({
        deviceId: z.string().uuid(),
        title: z.string().trim().min(1).max(240).optional(),
        notes: z.string().trim().max(8000).optional(),
        includeLastSession: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const [device] = await ctx.db
        .select({
          id: devices.id,
          displayName: devices.displayName,
          organizationId: devices.organizationId,
          siteId: devices.siteId,
          siteName: sites.name,
        })
        .from(devices)
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .where(eq(devices.id, input.deviceId))

      if (!device) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      assertAuthorized(actor, "device:view", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })

      const channels = await loadEnabledWebhookChannels(
        ctx,
        device.organizationId,
        device.siteId
      )
      if (channels.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Tickets aren't set up yet. An administrator can add a webhook channel in Notifications.",
        })
      }

      const technician = technicianFromActor(actor)
      const session =
        input.includeLastSession === false
          ? null
          : await latestDeviceSession(ctx, device.id)
      const notes = input.notes?.trim() || null
      const reason = notes || session?.reason || null
      const ticket: TicketNotificationSnapshot = {
        title: input.title?.trim() || `Work on ${device.displayName}`,
        deviceId: device.id,
        deviceName: device.displayName,
        siteId: device.siteId,
        siteName: device.siteName,
        technicianName: technician.technicianName,
        technicianEmail: technician.technicianEmail,
        sessionId: session?.id ?? null,
        accessRequestId: null,
        recordingUrl: session?.recordingUrl ?? null,
        reason,
        notes,
        serviceType: null,
      }

      const now = new Date()
      const successes: TicketIngestResult[] = []

      for (const channel of channels) {
        const destination = webhookDestination(channel)
        try {
          const delivered = await deliverTicketOpened({
            url: destination.url,
            secret: destination.secret,
            ticket,
            now,
          })
          await recordDelivery(ctx, {
            channel,
            event: "ticket.opened",
            payload: { event: "ticket.opened", ticket },
            status: "sent",
            lastResponse: delivered.lastResponse,
            now,
          })
          successes.push(delivered.result)
        } catch (error) {
          const lastResponse =
            error instanceof Error
              ? error.message.slice(0, 1000)
              : String(error)
          await recordDelivery(ctx, {
            channel,
            event: "ticket.opened",
            payload: { event: "ticket.opened", ticket },
            status: "failed",
            lastResponse,
            now,
          })
        }
      }

      if (successes.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "We couldn't open a ticket. Check the webhook channel and try again.",
        })
      }

      const summary = summarizeResults(successes)
      await writeAuditEvent(ctx, {
        eventType: "ticket_opened",
        organizationId: device.organizationId,
        siteId: device.siteId,
        deviceId: device.id,
        eventData: {
          source: "device",
          title: ticket.title,
          ticketNumber: summary.ticketNumber,
          sessionId: ticket.sessionId,
        },
      })

      return summary
    }),

  openFromAlert: permissionProcedure("device:view")
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const [alert] = await ctx.db
        .select()
        .from(alerts)
        .where(eq(alerts.id, input.alertId))

      if (!alert) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      if (!alert.organizationId) {
        assertAuthorized(actor, "device:view", { kind: "platform" })
      } else {
        assertAuthorized(actor, "device:view", {
          kind: "device",
          organizationId: alert.organizationId,
          siteId: alert.siteId,
        })
      }

      if (!alert.organizationId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This alert isn't tied to an organization.",
        })
      }

      const channels = await loadEnabledWebhookChannels(
        ctx,
        alert.organizationId,
        alert.siteId
      )
      if (channels.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Tickets aren't set up yet. An administrator can add a webhook channel in Notifications.",
        })
      }

      const snapshot = await asAlertSnapshot(ctx.db, alert)
      const now = new Date()
      const envelopeBody = serializeWebhookBody(
        buildWebhookEnvelope({
          event: "alert.opened",
          alert: snapshot,
          occurredAt: now,
        })
      )
      const successes: TicketIngestResult[] = []

      for (const channel of channels) {
        const destination = webhookDestination(channel)
        try {
          const posted = await postSignedWebhook({
            url: destination.url,
            secret: destination.secret,
            body: envelopeBody,
            now,
          })
          await recordDelivery(ctx, {
            channel,
            event: "alert.opened",
            alertId: alert.id,
            payload: { event: "alert.opened", alert: snapshot },
            status: "sent",
            lastResponse: `HTTP ${posted.status}`,
            now,
          })
          successes.push(
            parseTicketIngestResponse(posted.preview, destination.url)
          )
        } catch (error) {
          const lastError =
            error instanceof Error
              ? error.message.slice(0, 1000)
              : String(error)
          await recordDelivery(ctx, {
            channel,
            event: "alert.opened",
            alertId: alert.id,
            payload: { event: "alert.opened", alert: snapshot },
            status: "failed",
            lastResponse: lastError,
            now,
          })
        }
      }

      if (successes.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "We couldn't open a ticket. Check the webhook channel and try again.",
        })
      }

      const summary = summarizeResults(successes)
      await writeAuditEvent(ctx, {
        eventType: "ticket_opened",
        organizationId: alert.organizationId,
        siteId: alert.siteId,
        deviceId: alert.deviceId,
        eventData: {
          source: "alert",
          alertId: alert.id,
          title: alert.title,
        },
      })

      return summary
    }),
})
