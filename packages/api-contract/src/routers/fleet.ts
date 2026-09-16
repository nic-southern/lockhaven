import { TRPCError } from "@trpc/server"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import {
  agentReleases,
  deviceCommands,
  devices,
  organizations,
  sites,
} from "@nms/db"
import {
  agentChannelSchema,
  agentCommandKindLabels,
  agentCommandKinds,
  agentReleasePlatformSchema,
  agentVersionSchema,
  DEFAULT_AGENT_CHANNEL,
  hasOpenCommandOfKind,
  isAgentBehind,
  isAgentCommandKind,
  normalizeAgentPlatform,
  pickDesiredRelease,
  resolveAgentChannel,
  sha256HexSchema,
  type AgentChannel,
  type AgentCommandKind,
  type AgentReleasePick,
} from "@nms/shared"

import {
  actorOrganizationIds,
  assertAuthorized,
  assertPlatformAdministrator,
} from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { combineConditions, deviceScopeCondition } from "../scope"
import { adminProcedure, createTRPCRouter, permissionProcedure } from "../trpc"

const releaseCreateInput = z.object({
  platform: agentReleasePlatformSchema,
  version: agentVersionSchema,
  channel: agentChannelSchema,
  downloadUrl: z.string().trim().url().max(2000),
  sha256: sha256HexSchema,
  notes: z.string().trim().max(2000).optional().nullable(),
})

const releaseUpdateInput = releaseCreateInput.extend({
  id: z.string().uuid(),
})

function publicRelease(row: typeof agentReleases.$inferSelect) {
  return {
    id: row.id,
    platform: row.platform,
    version: row.version,
    channel: row.channel,
    downloadUrl: row.downloadUrl,
    sha256: row.sha256,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function assertReleaseUnique(
  ctx: ApiContext,
  input: {
    channel: AgentChannel
    platform: AgentReleasePick["platform"]
    version: string
    exceptId?: string
  }
) {
  const [existing] = await ctx.db
    .select({ id: agentReleases.id })
    .from(agentReleases)
    .where(
      and(
        eq(agentReleases.channel, input.channel),
        eq(agentReleases.platform, input.platform),
        eq(agentReleases.version, input.version)
      )
    )
  if (existing && existing.id !== input.exceptId) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A release with that version, channel, and platform already exists.",
    })
  }
}

function asReleasePicks(
  rows: Array<{
    version: string
    channel: string
    platform: string
    downloadUrl: string
  }>
): AgentReleasePick[] {
  return rows.map((row) => ({
    version: row.version,
    channel: row.channel as AgentChannel,
    platform: row.platform as AgentReleasePick["platform"],
    downloadUrl: row.downloadUrl,
  }))
}

async function loadReleasePicks(ctx: ApiContext) {
  const rows = await ctx.db
    .select({
      version: agentReleases.version,
      channel: agentReleases.channel,
      platform: agentReleases.platform,
      downloadUrl: agentReleases.downloadUrl,
    })
    .from(agentReleases)
  return asReleasePicks(rows)
}

