import { TRPCError } from "@trpc/server"
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import {
  alerts,
  assets,
  devices,
  managementServices,
  notificationChannels,
  organizations,
  remoteSessions,
  sites,
  ticketComments,
  tickets,
  user,
} from "@nms/db"
import {
  assetTicketSchema,
  looksLikeLockhavenIngestUrl,
  postSignedJson,
  sessionTicketSchema,
  ticketingIngestUrl,
  webhookChannelConfigSchema,
} from "@nms/notifications"
import {
  alertKindLabels,
  BROWSER_CONNECTION_METHOD,
  createTicketInputSchema,
  isOpenTicketStatus,
  openTicketStatuses,
  priorityFromAlertSeverity,
  shouldCreateTicketForAlert,
  ticketCommentBodySchema,
  ticketPrioritySchema,
  ticketStatusSchema,
  ticketTitleFromAlert,
  type TicketPriority,
  type TicketStatus,
} from "@nms/shared"

import { assertAuthorized, requireActor } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { siteBelongsToOrganization } from "../helpers"
import { openTicketStatusesForAlert } from "../hub-tickets"
import {
  buildOrderBy,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
} from "../list"
import {
  combineConditions,
  eventScopeCondition,
  type ScopeCondition,
} from "../scope"
import {
  resolveTicketingDestination,
  ticketingSetupStatus,
  TICKETS_NOT_CONFIGURED,
} from "../ticketing-destination"
import { createTRPCRouter, permissionProcedure } from "../trpc"

const TICKET_FAILED = "We couldn't open a ticket. Try again in a moment."

const createdBy = alias(user, "ticket_created_by")
const updatedBy = alias(user, "ticket_updated_by")
const commentAuthor = alias(user, "ticket_comment_author")

function technicianName(name: string | null, email: string) {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : email
}

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function recordingUrl(sessionId: string) {
  const base =
    process.env.APP_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim()
  if (!base) return undefined
  return new URL(`/api/sessions/${sessionId}/recording/play`, base).toString()
}

function ticketScope(actor: ApiContext["actor"]): ScopeCondition {
  return eventScopeCondition(actor, {
    organizationId: tickets.organizationId,
    siteId: tickets.siteId,
    deviceId: tickets.deviceId,
  })
}

async function assertSiteInOrganization(
  ctx: ApiContext,
  siteId: string | null | undefined,
  organizationId: string
) {
  if (!siteId) return null
  const [site] = await ctx.db.select().from(sites).where(eq(sites.id, siteId))
  if (
    !site ||
    !siteBelongsToOrganization(site.organizationId, organizationId)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That site belongs to a different organization.",
    })
  }
  return site
}

async function assertDeviceInOrganization(
  ctx: ApiContext,
  deviceId: string | null | undefined,
  organizationId: string
) {
  if (!deviceId) return null
  const [device] = await ctx.db
    .select({
      id: devices.id,
      organizationId: devices.organizationId,
      siteId: devices.siteId,
      displayName: devices.displayName,
      hostname: devices.hostname,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
  if (!device || device.organizationId !== organizationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That device belongs to a different organization.",
    })
  }
  return device
}

async function loadTicket(ctx: ApiContext, id: string) {
  const [row] = await ctx.db.select().from(tickets).where(eq(tickets.id, id))
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  return row
}

async function assertTicketAccess(
  ctx: ApiContext,
  ticket: typeof tickets.$inferSelect,
  permission: "device:view" | "device:update"
) {
  assertAuthorized(ctx.actor, permission, {
    kind: "device",
    organizationId: ticket.organizationId,
    siteId: ticket.siteId,
  })
}

