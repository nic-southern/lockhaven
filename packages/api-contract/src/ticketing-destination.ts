import { TRPCError } from "@trpc/server"
import { and, desc, eq } from "drizzle-orm"

import { notificationChannels } from "@nms/db"
import {
  pickTicketingWebhookUrl,
  ticketingAssetUrl,
  ticketingIngestSecret,
  ticketingIngestUrl,
  ticketingLockhavenUrl,
  ticketingSessionUrl,
  webhookChannelConfigSchema,
} from "@nms/notifications"
import { decryptSecret } from "@nms/remote-access"

import type { ApiContext } from "./context"

export type TicketingDestination = {
  lockhavenUrl: string
  sessionUrl: string
  assetUrl: string
  secret: string
  source: "channel" | "env"
}

function credentialSecret() {
  const secret = process.env.REMOTE_CREDENTIALS_KEY
  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing remote credential secret",
    })
  }
  return secret
}

export const TICKETS_NOT_CONFIGURED =
  "Tickets aren't set up yet. Add a webhook channel for this organization."

export async function resolveTicketingDestination(
  ctx: Pick<ApiContext, "db">,
  organizationId: string
): Promise<TicketingDestination> {
  const expected = ticketingIngestUrl()
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
    .orderBy(desc(notificationChannels.createdAt))

  const parsed = channels.flatMap((channel) => {
    const config = webhookChannelConfigSchema.safeParse(channel.config)
    if (!config.success) return []
    return [{ channel, url: config.data.url, secret: config.data.secret }]
  })
  const pickedUrl = pickTicketingWebhookUrl(
    parsed.map((row) => row.url),
    expected
  )
  const match = pickedUrl
    ? parsed.find((row) => row.url.replace(/\/+$/, "") === pickedUrl)
    : undefined

  if (match) {
    return {
      lockhavenUrl: ticketingLockhavenUrl(match.url),
      sessionUrl: ticketingSessionUrl(match.url),
      assetUrl: ticketingAssetUrl(match.url),
      secret: decryptSecret(match.secret, credentialSecret()),
      source: "channel",
    }
  }

  const envSecret = ticketingIngestSecret()
  if (expected && envSecret) {
    return {
      lockhavenUrl: ticketingLockhavenUrl(expected),
      sessionUrl: ticketingSessionUrl(expected),
      assetUrl: ticketingAssetUrl(expected),
      secret: envSecret,
      source: "env",
    }
  }

  throw new TRPCError({
    code: "BAD_REQUEST",
    message: TICKETS_NOT_CONFIGURED,
  })
}

export function ticketingSetupStatus(organizationHasChannel: boolean) {
  const ingestUrl = ticketingIngestUrl()
  const envSecret = Boolean(ticketingIngestSecret())
  return {
    ingestUrl,
    configured: organizationHasChannel || Boolean(ingestUrl && envSecret),
  }
}