export const fleetRouter = createTRPCRouter({
  overview: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = deviceScopeCondition(ctx.actor)
    if (scope.kind === "none") {
      return {
        deviceCount: 0,
        reportingCount: 0,
        behindCount: 0,
        pendingCommandCount: 0,
        versions: [] as Array<{
          version: string
          count: number
          behind: boolean
        }>,
        channels: [] as Array<{
          organizationId: string
          organizationName: string
          channel: AgentChannel
        }>,
        sites: [] as Array<{
          id: string
          name: string
          organizationId: string
          organizationName: string
          channel: AgentChannel | null
          effectiveChannel: AgentChannel
        }>,
      }
    }

    const releases = await loadReleasePicks(ctx)
    const deviceWhere = scope.kind === "where" ? scope.condition : undefined

    const deviceRows = await ctx.db
      .select({
        id: devices.id,
        agentVersion: devices.agentVersion,
        osFamily: devices.osFamily,
        organizationChannel: organizations.agentChannel,
        siteChannel: sites.agentChannel,
      })
      .from(devices)
      .innerJoin(organizations, eq(organizations.id, devices.organizationId))
      .leftJoin(sites, eq(sites.id, devices.siteId))
      .where(deviceWhere)

    const versionCounts = new Map<string, number>()
    let reportingCount = 0
    let behindCount = 0

    for (const row of deviceRows) {
      if (row.agentVersion) {
        reportingCount += 1
        versionCounts.set(
          row.agentVersion,
          (versionCounts.get(row.agentVersion) ?? 0) + 1
        )
      }
      const channel = resolveAgentChannel(
        row.siteChannel,
        row.organizationChannel
      )
      const desired = pickDesiredRelease(
        releases,
        channel,
        normalizeAgentPlatform(row.osFamily)
      )
      if (desired && isAgentBehind(row.agentVersion, desired.version)) {
        behindCount += 1
      }
    }

    const versions = [...versionCounts.entries()]
      .map(([version, count]) => ({
        version,
        count,
        behind: releases.some((release) =>
          isAgentBehind(version, release.version)
        ),
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.version.localeCompare(right.version)
      )

    const pendingWhere = combineConditions([
      eq(deviceCommands.status, "pending"),
      deviceWhere,
    ])
    const [pendingRow] = await ctx.db
      .select({ total: count() })
      .from(deviceCommands)
      .innerJoin(devices, eq(devices.id, deviceCommands.deviceId))
      .leftJoin(sites, eq(sites.id, devices.siteId))
      .where(pendingWhere.length > 0 ? and(...pendingWhere) : undefined)

    const organizationIds = actorOrganizationIds(ctx.actor)
    const orgQuery = ctx.db
      .select({
        id: organizations.id,
        name: organizations.name,
        channel: organizations.agentChannel,
      })
      .from(organizations)
    const orgRows =
      organizationIds === null
        ? await orgQuery.orderBy(organizations.name)
        : organizationIds.length === 0
          ? []
          : await orgQuery
              .where(inArray(organizations.id, organizationIds))
              .orderBy(organizations.name)

    const siteQuery = ctx.db
      .select({
        id: sites.id,
        name: sites.name,
        organizationId: sites.organizationId,
        organizationName: organizations.name,
        channel: sites.agentChannel,
        organizationChannel: organizations.agentChannel,
      })
      .from(sites)
      .innerJoin(organizations, eq(organizations.id, sites.organizationId))
    const siteRows =
      organizationIds === null
        ? await siteQuery.orderBy(sites.name)
        : organizationIds.length === 0
          ? []
          : await siteQuery
              .where(inArray(sites.organizationId, organizationIds))
              .orderBy(sites.name)

    return {
      deviceCount: deviceRows.length,
      reportingCount,
      behindCount,
      pendingCommandCount: Number(pendingRow?.total ?? 0),
      versions,
      channels: orgRows.map((row) => ({
        organizationId: row.id,
        organizationName: row.name,
        channel: (row.channel ?? DEFAULT_AGENT_CHANNEL) as AgentChannel,
      })),
      sites: siteRows.map((row) => ({
        id: row.id,
        name: row.name,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        channel: row.channel,
        effectiveChannel: resolveAgentChannel(
          row.channel,
          row.organizationChannel
        ),
      })),
    }
  }),
  releases: permissionProcedure("device:view").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(agentReleases)
      .orderBy(desc(agentReleases.createdAt))
    return rows.map(publicRelease)
  }),
  createRelease: adminProcedure
    .input(releaseCreateInput)
    .mutation(async ({ ctx, input }) => {
      assertPlatformAdministrator(ctx.actor)
      await assertReleaseUnique(ctx, {
        channel: input.channel,
        platform: input.platform,
        version: input.version,
      })
      const [record] = await ctx.db
        .insert(agentReleases)
        .values({
          platform: input.platform,
          version: input.version,
          channel: input.channel,
          downloadUrl: input.downloadUrl,
          sha256: input.sha256.toLowerCase(),
          notes: input.notes?.trim() ? input.notes.trim() : null,
          createdByUserId: ctx.actor?.id ?? null,
          updatedAt: new Date(),
        })
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "agent_release_created",
        eventData: {
          releaseId: record.id,
          version: record.version,
          channel: record.channel,
          platform: record.platform,
        },
      })

      return publicRelease(record)
    }),
  updateRelease: adminProcedure
    .input(releaseUpdateInput)
    .mutation(async ({ ctx, input }) => {
      assertPlatformAdministrator(ctx.actor)
      const [existing] = await ctx.db
        .select({ id: agentReleases.id })
        .from(agentReleases)
        .where(eq(agentReleases.id, input.id))
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      await assertReleaseUnique(ctx, {
        channel: input.channel,
        platform: input.platform,
        version: input.version,
        exceptId: input.id,
      })

      const [record] = await ctx.db
        .update(agentReleases)
        .set({
          platform: input.platform,
          version: input.version,
          channel: input.channel,
          downloadUrl: input.downloadUrl,
          sha256: input.sha256.toLowerCase(),
          notes: input.notes?.trim() ? input.notes.trim() : null,
          updatedAt: new Date(),
        })
        .where(eq(agentReleases.id, input.id))
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "agent_release_updated",
        eventData: {
          releaseId: record.id,
          version: record.version,
          channel: record.channel,
          platform: record.platform,
        },
      })

      return publicRelease(record)
    }),
  deleteRelease: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertPlatformAdministrator(ctx.actor)
      const [existing] = await ctx.db
        .select()
        .from(agentReleases)
        .where(eq(agentReleases.id, input.id))
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      await ctx.db.delete(agentReleases).where(eq(agentReleases.id, input.id))

      await writeAuditEvent(ctx, {
        eventType: "agent_release_deleted",
        eventData: {
          releaseId: existing.id,
          version: existing.version,
          channel: existing.channel,
          platform: existing.platform,
        },
      })

      return { id: existing.id }
    }),
  setOrganizationChannel: adminProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        channel: agentChannelSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })

      const [existing] = await ctx.db
        .select({ id: organizations.id, channel: organizations.agentChannel })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      const [record] = await ctx.db
        .update(organizations)
        .set({ agentChannel: input.channel })
        .where(eq(organizations.id, input.organizationId))
        .returning()

      await writeAuditEvent(ctx, {
        organizationId: input.organizationId,
        eventType: "agent_channel_updated",
        eventData: {
          scope: "organization",
          channel: input.channel,
        },
      })

      return {
        organizationId: record.id,
        channel: record.agentChannel,
      }
    }),
  setSiteChannel: adminProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        channel: agentChannelSchema.nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [site] = await ctx.db
        .select({
          id: sites.id,
          organizationId: sites.organizationId,
        })
        .from(sites)
        .where(eq(sites.id, input.siteId))
      if (!site) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      assertAuthorized(ctx.actor, "site:admin", {
        kind: "organization",
        organizationId: site.organizationId,
      })

      const [record] = await ctx.db
        .update(sites)
        .set({ agentChannel: input.channel })
        .where(eq(sites.id, input.siteId))
        .returning()

      await writeAuditEvent(ctx, {
        organizationId: site.organizationId,
        eventType: "agent_channel_updated",
        eventData: {
          scope: "site",
          siteId: site.id,
          channel: input.channel,
        },
      })

      return {
        siteId: record.id,
        channel: record.agentChannel,
        effectiveChannel: resolveAgentChannel(
          record.agentChannel,
          (
            await ctx.db
              .select({ channel: organizations.agentChannel })
              .from(organizations)
              .where(eq(organizations.id, site.organizationId))
          )[0]?.channel
        ),
      }
    }),
  enqueueCommand: permissionProcedure("device:update")
    .input(
      z.object({
        deviceId: z.string().uuid(),
        kind: z.enum(agentCommandKinds),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isAgentCommandKind(input.kind)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That action is not allowed.",
        })
      }

      const [device] = await ctx.db
        .select({
          id: devices.id,
          organizationId: devices.organizationId,
          siteId: devices.siteId,
          displayName: devices.displayName,
        })
        .from(devices)
        .where(eq(devices.id, input.deviceId))
      if (!device) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })

      const open = await ctx.db
        .select({
          id: deviceCommands.id,
          kind: deviceCommands.kind,
          status: deviceCommands.status,
        })
        .from(deviceCommands)
        .where(
          and(
            eq(deviceCommands.deviceId, device.id),
            inArray(deviceCommands.status, ["pending", "sent"])
          )
        )

      if (hasOpenCommandOfKind(open, input.kind as AgentCommandKind)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${agentCommandKindLabels[input.kind]} is already waiting for this device.`,
        })
      }

      const [record] = await ctx.db
        .insert(deviceCommands)
        .values({
          deviceId: device.id,
          kind: input.kind,
          status: "pending",
          createdByUserId: ctx.actor?.id ?? null,
        })
        .returning()

      await writeAuditEvent(ctx, {
        organizationId: device.organizationId,
        deviceId: device.id,
        eventType: "device_command_enqueued",
        eventData: {
          commandId: record.id,
          kind: record.kind,
          deviceName: device.displayName,
        },
      })

      return {
        id: record.id,
        kind: record.kind,
        status: record.status,
        createdAt: record.createdAt,
      }
    }),
  devices: permissionProcedure("device:view")
    .input(
      z
        .object({
          behindOnly: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const scope = deviceScopeCondition(ctx.actor)
      if (scope.kind === "none") {
        return []
      }
      const releases = await loadReleasePicks(ctx)
      const rows = await ctx.db
        .select({
          id: devices.id,
          displayName: devices.displayName,
          hostname: devices.hostname,
          siteName: sites.name,
          osFamily: devices.osFamily,
          agentVersion: devices.agentVersion,
          organizationChannel: organizations.agentChannel,
          siteChannel: sites.agentChannel,
          status: devices.status,
        })
        .from(devices)
        .innerJoin(organizations, eq(organizations.id, devices.organizationId))
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .where(scope.kind === "where" ? scope.condition : undefined)
        .orderBy(devices.displayName)

      const mapped = rows.map((row) => {
        const channel = resolveAgentChannel(
          row.siteChannel,
          row.organizationChannel
        )
        const desired = pickDesiredRelease(
          releases,
          channel,
          normalizeAgentPlatform(row.osFamily)
        )
        const behind = Boolean(
          desired && isAgentBehind(row.agentVersion, desired.version)
        )
        return {
          id: row.id,
          displayName: row.displayName,
          hostname: row.hostname,
          siteName: row.siteName,
          osFamily: row.osFamily,
          agentVersion: row.agentVersion,
          channel,
          desiredVersion: desired?.version ?? null,
          behind,
        }
      })

      return input?.behindOnly ? mapped.filter((row) => row.behind) : mapped
    }),
  commands: permissionProcedure("device:view")
    .input(z.object({ deviceId: z.string().uuid() }))
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
          id: deviceCommands.id,
          kind: deviceCommands.kind,
          status: deviceCommands.status,
          createdAt: deviceCommands.createdAt,
          sentAt: deviceCommands.sentAt,
          completedAt: deviceCommands.completedAt,
          resultDetail: deviceCommands.resultDetail,
        })
        .from(deviceCommands)
        .where(eq(deviceCommands.deviceId, input.deviceId))
        .orderBy(desc(deviceCommands.createdAt))
        .limit(25)

      return rows
    }),
})