function publicTicket(
  row: typeof tickets.$inferSelect,
  extras: {
    organizationName: string | null
    siteName: string | null
    deviceName: string | null
    createdByName: string | null
    createdByEmail: string | null
    updatedByName: string | null
    updatedByEmail: string | null
    alertTitle: string | null
    alertStatus: string | null
  }
) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: extras.organizationName,
    siteId: row.siteId,
    siteName: extras.siteName,
    deviceId: row.deviceId,
    deviceName: extras.deviceName,
    alertId: row.alertId,
    alertTitle: extras.alertTitle,
    alertStatus: extras.alertStatus,
    title: row.title,
    status: row.status,
    priority: row.priority,
    body: row.body,
    createdByUserId: row.createdByUserId,
    createdByName: extras.createdByName,
    createdByEmail: extras.createdByEmail,
    updatedByUserId: row.updatedByUserId,
    updatedByName: extras.updatedByName,
    updatedByEmail: extras.updatedByEmail,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function insertHubTicket(
  ctx: ApiContext,
  input: {
    organizationId: string
    siteId: string | null
    deviceId: string | null
    alertId: string | null
    title: string
    priority: TicketPriority
    body: string | null
    actorId: string
    now?: Date
  }
) {
  const now = input.now ?? new Date()
  const [created] = await ctx.db
    .insert(tickets)
    .values({
      organizationId: input.organizationId,
      siteId: input.siteId,
      deviceId: input.deviceId,
      alertId: input.alertId,
      title: input.title,
      status: "open",
      priority: input.priority,
      body: input.body,
      createdByUserId: input.actorId,
      updatedByUserId: input.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: TICKET_FAILED,
    })
  }
  await writeAuditEvent(ctx, {
    eventType: "ticket_created",
    organizationId: created.organizationId,
    siteId: created.siteId,
    deviceId: created.deviceId,
    eventData: {
      ticketId: created.id,
      title: created.title,
      priority: created.priority,
      alertId: created.alertId,
      source: created.alertId ? "alert" : "manual",
    },
  })
  return created
}

