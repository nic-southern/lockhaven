import { randomBytes } from "node:crypto"

import { TRPCError } from "@trpc/server"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { notificationChannels, notificationDeliveries, sites } from "@nms/db"
import {
  deliverNotification,
  emailChannelConfigSchema,
  webhookChannelConfigSchema,
} from "@nms/notifications"
import { alertKindSchema, auditSeveritySchema } from "@nms/shared"
import { decryptSecret, encryptSecret } from "@nms/remote-access"

import { assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { adminProcedure, createTRPCRouter } from "../trpc"

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

function assertCanManage(ctx: ApiContext, organizationId: string) {
  assertAuthorized(ctx.actor, "organization:admin", {
    kind: "organization",
    organizationId,
  })
}

function generateWebhookSecret() {
  return randomBytes(32).toString("base64url")
}

const emailCreateInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  type: z.literal("email"),
  enabled: z.boolean().optional(),
  minSeverity: auditSeveritySchema.default("info"),
  alertKinds: z.array(alertKindSchema).max(20).default([]),
  siteIds: z.array(z.string().uuid()).max(200).default([]),
  addresses: z.array(z.string().email().max(320)).min(1).max(50),
})

const webhookCreateInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  type: z.literal("webhook"),
  enabled: z.boolean().optional(),
  minSeverity: auditSeveritySchema.default("info"),
  alertKinds: z.array(alertKindSchema).max(20).default([]),
  siteIds: z.array(z.string().uuid()).max(200).default([]),
  url: z.string().url().max(2048),
})

const createInput = z.discriminatedUnion("type", [
  emailCreateInput,
  webhookCreateInput,
])

const updateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  minSeverity: auditSeveritySchema.optional(),
  alertKinds: z.array(alertKindSchema).max(20).optional(),
  siteIds: z.array(z.string().uuid()).max(200).optional(),
  addresses: z.array(z.string().email().max(320)).min(1).max(50).optional(),
  url: z.string().url().max(2048).optional(),
  rotateSecret: z.boolean().optional(),
})

function publicChannel(
  channel: typeof notificationChannels.$inferSelect,
  extra?: { webhookSecret?: string }
) {
  const email =
    channel.type === "email"
      ? emailChannelConfigSchema.safeParse(channel.config)
      : null
  const webhook =
    channel.type === "webhook"
      ? webhookChannelConfigSchema.safeParse(channel.config)
      : null

  return {
    id: channel.id,
    organizationId: channel.organizationId,
    name: channel.name,
    type: channel.type,
    enabled: channel.enabled,
    minSeverity: channel.minSeverity,
    alertKinds: channel.alertKinds ?? [],
    siteIds: channel.siteIds ?? [],
    addresses: email?.success ? email.data.addresses : [],
    url: webhook?.success ? webhook.data.url : null,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    webhookSecret: extra?.webhookSecret,
  }
}

async function loadChannel(ctx: ApiContext, id: string) {
  const [channel] = await ctx.db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id))
  if (!channel) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  assertCanManage(ctx, channel.organizationId)
  return channel
}

async function assertSitesInOrganization(
  ctx: ApiContext,
  organizationId: string,
  siteIds: string[]
) {
  if (siteIds.length === 0) return
  const unique = [...new Set(siteIds)]
  const matched = await ctx.db
    .select({ id: sites.id })
    .from(sites)
    .where(
      and(eq(sites.organizationId, organizationId), inArray(sites.id, unique))
    )
  if (matched.length !== unique.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Sites must belong to this organization.",
    })
  }
}

async function destinationForChannel(
  channel: typeof notificationChannels.$inferSelect
) {
  if (channel.type === "email") {
    const config = emailChannelConfigSchema.parse(channel.config)
    return {
      type: "email" as const,
      addresses: config.addresses,
      channelName: channel.name,
    }
  }
  const config = webhookChannelConfigSchema.parse(channel.config)
  return {
    type: "webhook" as const,
    url: config.url,
    secret: decryptSecret(config.secret, getCredentialSecret()),
  }
}

