import { TRPCError } from "@trpc/server"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import {
  assets,
  devices,
  managementServices,
  notificationChannels,
  remoteSessions,
  sites,
} from "@nms/db"
import {
  assetTicketSchema,
  looksLikeLockhavenIngestUrl,
  postSignedJson,
  sessionTicketSchema,
  ticketingIngestUrl,
  webhookChannelConfigSchema,
} from "@nms/notifications"
import { BROWSER_CONNECTION_METHOD } from "@nms/shared"

import { assertAuthorized, requireActor } from "../access"
import { writeAuditEvent } from "../audit"
import {
  resolveTicketingDestination,
  ticketingSetupStatus,
} from "../ticketing-destination"
import { createTRPCRouter, permissionProcedure } from "../trpc"

const TICKET_FAILED = "We couldn't open a ticket. Try again in a moment."

function technicianName(name: string | null, email: string) {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : email
}

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function recordingUrl(sessionId: string) {
  const base =
    process.env.APP_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim()
  if (!base) return undefined
  return new URL(`/api/sessions/${sessionId}/recording/play`, base).toString()
}

export const ticketsRouter = createTRPCRouter({
  setup: permissionProcedure("device:view")
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: input.organizationId,
        siteId: null,
      })
      const expected = ticketingIngestUrl()
      const channels = await ctx.db
        .select({ config: notificationChannels.config })
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.organizationId, input.organizationId),
            eq(notificationChannels.enabled, true),
            eq(notificationChannels.type, "webhook")
          )
        )
      const hasChannel = channels.some((channel) => {
        const parsed = webhookChannelConfigSchema.safeParse(channel.config)
        return (
          parsed.success &&
          (looksLikeLockhavenIngestUrl(parsed.data.url) ||
            (expected &&
              parsed.data.url.replace(/\/+$/, "").toLowerCase() ===
                expected.toLowerCase()))
        )
      })
      return ticketingSetupStatus(hasChannel)
    }),

  recentSessions: permissionProcedure("device:view")
    .input(
      z.object({
        deviceId: z.string().uuid(),
        limit: z.number().int().min(1).max(20).default(8),
      })
    )
    .query(async ({ ctx, input }) => {
      const [device] = await ctx.db
        .select({
          id: devices.id,
          organizationId: devices.organizationId,
          siteId: devices.siteId,
        })
        .from(devices)
        .where(eq(devices.id, input.deviceId))
      if (!device) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })

      const rows = await ctx.db
        .select({
          id: remoteSessions.id,
          startedAt: remoteSessions.startedAt,
          endedAt: remoteSessions.endedAt,
          reason: remoteSessions.reason,
          connectionMethod: remoteSessions.connectionMethod,
          recordingPath: remoteSessions.recordingPath,
          serviceType: managementServices.serviceType,
        })
        .from(remoteSessions)
        .innerJoin(
          managementServices,
          eq(managementServices.id, remoteSessions.managementServiceId)
        )
        .where(eq(remoteSessions.deviceId, device.id))
        .orderBy(desc(remoteSessions.startedAt))
        .limit(input.limit)

      return rows.map((row) => ({
        id: row.id,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        reason: row.reason,
        serviceType: row.serviceType,
        hasRecording:
          Boolean(row.recordingPath) &&
          row.connectionMethod === BROWSER_CONNECTION_METHOD,
      }))
    }),

  openFromDevice: permissionProcedure("device:update")
    .input(
      z.object({
        deviceId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
        reason: z.string().trim().max(4000).optional(),
        notes: z.string().trim().max(8000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [device] = await ctx.db
        .select({
          id: devices.id,
          organizationId: devices.organizationId,
          siteId: devices.siteId,
          displayName: devices.displayName,
          hostname: devices.hostname,
          siteName: sites.name,
        })
        .from(devices)
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .where(eq(devices.id, input.deviceId))
      if (!device) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })
      const actor = requireActor(ctx.actor)

      let session:
        | {
            id: string
            reason: string | null
            serviceType: string
            recordingPath: string | null
            connectionMethod: string
          }
        | undefined
      if (input.sessionId) {
        const [row] = await ctx.db
          .select({
            id: remoteSessions.id,
            deviceId: remoteSessions.deviceId,
            reason: remoteSessions.reason,
            recordingPath: remoteSessions.recordingPath,
            connectionMethod: remoteSessions.connectionMethod,
            serviceType: managementServices.serviceType,
          })
          .from(remoteSessions)
          .innerJoin(
            managementServices,
            eq(managementServices.id, remoteSessions.managementServiceId)
          )
          .where(eq(remoteSessions.id, input.sessionId))
        if (!row || row.deviceId !== device.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That session does not belong to this device.",
          })
        }
        session = row
      }

      const destination = await resolveTicketingDestination(
        ctx,
        device.organizationId
      )
      const reason = optionalText(input.reason) || optionalText(session?.reason)
      const deviceName = device.displayName || device.hostname || "device"
      const payload = sessionTicketSchema.parse({
        title: `Work on ${deviceName}`,
        deviceId: device.id,
        deviceName,
        siteId: device.siteId ?? undefined,
        siteName: optionalText(device.siteName),
        technicianName: technicianName(actor.name, actor.email),
        technicianEmail: actor.email,
        sessionId: session?.id,
        recordingUrl:
          session &&
          session.recordingPath &&
          session.connectionMethod === BROWSER_CONNECTION_METHOD
            ? recordingUrl(session.id)
            : undefined,
        reason,
        serviceType: optionalText(session?.serviceType),
        notes: optionalText(input.notes),
      })

      let created = true
      try {
        const ack = await postSignedJson({
          url: destination.sessionUrl,
          secret: destination.secret,
          payload,
        })
        created = ack.created !== false
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: TICKET_FAILED,
        })
      }

      await writeAuditEvent(ctx, {
        eventType: "ticket_opened",
        organizationId: device.organizationId,
        siteId: device.siteId,
        deviceId: device.id,
        eventData: {
          source: "device",
          sessionId: session?.id ?? null,
          created,
        },
      })

      return { created }
    }),

  openFromAsset: permissionProcedure("device:update")
    .input(
      z.object({
        assetId: z.string().uuid(),
        title: z.string().trim().min(1).max(240).optional(),
        notes: z.string().trim().max(8000).optional(),
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        category: z
          .enum([
            "hardware",
            "software",
            "network",
            "access",
            "account",
            "other",
          ])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [asset] = await ctx.db
        .select({
          id: assets.id,
          organizationId: assets.organizationId,
          siteId: assets.siteId,
          tag: assets.tag,
          siteName: sites.name,
        })
        .from(assets)
        .leftJoin(sites, eq(sites.id, assets.siteId))
        .where(eq(assets.id, input.assetId))
      if (!asset) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: asset.organizationId,
        siteId: asset.siteId,
      })
      const actor = requireActor(ctx.actor)

      const destination = await resolveTicketingDestination(
        ctx,
        asset.organizationId
      )
      const payload = assetTicketSchema.parse({
        title: input.title?.trim() || `Work on ${asset.tag}`,
        assetId: asset.id,
        assetTag: asset.tag,
        siteId: asset.siteId ?? undefined,
        siteName: optionalText(asset.siteName),
        requesterName: technicianName(actor.name, actor.email),
        requesterEmail: actor.email,
        severity: input.severity,
        category: input.category,
        notes: optionalText(input.notes),
      })

      let created = true
      try {
        const ack = await postSignedJson({
          url: destination.assetUrl,
          secret: destination.secret,
          payload,
        })
        created = ack.created !== false
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: TICKET_FAILED,
        })
      }

      await writeAuditEvent(ctx, {
        eventType: "ticket_opened",
        organizationId: asset.organizationId,
        siteId: asset.siteId,
        eventData: {
          source: "asset",
          assetId: asset.id,
          assetTag: asset.tag,
          created,
        },
      })

      return { created }
    }),
})