async function tryExternalDeskFanout(
  ctx: ApiContext,
  organizationId: string,
  run: (
    destination: Awaited<ReturnType<typeof resolveTicketingDestination>>
  ) => Promise<boolean>
): Promise<{ attempted: boolean; created: boolean }> {
  try {
    const destination = await resolveTicketingDestination(ctx, organizationId)
    const created = await run(destination)
    return { attempted: true, created }
  } catch (error) {
    if (
      error instanceof TRPCError &&
      error.message === TICKETS_NOT_CONFIGURED
    ) {
      return { attempted: false, created: false }
    }
    return { attempted: true, created: false }
  }
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

  page: permissionProcedure("device:view")
    .input(listQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(input, { defaultLimit: 50 })
      const scope = ticketScope(ctx.actor)
      if (scope.kind === "none") {
        return paginate([], query, 0)
      }

      const conditions = combineConditions([
        scope.kind === "where" ? scope.condition : undefined,
        query.filters.status
          ? inArray(sql`${tickets.status}::text`, query.filters.status)
          : undefined,
        query.filters.priority
          ? inArray(sql`${tickets.priority}::text`, query.filters.priority)
          : undefined,
        query.filters.organizationId
          ? inArray(tickets.organizationId, query.filters.organizationId)
          : undefined,
        query.filters.siteId
          ? inArray(tickets.siteId, query.filters.siteId)
          : undefined,
        query.filters.deviceId
          ? inArray(tickets.deviceId, query.filters.deviceId)
          : undefined,
        query.filters.alertId
          ? inArray(tickets.alertId, query.filters.alertId)
          : undefined,
        query.search
          ? or(
              ilike(tickets.title, likePattern(query.search)),
              ilike(tickets.body, likePattern(query.search)),
              ilike(sites.name, likePattern(query.search)),
              ilike(devices.displayName, likePattern(query.search)),
              ilike(devices.hostname, likePattern(query.search))
            )
          : undefined,
      ])

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const sortColumns = {
        title: tickets.title,
        status: tickets.status,
        priority: tickets.priority,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
        resolvedAt: tickets.resolvedAt,
      }

      const [[totalRow], rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(tickets)
          .leftJoin(sites, eq(sites.id, tickets.siteId))
          .leftJoin(devices, eq(devices.id, tickets.deviceId))
          .where(where),
        ctx.db
          .select({
            ticket: tickets,
            organizationName: organizations.name,
            siteName: sites.name,
            deviceName: devices.displayName,
            deviceHostname: devices.hostname,
            createdByName: createdBy.name,
            createdByEmail: createdBy.email,
            updatedByName: updatedBy.name,
            updatedByEmail: updatedBy.email,
            alertTitle: alerts.title,
            alertStatus: alerts.status,
          })
          .from(tickets)
          .innerJoin(
            organizations,
            eq(organizations.id, tickets.organizationId)
          )
          .leftJoin(sites, eq(sites.id, tickets.siteId))
          .leftJoin(devices, eq(devices.id, tickets.deviceId))
          .leftJoin(alerts, eq(alerts.id, tickets.alertId))
          .leftJoin(createdBy, eq(createdBy.id, tickets.createdByUserId))
          .leftJoin(updatedBy, eq(updatedBy.id, tickets.updatedByUserId))
          .where(where)
          .orderBy(
            ...buildOrderBy(query.sort, sortColumns, [
              desc(tickets.updatedAt),
              desc(tickets.id),
            ])
          )
          .limit(query.limit + 1)
          .offset(query.offset),
      ])

      const items = rows.map((row) =>
        publicTicket(row.ticket, {
          organizationName: row.organizationName,
          siteName: row.siteName,
          deviceName: row.deviceName || row.deviceHostname,
          createdByName: row.createdByName,
          createdByEmail: row.createdByEmail,
          updatedByName: row.updatedByName,
          updatedByEmail: row.updatedByEmail,
          alertTitle: row.alertTitle,
          alertStatus: row.alertStatus,
        })
      )
      return paginate(items, query, Number(totalRow?.total ?? 0))
    }),

  byId: permissionProcedure("device:view")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ticket = await loadTicket(ctx, input.id)
      await assertTicketAccess(ctx, ticket, "device:view")

      const [row] = await ctx.db
        .select({
          ticket: tickets,
          organizationName: organizations.name,
          siteName: sites.name,
          deviceName: devices.displayName,
          deviceHostname: devices.hostname,
          createdByName: createdBy.name,
          createdByEmail: createdBy.email,
          updatedByName: updatedBy.name,
          updatedByEmail: updatedBy.email,
          alertTitle: alerts.title,
          alertStatus: alerts.status,
        })
        .from(tickets)
        .innerJoin(organizations, eq(organizations.id, tickets.organizationId))
        .leftJoin(sites, eq(sites.id, tickets.siteId))
        .leftJoin(devices, eq(devices.id, tickets.deviceId))
        .leftJoin(alerts, eq(alerts.id, tickets.alertId))
        .leftJoin(createdBy, eq(createdBy.id, tickets.createdByUserId))
        .leftJoin(updatedBy, eq(updatedBy.id, tickets.updatedByUserId))
        .where(eq(tickets.id, ticket.id))

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      const comments = await ctx.db
        .select({
          id: ticketComments.id,
          body: ticketComments.body,
          createdAt: ticketComments.createdAt,
          authorUserId: ticketComments.authorUserId,
          authorName: commentAuthor.name,
          authorEmail: commentAuthor.email,
        })
        .from(ticketComments)
        .leftJoin(
          commentAuthor,
          eq(commentAuthor.id, ticketComments.authorUserId)
        )
        .where(eq(ticketComments.ticketId, ticket.id))
        .orderBy(desc(ticketComments.createdAt))

      return {
        ...publicTicket(row.ticket, {
          organizationName: row.organizationName,
          siteName: row.siteName,
          deviceName: row.deviceName || row.deviceHostname,
          createdByName: row.createdByName,
          createdByEmail: row.createdByEmail,
          updatedByName: row.updatedByName,
          updatedByEmail: row.updatedByEmail,
          alertTitle: row.alertTitle,
          alertStatus: row.alertStatus,
        }),
        comments: comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          authorUserId: comment.authorUserId,
          authorName: comment.authorName,
          authorEmail: comment.authorEmail,
        })),
      }
    }),

  create: permissionProcedure("device:update")
    .input(createTicketInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: input.organizationId,
        siteId: input.siteId ?? null,
      })

      const site = await assertSiteInOrganization(
        ctx,
        input.siteId,
        input.organizationId
      )
      const device = await assertDeviceInOrganization(
        ctx,
        input.deviceId,
        input.organizationId
      )
      if (
        device &&
        input.siteId &&
        device.siteId &&
        device.siteId !== input.siteId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That device is not at the selected site.",
        })
      }

      const alertId: string | null = input.alertId ?? null
      if (alertId) {
        const [alert] = await ctx.db
          .select({
            id: alerts.id,
            organizationId: alerts.organizationId,
          })
          .from(alerts)
          .where(eq(alerts.id, alertId))
        if (!alert || alert.organizationId !== input.organizationId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That alert belongs to a different organization.",
          })
        }
        const existing = await openTicketStatusesForAlert(ctx.db, alertId)
        if (!shouldCreateTicketForAlert(existing)) {
          const [open] = await ctx.db
            .select({ id: tickets.id })
            .from(tickets)
            .where(
              and(
                eq(tickets.alertId, alertId),
                inArray(tickets.status, [...openTicketStatuses])
              )
            )
            .limit(1)
          return { id: open?.id ?? null, created: false as const }
        }
      }

      const created = await insertHubTicket(ctx, {
        organizationId: input.organizationId,
        siteId: site?.id ?? device?.siteId ?? input.siteId ?? null,
        deviceId: device?.id ?? input.deviceId ?? null,
        alertId,
        title: input.title.trim(),
        priority: input.priority ?? "medium",
        body: emptyToNull(input.body),
        actorId: actor.id,
      })
      return { id: created.id, created: true as const }
    }),

  createFromAlert: permissionProcedure("device:update")
    .input(
      z.object({
        alertId: z.string().uuid(),
        title: z.string().trim().min(1).max(240).optional(),
        priority: ticketPrioritySchema.optional(),
        body: z.string().trim().max(8000).nullable().optional(),
      })
    )
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This alert is not tied to an organization.",
        })
      }
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: alert.organizationId,
        siteId: alert.siteId,
      })

      const existing = await openTicketStatusesForAlert(ctx.db, alert.id)
      if (!shouldCreateTicketForAlert(existing)) {
        const [open] = await ctx.db
          .select({ id: tickets.id })
          .from(tickets)
          .where(
            and(
              eq(tickets.alertId, alert.id),
              inArray(tickets.status, [...openTicketStatuses])
            )
          )
          .limit(1)
        return {
          id: open?.id ?? null,
          created: false as const,
        }
      }

      const kindLabel =
        alertKindLabels[alert.kind as keyof typeof alertKindLabels] ?? null
      const created = await insertHubTicket(ctx, {
        organizationId: alert.organizationId,
        siteId: alert.siteId,
        deviceId: alert.deviceId,
        alertId: alert.id,
        title:
          input.title?.trim() ||
          ticketTitleFromAlert({ title: alert.title, kindLabel }),
        priority: input.priority ?? priorityFromAlertSeverity(alert.severity),
        body: emptyToNull(input.body),
        actorId: actor.id,
      })
      return { id: created.id, created: true as const }
    }),

  update: permissionProcedure("device:update")
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(240).optional(),
        priority: ticketPrioritySchema.optional(),
        status: ticketStatusSchema.optional(),
        body: z.string().trim().max(8000).nullable().optional(),
        siteId: z.string().uuid().nullable().optional(),
        deviceId: z.string().uuid().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const ticket = await loadTicket(ctx, input.id)
      await assertTicketAccess(ctx, ticket, "device:update")

      if (input.siteId !== undefined) {
        await assertSiteInOrganization(ctx, input.siteId, ticket.organizationId)
      }
      if (input.deviceId !== undefined) {
        await assertDeviceInOrganization(
          ctx,
          input.deviceId,
          ticket.organizationId
        )
      }

      const now = new Date()
      const nextStatus = input.status ?? ticket.status
      const wasOpen = isOpenTicketStatus(ticket.status)
      const becomingDone = nextStatus === "done" && wasOpen

      const [updated] = await ctx.db
        .update(tickets)
        .set({
          title: input.title?.trim() ?? ticket.title,
          priority: input.priority ?? ticket.priority,
          status: nextStatus,
          body:
            input.body === undefined ? ticket.body : emptyToNull(input.body),
          siteId: input.siteId === undefined ? ticket.siteId : input.siteId,
          deviceId:
            input.deviceId === undefined ? ticket.deviceId : input.deviceId,
          updatedByUserId: actor.id,
          updatedAt: now,
          resolvedAt: becomingDone
            ? now
            : nextStatus !== "done"
              ? null
              : ticket.resolvedAt,
        })
        .where(eq(tickets.id, ticket.id))
        .returning()

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      await writeAuditEvent(ctx, {
        eventType: "ticket_updated",
        organizationId: updated.organizationId,
        siteId: updated.siteId,
        deviceId: updated.deviceId,
        eventData: {
          ticketId: updated.id,
          status: updated.status,
          priority: updated.priority,
          title: updated.title,
        },
      })

      return { id: updated.id, status: updated.status as TicketStatus }
    }),

  addComment: permissionProcedure("device:update")
    .input(
      z.object({
        ticketId: z.string().uuid(),
        body: ticketCommentBodySchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const ticket = await loadTicket(ctx, input.ticketId)
      await assertTicketAccess(ctx, ticket, "device:update")
      const now = new Date()
      const [comment] = await ctx.db
        .insert(ticketComments)
        .values({
          ticketId: ticket.id,
          authorUserId: actor.id,
          body: input.body,
          createdAt: now,
        })
        .returning()
      if (!comment) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "We couldn't add that comment.",
        })
      }
      await ctx.db
        .update(tickets)
        .set({
          updatedAt: now,
          updatedByUserId: actor.id,
        })
        .where(eq(tickets.id, ticket.id))
      await writeAuditEvent(ctx, {
        eventType: "ticket_comment_added",
        organizationId: ticket.organizationId,
        siteId: ticket.siteId,
        deviceId: ticket.deviceId,
        eventData: {
          ticketId: ticket.id,
          commentId: comment.id,
        },
      })
      return {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        authorUserId: comment.authorUserId,
      }
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

      const reason = optionalText(input.reason) || optionalText(session?.reason)
      const deviceName = device.displayName || device.hostname || "device"
      const notes = optionalText(input.notes)
      const bodyParts = [reason, notes].filter(Boolean)
      const hub = await insertHubTicket(ctx, {
        organizationId: device.organizationId,
        siteId: device.siteId,
        deviceId: device.id,
        alertId: null,
        title: `Work on ${deviceName}`,
        priority: "medium",
        body: bodyParts.length > 0 ? bodyParts.join("\n\n") : null,
        actorId: actor.id,
      })

      const external = await tryExternalDeskFanout(
        ctx,
        device.organizationId,
        async (destination) => {
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
            notes,
          })
          const ack = await postSignedJson({
            url: destination.sessionUrl,
            secret: destination.secret,
            payload,
          })
          return ack.created !== false
        }
      )

      await writeAuditEvent(ctx, {
        eventType: "ticket_opened",
        organizationId: device.organizationId,
        siteId: device.siteId,
        deviceId: device.id,
        eventData: {
          source: "device",
          sessionId: session?.id ?? null,
          ticketId: hub.id,
          created: true,
          externalAttempted: external.attempted,
          externalCreated: external.created,
        },
      })

      return {
        id: hub.id,
        created: true as const,
        externalCreated: external.created,
      }
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
          deviceId: devices.id,
        })
        .from(assets)
        .leftJoin(sites, eq(sites.id, assets.siteId))
        .leftJoin(devices, eq(devices.assetId, assets.id))
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
      const title = input.title?.trim() || `Work on ${asset.tag}`
      const notes = optionalText(input.notes)
      const priority = (input.severity ?? "medium") as TicketPriority

      const hub = await insertHubTicket(ctx, {
        organizationId: asset.organizationId,
        siteId: asset.siteId,
        deviceId: asset.deviceId ?? null,
        alertId: null,
        title,
        priority,
        body: notes ?? null,
        actorId: actor.id,
      })

      const external = await tryExternalDeskFanout(
        ctx,
        asset.organizationId,
        async (destination) => {
          const payload = assetTicketSchema.parse({
            title,
            assetId: asset.id,
            assetTag: asset.tag,
            siteId: asset.siteId ?? undefined,
            siteName: optionalText(asset.siteName),
            requesterName: technicianName(actor.name, actor.email),
            requesterEmail: actor.email,
            severity: input.severity,
            category: input.category,
            notes,
          })
          const ack = await postSignedJson({
            url: destination.assetUrl,
            secret: destination.secret,
            payload,
          })
          return ack.created !== false
        }
      )

      await writeAuditEvent(ctx, {
        eventType: "ticket_opened",
        organizationId: asset.organizationId,
        siteId: asset.siteId,
        eventData: {
          source: "asset",
          assetId: asset.id,
          assetTag: asset.tag,
          ticketId: hub.id,
          created: true,
          externalAttempted: external.attempted,
          externalCreated: external.created,
        },
      })

      return {
        id: hub.id,
        created: true as const,
        externalCreated: external.created,
      }
    }),
})