export const notificationsRouter = createTRPCRouter({
  channels: adminProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertCanManage(ctx, input.organizationId)
      const rows = await ctx.db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.organizationId, input.organizationId))
        .orderBy(desc(notificationChannels.createdAt))
      return rows.map((row) => publicChannel(row))
    }),

  createChannel: adminProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx, input.organizationId)
      await assertSitesInOrganization(ctx, input.organizationId, input.siteIds)

      const now = new Date()
      let config: Record<string, unknown>
      let webhookSecret: string | undefined
      if (input.type === "email") {
        config = emailChannelConfigSchema.parse({ addresses: input.addresses })
      } else {
        webhookSecret = generateWebhookSecret()
        config = webhookChannelConfigSchema.parse({
          url: input.url,
          secret: encryptSecret(webhookSecret, getCredentialSecret()),
        })
      }

      const [channel] = await ctx.db
        .insert(notificationChannels)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          type: input.type,
          enabled: input.enabled ?? true,
          config,
          minSeverity: input.minSeverity,
          alertKinds: input.alertKinds,
          siteIds: input.siteIds,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "notification_channel_created",
        organizationId: input.organizationId,
        eventData: {
          channelId: channel.id,
          type: channel.type,
          name: channel.name,
        },
      })

      return publicChannel(channel, { webhookSecret })
    }),

  updateChannel: adminProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const channel = await loadChannel(ctx, input.id)
      if (input.siteIds) {
        await assertSitesInOrganization(
          ctx,
          channel.organizationId,
          input.siteIds
        )
      }

      let config = channel.config
      let webhookSecret: string | undefined
      if (channel.type === "email") {
        if (input.addresses) {
          config = emailChannelConfigSchema.parse({
            addresses: input.addresses,
          })
        }
      } else {
        const current = webhookChannelConfigSchema.parse(channel.config)
        const nextSecret = input.rotateSecret
          ? generateWebhookSecret()
          : decryptSecret(current.secret, getCredentialSecret())
        if (input.rotateSecret) {
          webhookSecret = nextSecret
        }
        config = webhookChannelConfigSchema.parse({
          url: input.url ?? current.url,
          secret: input.rotateSecret
            ? encryptSecret(nextSecret, getCredentialSecret())
            : current.secret,
        })
      }

      const now = new Date()
      const [updated] = await ctx.db
        .update(notificationChannels)
        .set({
          name: input.name ?? channel.name,
          enabled: input.enabled ?? channel.enabled,
          minSeverity: input.minSeverity ?? channel.minSeverity,
          alertKinds: input.alertKinds ?? channel.alertKinds,
          siteIds: input.siteIds ?? channel.siteIds,
          config,
          updatedAt: now,
        })
        .where(eq(notificationChannels.id, channel.id))
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "notification_channel_updated",
        organizationId: channel.organizationId,
        eventData: {
          channelId: channel.id,
          type: channel.type,
          name: updated.name,
        },
      })

      return publicChannel(updated, { webhookSecret })
    }),

  deleteChannel: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await loadChannel(ctx, input.id)
      await ctx.db
        .delete(notificationChannels)
        .where(eq(notificationChannels.id, channel.id))
      await writeAuditEvent(ctx, {
        eventType: "notification_channel_deleted",
        organizationId: channel.organizationId,
        eventData: {
          channelId: channel.id,
          type: channel.type,
          name: channel.name,
        },
      })
      return { ok: true as const }
    }),

  sendTest: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const channel = await loadChannel(ctx, input.id)
      const now = new Date()
      let status: "sent" | "failed" = "sent"
      let lastResponse = ""
      try {
        lastResponse = await deliverNotification({
          destination: await destinationForChannel(channel),
          event: "channel.test",
        })
      } catch (error) {
        status = "failed"
        lastResponse =
          error instanceof Error ? error.message.slice(0, 1000) : String(error)
      }

      const [delivery] = await ctx.db
        .insert(notificationDeliveries)
        .values({
          channelId: channel.id,
          organizationId: channel.organizationId,
          alertId: null,
          event: "channel.test",
          status,
          attempts: 1,
          nextAttemptAt: now,
          lastResponse,
          payload: { event: "channel.test" },
          createdAt: now,
          updatedAt: now,
          sentAt: status === "sent" ? now : null,
        })
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "notification_test_sent",
        organizationId: channel.organizationId,
        eventData: {
          channelId: channel.id,
          deliveryId: delivery.id,
          status,
        },
      })

      if (status === "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "We couldn't send the test. Check the destination and try again.",
        })
      }

      return { ok: true as const, deliveryId: delivery.id }
    }),

  deliveries: adminProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        channelId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      assertCanManage(ctx, input.organizationId)
      const conditions = [
        eq(notificationDeliveries.organizationId, input.organizationId),
      ]
      if (input.channelId) {
        conditions.push(eq(notificationDeliveries.channelId, input.channelId))
      }
      const where = and(...conditions)
      const [totalRow] = await ctx.db
        .select({ total: count() })
        .from(notificationDeliveries)
        .where(where)
      const items = await ctx.db
        .select({
          id: notificationDeliveries.id,
          channelId: notificationDeliveries.channelId,
          channelName: notificationChannels.name,
          channelType: notificationChannels.type,
          alertId: notificationDeliveries.alertId,
          event: notificationDeliveries.event,
          status: notificationDeliveries.status,
          attempts: notificationDeliveries.attempts,
          nextAttemptAt: notificationDeliveries.nextAttemptAt,
          lastResponse: notificationDeliveries.lastResponse,
          createdAt: notificationDeliveries.createdAt,
          sentAt: notificationDeliveries.sentAt,
        })
        .from(notificationDeliveries)
        .innerJoin(
          notificationChannels,
          eq(notificationChannels.id, notificationDeliveries.channelId)
        )
        .where(where)
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(input.limit)

      return { items, total: Number(totalRow?.total ?? 0) }
    }),

  retryDelivery: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [delivery] = await ctx.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, input.id))
      if (!delivery) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertCanManage(ctx, delivery.organizationId)
      if (delivery.status === "sent" || delivery.status === "sending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This delivery doesn't need another attempt.",
        })
      }

      const now = new Date()
      await ctx.db
        .update(notificationDeliveries)
        .set({
          status: "pending",
          attempts: 0,
          nextAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id))

      await writeAuditEvent(ctx, {
        eventType: "notification_delivery_retried",
        organizationId: delivery.organizationId,
        eventData: { deliveryId: delivery.id, channelId: delivery.channelId },
      })

      return { ok: true as const }
    }),
})
