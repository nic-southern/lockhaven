import { TRPCError } from "@trpc/server"
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import {
  assets,
  customFieldDefinitions,
  devices,
  organizations,
  sites,
  vpnIdentities,
} from "@nms/db"
import {
  assetStatusLabels,
  assetStatusSchema,
  customFieldValuesSchema,
  deriveConnectivity,
  parseAssetBulkCsv,
  warrantyState,
  type AssetStatus,
} from "@nms/shared"

import { assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { siteBelongsToOrganization } from "../helpers"
import {
  buildOrderBy,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
} from "../list"
import { combineConditions, inventoryScopeCondition } from "../scope"
import { createTRPCRouter, permissionProcedure } from "../trpc"

const moneySchema = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, "Cost must be a number.")
  .nullable()
  .optional()

const isoDateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional()

const assetWriteInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().nullable().optional(),
  tag: z.string().trim().min(1).max(80),
  vendor: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  serial: z.string().trim().max(120).nullable().optional(),
  hostname: z.string().trim().max(253).nullable().optional(),
  status: assetStatusSchema.optional(),
  purchaseDate: isoDateInput,
  purchaseCost: moneySchema,
  warrantyExpiresOn: isoDateInput,
  notes: z.string().trim().max(4000).nullable().optional(),
  customFields: customFieldValuesSchema.optional(),
})

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function assetScope(actor: ApiContext["actor"]) {
  return inventoryScopeCondition(actor, {
    organizationId: assets.organizationId,
    siteId: assets.siteId,
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

async function loadAsset(ctx: ApiContext, id: string) {
  const [record] = await ctx.db.select().from(assets).where(eq(assets.id, id))
  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  return record
}

function publicAsset(
  row: typeof assets.$inferSelect,
  extras: {
    siteName: string | null
    organizationName: string | null
    deviceId: string | null
    deviceName: string | null
    lastHandshakeAt: Date | null
    lastSeenAt: Date | null
    vpnRevokedAt: Date | null
  }
) {
  const linked = Boolean(extras.deviceId)
  return {
    ...row,
    siteName: extras.siteName,
    organizationName: extras.organizationName,
    deviceId: extras.deviceId,
    deviceName: extras.deviceName,
    managed: linked,
    presence: linked ? "managed" : "unmanaged",
    connectivity: linked
      ? deriveConnectivity({
          lastHandshakeAt: extras.lastHandshakeAt ?? extras.lastSeenAt,
          revokedAt: extras.vpnRevokedAt,
        })
      : null,
    warranty: warrantyState(row.warrantyExpiresOn, new Date()),
  }
}

function assetBase(ctx: ApiContext) {
  return ctx.db
    .select({
      asset: assets,
      siteName: sites.name,
      organizationName: organizations.name,
      deviceId: devices.id,
      deviceName: devices.displayName,
      lastSeenAt: devices.lastSeenAt,
      lastHandshakeAt: vpnIdentities.lastHandshakeAt,
      vpnRevokedAt: vpnIdentities.revokedAt,
    })
    .from(assets)
    .innerJoin(organizations, eq(organizations.id, assets.organizationId))
    .leftJoin(sites, eq(sites.id, assets.siteId))
    .leftJoin(devices, eq(devices.assetId, assets.id))
    .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
}

async function resolveSiteRef(
  ctx: ApiContext,
  organizationId: string,
  site: string | null
) {
  if (!site) return null
  if (/^[0-9a-f-]{36}$/i.test(site)) {
    await assertSiteInOrganization(ctx, site, organizationId)
    return site
  }
  const [match] = await ctx.db
    .select({ id: sites.id })
    .from(sites)
    .where(
      and(eq(sites.organizationId, organizationId), ilike(sites.name, site))
    )
    .limit(1)
  return match?.id ?? null
}

async function loadDefinitions(ctx: ApiContext, organizationId: string) {
  return ctx.db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.organizationId, organizationId))
}

export const assetsRouter = createTRPCRouter({
  page: permissionProcedure("device:view")
    .input(listQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(input, { defaultLimit: 50 })
      const scope = assetScope(ctx.actor)
      if (scope.kind === "none") {
        return paginate([], query, 0)
      }

      const conditions = combineConditions([
        scope.kind === "where" ? scope.condition : undefined,
        query.search
          ? or(
              ilike(assets.tag, likePattern(query.search)),
              ilike(assets.vendor, likePattern(query.search)),
              ilike(assets.model, likePattern(query.search)),
              ilike(assets.serial, likePattern(query.search)),
              ilike(assets.hostname, likePattern(query.search)),
              ilike(sites.name, likePattern(query.search))
            )
          : undefined,
      ])

      const statusFilter = query.filters.status as AssetStatus[] | undefined
      if (statusFilter?.length) {
        conditions.push(inArray(assets.status, statusFilter))
      }
      const siteFilter = query.filters.siteId
      if (siteFilter?.length) {
        const none = siteFilter.includes("none")
        const ids = siteFilter.filter((value) => value !== "none")
        if (none && ids.length > 0) {
          const mixed = or(isNull(assets.siteId), inArray(assets.siteId, ids))
          if (mixed) conditions.push(mixed)
        } else if (none) {
          conditions.push(isNull(assets.siteId))
        } else {
          conditions.push(inArray(assets.siteId, ids))
        }
      }
      if (query.filters.managed?.includes("true")) {
        conditions.push(isNotNull(devices.id))
      } else if (query.filters.managed?.includes("false")) {
        conditions.push(isNull(devices.id))
      }
      if (query.filters.warranty?.includes("expiring")) {
        conditions.push(
          sql`${assets.warrantyExpiresOn} is not null and ${assets.warrantyExpiresOn} <= (current_date + interval '90 days')`
        )
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const sortColumns = {
        tag: assets.tag,
        vendor: assets.vendor,
        model: assets.model,
        serial: assets.serial,
        status: assets.status,
        purchaseDate: assets.purchaseDate,
        warrantyExpiresOn: assets.warrantyExpiresOn,
        createdAt: assets.createdAt,
      }

      const [[totalRow], rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(assets)
          .leftJoin(sites, eq(sites.id, assets.siteId))
          .leftJoin(devices, eq(devices.assetId, assets.id))
          .where(where),
        assetBase(ctx)
          .where(where)
          .orderBy(
            ...buildOrderBy(query.sort, sortColumns, [
              desc(assets.createdAt),
              desc(assets.id),
            ])
          )
          .limit(query.limit + 1)
          .offset(query.offset),
      ])

      return paginate(
        rows.map((row) =>
          publicAsset(row.asset, {
            siteName: row.siteName,
            organizationName: row.organizationName,
            deviceId: row.deviceId,
            deviceName: row.deviceName,
            lastHandshakeAt: row.lastHandshakeAt,
            lastSeenAt: row.lastSeenAt,
            vpnRevokedAt: row.vpnRevokedAt,
          })
        ),
        query,
        Number(totalRow?.total ?? 0)
      )
    }),
  list: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = assetScope(ctx.actor)
    if (scope.kind === "none") return []
    const rows = await assetBase(ctx)
      .where(scope.kind === "where" ? scope.condition : undefined)
      .orderBy(desc(assets.createdAt))
    return rows.map((row) =>
      publicAsset(row.asset, {
        siteName: row.siteName,
        organizationName: row.organizationName,
        deviceId: row.deviceId,
        deviceName: row.deviceName,
        lastHandshakeAt: row.lastHandshakeAt,
        lastSeenAt: row.lastSeenAt,
        vpnRevokedAt: row.vpnRevokedAt,
      })
    )
  }),
  byId: permissionProcedure("device:view")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await assetBase(ctx).where(eq(assets.id, input.id))
      if (!row) return null
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: row.asset.organizationId,
        siteId: row.asset.siteId,
      })
      const definitions = await loadDefinitions(ctx, row.asset.organizationId)
      return {
        ...publicAsset(row.asset, {
          siteName: row.siteName,
          organizationName: row.organizationName,
          deviceId: row.deviceId,
          deviceName: row.deviceName,
          lastHandshakeAt: row.lastHandshakeAt,
          lastSeenAt: row.lastSeenAt,
          vpnRevokedAt: row.vpnRevokedAt,
        }),
        definitions,
      }
    }),
  create: permissionProcedure("device:update")
    .input(assetWriteInput)
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: input.organizationId,
        siteId: input.siteId ?? null,
      })
      await assertSiteInOrganization(ctx, input.siteId, input.organizationId)

      try {
        const [record] = await ctx.db
          .insert(assets)
          .values({
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            tag: input.tag.trim(),
            vendor: emptyToNull(input.vendor),
            model: emptyToNull(input.model),
            serial: emptyToNull(input.serial),
            hostname: emptyToNull(input.hostname),
            status: input.status ?? "stock",
            purchaseDate: input.purchaseDate ?? null,
            purchaseCost: input.purchaseCost ?? null,
            warrantyExpiresOn: input.warrantyExpiresOn ?? null,
            notes: emptyToNull(input.notes),
            customFields: input.customFields ?? {},
          })
          .returning()

        await writeAuditEvent(ctx, {
          eventType: "asset_created",
          organizationId: record.organizationId,
          siteId: record.siteId,
          eventData: { assetId: record.id, tag: record.tag },
        })
        return record
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An asset with that tag or serial already exists.",
          })
        }
        throw error
      }
    }),
  update: permissionProcedure("device:update")
    .input(assetWriteInput.partial().extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadAsset(ctx, input.id)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: existing.organizationId,
        siteId: existing.siteId,
      })
      if (input.siteId !== undefined) {
        await assertSiteInOrganization(
          ctx,
          input.siteId,
          existing.organizationId
        )
      }

      const patch: Partial<typeof assets.$inferInsert> = {
        updatedAt: new Date(),
      }
      if (input.tag !== undefined) patch.tag = input.tag.trim()
      if (input.vendor !== undefined) patch.vendor = emptyToNull(input.vendor)
      if (input.model !== undefined) patch.model = emptyToNull(input.model)
      if (input.serial !== undefined) patch.serial = emptyToNull(input.serial)
      if (input.hostname !== undefined) {
        patch.hostname = emptyToNull(input.hostname)
      }
      if (input.status !== undefined) patch.status = input.status
      if (input.siteId !== undefined) patch.siteId = input.siteId
      if (input.purchaseDate !== undefined) {
        patch.purchaseDate = input.purchaseDate
      }
      if (input.purchaseCost !== undefined) {
        patch.purchaseCost = input.purchaseCost
      }
      if (input.warrantyExpiresOn !== undefined) {
        patch.warrantyExpiresOn = input.warrantyExpiresOn
      }
      if (input.notes !== undefined) patch.notes = emptyToNull(input.notes)
      if (input.customFields !== undefined) {
        patch.customFields = input.customFields
      }

      try {
        const [record] = await ctx.db
          .update(assets)
          .set(patch)
          .where(eq(assets.id, existing.id))
          .returning()
        await writeAuditEvent(ctx, {
          eventType: "asset_updated",
          organizationId: existing.organizationId,
          siteId: record.siteId,
          eventData: { assetId: record.id, tag: record.tag },
        })
        return record
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An asset with that tag or serial already exists.",
          })
        }
        throw error
      }
    }),
  delete: permissionProcedure("device:update")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadAsset(ctx, input.id)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: existing.organizationId,
        siteId: existing.siteId,
      })
      await ctx.db.delete(assets).where(eq(assets.id, existing.id))
      await writeAuditEvent(ctx, {
        eventType: "asset_deleted",
        organizationId: existing.organizationId,
        siteId: existing.siteId,
        eventData: { assetId: existing.id, tag: existing.tag },
      })
      return { id: existing.id }
    }),
  linkDevice: permissionProcedure("device:update")
    .input(
      z.object({
        id: z.string().uuid(),
        deviceId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadAsset(ctx, input.id)
      const [device] = await ctx.db
        .select()
        .from(devices)
        .where(eq(devices.id, input.deviceId))
      if (!device) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      if (device.organizationId !== existing.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That device belongs to a different organization.",
        })
      }
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })
      if (device.assetId && device.assetId !== existing.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That device is already linked to another asset.",
        })
      }

      await ctx.db
        .update(devices)
        .set({ assetId: null, updatedAt: new Date() })
        .where(eq(devices.assetId, existing.id))
      await ctx.db
        .update(devices)
        .set({ assetId: existing.id, updatedAt: new Date() })
        .where(eq(devices.id, device.id))

      await writeAuditEvent(ctx, {
        eventType: "asset_linked",
        organizationId: existing.organizationId,
        siteId: device.siteId,
        deviceId: device.id,
        eventData: {
          assetId: existing.id,
          tag: existing.tag,
          reason: "operator",
        },
      })
      return { id: existing.id, deviceId: device.id }
    }),
  unlinkDevice: permissionProcedure("device:update")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadAsset(ctx, input.id)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: existing.organizationId,
        siteId: existing.siteId,
      })
      const [device] = await ctx.db
        .select({ id: devices.id, siteId: devices.siteId })
        .from(devices)
        .where(eq(devices.assetId, existing.id))
      await ctx.db
        .update(devices)
        .set({ assetId: null, updatedAt: new Date() })
        .where(eq(devices.assetId, existing.id))
      await writeAuditEvent(ctx, {
        eventType: "asset_unlinked",
        organizationId: existing.organizationId,
        siteId: device?.siteId ?? existing.siteId,
        deviceId: device?.id ?? null,
        eventData: { assetId: existing.id, tag: existing.tag },
      })
      return { id: existing.id }
    }),
  importCsv: permissionProcedure("device:update")
    .input(
      z.object({
        organizationId: z.string().uuid(),
        csv: z.string().max(1_000_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "device:update", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      const parsed = parseAssetBulkCsv(input.csv)
      let created = 0
      let updated = 0
      const errors = [...parsed.errors]

      for (const row of parsed.rows) {
        const siteId = await resolveSiteRef(ctx, input.organizationId, row.site)
        if (row.site && !siteId) {
          errors.push({ row: row.row, message: "Site was not found." })
          continue
        }
        const [existing] = await ctx.db
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.organizationId, input.organizationId),
              eq(assets.tag, row.tag)
            )
          )
          .limit(1)

        try {
          if (existing) {
            await ctx.db
              .update(assets)
              .set({
                vendor: row.vendor,
                model: row.model,
                serial: row.serial,
                hostname: row.hostname,
                status: row.status,
                siteId,
                purchaseDate: row.purchaseDate,
                purchaseCost: row.purchaseCost,
                warrantyExpiresOn: row.warrantyExpiresOn,
                notes: row.notes,
                updatedAt: new Date(),
              })
              .where(eq(assets.id, existing.id))
            updated += 1
          } else {
            await ctx.db.insert(assets).values({
              organizationId: input.organizationId,
              siteId,
              tag: row.tag,
              vendor: row.vendor,
              model: row.model,
              serial: row.serial,
              hostname: row.hostname,
              status: row.status,
              purchaseDate: row.purchaseDate,
              purchaseCost: row.purchaseCost,
              warrantyExpiresOn: row.warrantyExpiresOn,
              notes: row.notes,
            })
            created += 1
          }
        } catch {
          errors.push({
            row: row.row,
            message: "That tag or serial is already in use.",
          })
        }
      }

      await writeAuditEvent(ctx, {
        eventType: "inventory_imported",
        organizationId: input.organizationId,
        eventData: {
          kind: "assets",
          created,
          updated,
          errorCount: errors.length,
        },
      })

      return { created, updated, skipped: errors.length, errors }
    }),
  statusLabels: permissionProcedure("device:view").query(
    () => assetStatusLabels
  ),
})
