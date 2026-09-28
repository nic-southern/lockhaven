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
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import {
  assets,
  customFieldDefinitions,
  deviceModels,
  devices,
  organizations,
  sites,
  vpnIdentities,
} from "@nms/db"
import {
  assertCanAttachChild,
  assertCanDetachChild,
  assetFolderKindSchema,
  assetFolderKinds,
  assetFolderKindLabels,
  assetStatusLabels,
  assetStatusSchema,
  childSiteFromFolder,
  customFieldValuesSchema,
  deriveConnectivity,
  folderKindLabel,
  isFolderAsset,
  parseAssetBulkCsv,
  resolveAssetLifecycle,
  retireAfterMonthsSchema,
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
  parentAssetId: z.string().uuid().nullable().optional(),
  folderKind: assetFolderKindSchema.nullable().optional(),
  deviceModelId: z.string().uuid().nullable().optional(),
  tag: z.string().trim().min(1).max(80),
  vendor: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  serial: z.string().trim().max(120).nullable().optional(),
  hostname: z.string().trim().max(253).nullable().optional(),
  status: assetStatusSchema.optional(),
  purchaseDate: isoDateInput,
  purchaseCost: moneySchema,
  warrantyExpiresOn: isoDateInput,
  retireAfterMonths: retireAfterMonthsSchema,
  retireOn: isoDateInput,
  notes: z.string().trim().max(4000).nullable().optional(),
  customFields: customFieldValuesSchema.optional(),
})

const parentAssets = alias(assets, "parent_assets")

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function resolveDeviceModel(
  ctx: ApiContext,
  organizationId: string,
  deviceModelId: string | null | undefined
) {
  if (!deviceModelId) return null
  const [record] = await ctx.db
    .select()
    .from(deviceModels)
    .where(
      and(
        eq(deviceModels.id, deviceModelId),
        eq(deviceModels.organizationId, organizationId)
      )
    )
  if (!record) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That device model was not found.",
    })
  }
  return record
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
    deviceModelName?: string | null
    deviceModelManufacturer?: string | null
    deviceModelCode?: string | null
    modelDefaultPurchaseDate?: string | null
    modelRetireAfterMonths?: number | null
    parentTag?: string | null
    parentFolderKind?: string | null
  }
) {
  const linked = Boolean(extras.deviceId)
  const lifecycle = resolveAssetLifecycle(
    {
      status: row.status,
      purchaseDate: row.purchaseDate,
      retireAfterMonths: row.retireAfterMonths,
      retireOn: row.retireOn,
      modelDefaultPurchaseDate: extras.modelDefaultPurchaseDate ?? null,
      modelRetireAfterMonths: extras.modelRetireAfterMonths ?? null,
    },
    new Date()
  )
  return {
    ...row,
    siteName: extras.siteName,
    organizationName: extras.organizationName,
    deviceId: extras.deviceId,
    deviceName: extras.deviceName,
    deviceModelName: extras.deviceModelName ?? null,
    deviceModelManufacturer: extras.deviceModelManufacturer ?? null,
    deviceModelCode: extras.deviceModelCode ?? null,
    modelDefaultPurchaseDate: extras.modelDefaultPurchaseDate ?? null,
    modelRetireAfterMonths: extras.modelRetireAfterMonths ?? null,
    parentTag: extras.parentTag ?? null,
    parentFolderKind: extras.parentFolderKind ?? null,
    parentFolderLabel: extras.parentFolderKind
      ? folderKindLabel(extras.parentFolderKind)
      : null,
    folderLabel: row.folderKind ? folderKindLabel(row.folderKind) : null,
    isFolder: isFolderAsset(row),
    managed: linked,
    presence: linked ? "managed" : "unmanaged",
    connectivity: linked
      ? deriveConnectivity({
          lastHandshakeAt: extras.lastHandshakeAt ?? extras.lastSeenAt,
          revokedAt: extras.vpnRevokedAt,
        })
      : null,
    warranty: warrantyState(row.warrantyExpiresOn, new Date()),
    lifecycle,
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
      deviceModelName: deviceModels.name,
      deviceModelManufacturer: deviceModels.manufacturer,
      deviceModelCode: deviceModels.model,
      modelDefaultPurchaseDate: deviceModels.defaultPurchaseDate,
      modelRetireAfterMonths: deviceModels.retireAfterMonths,
      parentTag: parentAssets.tag,
      parentFolderKind: parentAssets.folderKind,
    })
    .from(assets)
    .innerJoin(organizations, eq(organizations.id, assets.organizationId))
    .leftJoin(sites, eq(sites.id, assets.siteId))
    .leftJoin(deviceModels, eq(deviceModels.id, assets.deviceModelId))
    .leftJoin(devices, eq(devices.assetId, assets.id))
    .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
    .leftJoin(parentAssets, eq(parentAssets.id, assets.parentAssetId))
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

function rowExtras(row: {
  siteName: string | null
  organizationName: string | null
  deviceId: string | null
  deviceName: string | null
  lastHandshakeAt: Date | null
  lastSeenAt: Date | null
  vpnRevokedAt: Date | null
  deviceModelName: string | null
  deviceModelManufacturer: string | null
  deviceModelCode: string | null
  modelDefaultPurchaseDate: string | null
  modelRetireAfterMonths: number | null
  parentTag: string | null
  parentFolderKind: string | null
}) {
  return {
    siteName: row.siteName,
    organizationName: row.organizationName,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    lastHandshakeAt: row.lastHandshakeAt,
    lastSeenAt: row.lastSeenAt,
    vpnRevokedAt: row.vpnRevokedAt,
    deviceModelName: row.deviceModelName,
    deviceModelManufacturer: row.deviceModelManufacturer,
    deviceModelCode: row.deviceModelCode,
    modelDefaultPurchaseDate: row.modelDefaultPurchaseDate,
    modelRetireAfterMonths: row.modelRetireAfterMonths,
    parentTag: row.parentTag,
    parentFolderKind: row.parentFolderKind,
  }
}

async function loadFolderOrThrow(ctx: ApiContext, id: string) {
  const record = await loadAsset(ctx, id)
  if (!isFolderAsset(record)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That asset is not a folder.",
    })
  }
  return record
}

/**
 * When a folder moves sites: children inherit the site, and the VPN device
 * linked 1:1 to the folder moves with it.
 */
async function cascadeFolderSiteMove(
  ctx: ApiContext,
  folder: { id: string; siteId: string | null },
  siteId: string | null
) {
  await ctx.db
    .update(assets)
    .set({ siteId, updatedAt: new Date() })
    .where(eq(assets.parentAssetId, folder.id))
  await ctx.db
    .update(devices)
    .set({ siteId, updatedAt: new Date() })
    .where(eq(devices.assetId, folder.id))
}

async function attachChildToFolder(
  ctx: ApiContext,
  parent: typeof assets.$inferSelect,
  child: typeof assets.$inferSelect
) {
  const decision = assertCanAttachChild({
    parent: {
      id: parent.id,
      organizationId: parent.organizationId,
      folderKind: parent.folderKind,
      parentAssetId: parent.parentAssetId,
    },
    child: {
      id: child.id,
      organizationId: child.organizationId,
      folderKind: child.folderKind,
      parentAssetId: child.parentAssetId,
    },
  })
  if (!decision.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: decision.message })
  }
  const sitePatch = childSiteFromFolder(parent.siteId)
  const [record] = await ctx.db
    .update(assets)
    .set({
      parentAssetId: parent.id,
      siteId: sitePatch.siteId,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, child.id))
    .returning()
  return record
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
        query.filters.id?.length
          ? inArray(assets.id, query.filters.id)
          : undefined,
        query.search
          ? or(
              ilike(assets.tag, likePattern(query.search)),
              ilike(assets.vendor, likePattern(query.search)),
              ilike(assets.model, likePattern(query.search)),
              ilike(assets.serial, likePattern(query.search)),
              ilike(assets.hostname, likePattern(query.search)),
              ilike(sites.name, likePattern(query.search)),
              ilike(deviceModels.name, likePattern(query.search))
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
      const folderKindFilter = query.filters.folderKind
      if (folderKindFilter?.length) {
        const foldersOnly = folderKindFilter.includes("folder")
        const itemsOnly = folderKindFilter.includes("item")
        const kinds = folderKindFilter.filter(
          (value) => value !== "folder" && value !== "item"
        )
        if (foldersOnly && !itemsOnly && kinds.length === 0) {
          conditions.push(isNotNull(assets.folderKind))
        } else if (itemsOnly && !foldersOnly && kinds.length === 0) {
          conditions.push(isNull(assets.folderKind))
        } else if (kinds.length > 0) {
          conditions.push(inArray(assets.folderKind, kinds))
        }
      }
      const parentFilter = query.filters.parentAssetId
      if (parentFilter?.length) {
        const none = parentFilter.includes("none")
        const ids = parentFilter.filter((value) => value !== "none")
        if (none && ids.length > 0) {
          const mixed = or(
            isNull(assets.parentAssetId),
            inArray(assets.parentAssetId, ids)
          )
          if (mixed) conditions.push(mixed)
        } else if (none) {
          conditions.push(isNull(assets.parentAssetId))
        } else {
          conditions.push(inArray(assets.parentAssetId, ids))
        }
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
          .leftJoin(deviceModels, eq(deviceModels.id, assets.deviceModelId))
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
        rows.map((row) => publicAsset(row.asset, rowExtras(row))),
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
    return rows.map((row) => publicAsset(row.asset, rowExtras(row)))
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
        ...publicAsset(row.asset, rowExtras(row)),
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
      const catalog = await resolveDeviceModel(
        ctx,
        input.organizationId,
        input.deviceModelId
      )

      let parentAssetId: string | null = null
      let siteId = input.siteId ?? null
      const folderKind = emptyToNull(input.folderKind) as string | null

      if (input.parentAssetId) {
        if (folderKind) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A folder cannot be placed inside another folder.",
          })
        }
        const parent = await loadFolderOrThrow(ctx, input.parentAssetId)
        if (parent.organizationId !== input.organizationId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That folder belongs to a different organization.",
          })
        }
        parentAssetId = parent.id
        siteId = childSiteFromFolder(parent.siteId).siteId
      }

      try {
        const [record] = await ctx.db
          .insert(assets)
          .values({
            organizationId: input.organizationId,
            siteId,
            parentAssetId,
            folderKind,
            deviceModelId: catalog?.id ?? null,
            tag: input.tag.trim(),
            vendor: catalog
              ? emptyToNull(catalog.manufacturer)
              : emptyToNull(input.vendor),
            model: catalog ? catalog.model : emptyToNull(input.model),
            serial: emptyToNull(input.serial),
            hostname: emptyToNull(input.hostname),
            status: input.status ?? "stock",
            purchaseDate: input.purchaseDate ?? null,
            purchaseCost: input.purchaseCost ?? null,
            warrantyExpiresOn: input.warrantyExpiresOn ?? null,
            retireAfterMonths: input.retireAfterMonths ?? null,
            retireOn: input.retireOn ?? null,
            notes: emptyToNull(input.notes),
            customFields: input.customFields ?? {},
          })
          .returning()

        await writeAuditEvent(ctx, {
          eventType: "asset_created",
          organizationId: record.organizationId,
          siteId: record.siteId,
          eventData: {
            assetId: record.id,
            tag: record.tag,
            folderKind: record.folderKind,
            parentAssetId: record.parentAssetId,
          },
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
  createFolder: permissionProcedure("device:update")
    .input(
      assetWriteInput.omit({ parentAssetId: true, folderKind: true }).extend({
        folderKind: assetFolderKindSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: input.organizationId,
        siteId: input.siteId ?? null,
      })
      await assertSiteInOrganization(ctx, input.siteId, input.organizationId)
      const catalog = await resolveDeviceModel(
        ctx,
        input.organizationId,
        input.deviceModelId
      )

      try {
        const [record] = await ctx.db
          .insert(assets)
          .values({
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            parentAssetId: null,
            folderKind: input.folderKind,
            deviceModelId: catalog?.id ?? null,
            tag: input.tag.trim(),
            vendor: catalog
              ? emptyToNull(catalog.manufacturer)
              : emptyToNull(input.vendor),
            model: catalog ? catalog.model : emptyToNull(input.model),
            serial: emptyToNull(input.serial),
            hostname: emptyToNull(input.hostname),
            status: input.status ?? "stock",
            purchaseDate: input.purchaseDate ?? null,
            purchaseCost: input.purchaseCost ?? null,
            warrantyExpiresOn: input.warrantyExpiresOn ?? null,
            retireAfterMonths: input.retireAfterMonths ?? null,
            retireOn: input.retireOn ?? null,
            notes: emptyToNull(input.notes),
            customFields: input.customFields ?? {},
          })
          .returning()

        await writeAuditEvent(ctx, {
          eventType: "asset_created",
          organizationId: record.organizationId,
          siteId: record.siteId,
          eventData: {
            assetId: record.id,
            tag: record.tag,
            folderKind: record.folderKind,
            folder: true,
          },
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
  children: permissionProcedure("device:view")
    .input(z.object({ parentAssetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const parent = await loadAsset(ctx, input.parentAssetId)
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: parent.organizationId,
        siteId: parent.siteId,
      })
      const rows = await assetBase(ctx)
        .where(eq(assets.parentAssetId, parent.id))
        .orderBy(desc(assets.createdAt))
      return rows.map((row) => publicAsset(row.asset, rowExtras(row)))
    }),
  addChild: permissionProcedure("device:update")
    .input(
      z.object({
        parentAssetId: z.string().uuid(),
        childAssetId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const parent = await loadFolderOrThrow(ctx, input.parentAssetId)
      const child = await loadAsset(ctx, input.childAssetId)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: parent.organizationId,
        siteId: parent.siteId,
      })
      const record = await attachChildToFolder(ctx, parent, child)
      await writeAuditEvent(ctx, {
        eventType: "asset_updated",
        organizationId: parent.organizationId,
        siteId: record.siteId,
        eventData: {
          assetId: record.id,
          tag: record.tag,
          parentAssetId: parent.id,
          action: "attach_child",
        },
      })
      return record
    }),
  removeChild: permissionProcedure("device:update")
    .input(z.object({ childAssetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const child = await loadAsset(ctx, input.childAssetId)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: child.organizationId,
        siteId: child.siteId,
      })
      const decision = assertCanDetachChild({
        child: {
          id: child.id,
          organizationId: child.organizationId,
          folderKind: child.folderKind,
          parentAssetId: child.parentAssetId,
        },
      })
      if (!decision.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: decision.message })
      }
      const previousParentId = child.parentAssetId
      const [record] = await ctx.db
        .update(assets)
        .set({ parentAssetId: null, updatedAt: new Date() })
        .where(eq(assets.id, child.id))
        .returning()
      await writeAuditEvent(ctx, {
        eventType: "asset_updated",
        organizationId: child.organizationId,
        siteId: record.siteId,
        eventData: {
          assetId: record.id,
          tag: record.tag,
          previousParentAssetId: previousParentId,
          action: "detach_child",
        },
      })
      return record
    }),
  setParent: permissionProcedure("device:update")
    .input(
      z.object({
        childAssetId: z.string().uuid(),
        parentAssetId: z.string().uuid().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const child = await loadAsset(ctx, input.childAssetId)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: child.organizationId,
        siteId: child.siteId,
      })
      if (input.parentAssetId === null) {
        const decision = assertCanDetachChild({
          child: {
            id: child.id,
            organizationId: child.organizationId,
            folderKind: child.folderKind,
            parentAssetId: child.parentAssetId,
          },
        })
        if (!decision.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: decision.message,
          })
        }
        const [record] = await ctx.db
          .update(assets)
          .set({ parentAssetId: null, updatedAt: new Date() })
          .where(eq(assets.id, child.id))
          .returning()
        await writeAuditEvent(ctx, {
          eventType: "asset_updated",
          organizationId: child.organizationId,
          siteId: record.siteId,
          eventData: {
            assetId: record.id,
            tag: record.tag,
            previousParentAssetId: child.parentAssetId,
            action: "detach_child",
          },
        })
        return record
      }
      const parent = await loadFolderOrThrow(ctx, input.parentAssetId)
      const record = await attachChildToFolder(ctx, parent, child)
      await writeAuditEvent(ctx, {
        eventType: "asset_updated",
        organizationId: parent.organizationId,
        siteId: record.siteId,
        eventData: {
          assetId: record.id,
          tag: record.tag,
          parentAssetId: parent.id,
          previousParentAssetId: child.parentAssetId,
          action: "reparent_child",
        },
      })
      return record
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

      const catalog =
        input.deviceModelId !== undefined
          ? await resolveDeviceModel(
              ctx,
              existing.organizationId,
              input.deviceModelId
            )
          : undefined

      if (input.folderKind !== undefined) {
        const nextKind = emptyToNull(input.folderKind)
        if (nextKind && existing.parentAssetId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "An item inside a folder cannot become a folder.",
          })
        }
        if (!nextKind && isFolderAsset(existing)) {
          const [child] = await ctx.db
            .select({ id: assets.id })
            .from(assets)
            .where(eq(assets.parentAssetId, existing.id))
            .limit(1)
          if (child) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Remove contents before clearing the folder type.",
            })
          }
        }
      }

      if (input.parentAssetId !== undefined) {
        if (input.parentAssetId === null) {
          if (existing.parentAssetId) {
            const decision = assertCanDetachChild({
              child: {
                id: existing.id,
                organizationId: existing.organizationId,
                folderKind: existing.folderKind,
                parentAssetId: existing.parentAssetId,
              },
            })
            if (!decision.ok) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: decision.message,
              })
            }
          }
        } else {
          const parent = await loadFolderOrThrow(ctx, input.parentAssetId)
          const decision = assertCanAttachChild({
            parent: {
              id: parent.id,
              organizationId: parent.organizationId,
              folderKind: parent.folderKind,
              parentAssetId: parent.parentAssetId,
            },
            child: {
              id: existing.id,
              organizationId: existing.organizationId,
              folderKind:
                input.folderKind !== undefined
                  ? emptyToNull(input.folderKind)
                  : existing.folderKind,
              parentAssetId: existing.parentAssetId,
            },
          })
          if (!decision.ok) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: decision.message,
            })
          }
        }
      }

      const patch: Partial<typeof assets.$inferInsert> = {
        updatedAt: new Date(),
      }
      if (input.tag !== undefined) patch.tag = input.tag.trim()
      if (input.deviceModelId !== undefined) {
        patch.deviceModelId = catalog?.id ?? null
        if (catalog) {
          patch.vendor = emptyToNull(catalog.manufacturer)
          patch.model = catalog.model
        }
      }
      if (input.vendor !== undefined && catalog === undefined) {
        patch.vendor = emptyToNull(input.vendor)
      }
      if (input.model !== undefined && catalog === undefined) {
        patch.model = emptyToNull(input.model)
      }
      if (input.serial !== undefined) patch.serial = emptyToNull(input.serial)
      if (input.hostname !== undefined) {
        patch.hostname = emptyToNull(input.hostname)
      }
      if (input.status !== undefined) patch.status = input.status
      if (input.siteId !== undefined) patch.siteId = input.siteId
      if (input.folderKind !== undefined) {
        patch.folderKind = emptyToNull(input.folderKind)
      }
      if (input.parentAssetId !== undefined) {
        patch.parentAssetId = input.parentAssetId
        if (input.parentAssetId) {
          const parent = await loadFolderOrThrow(ctx, input.parentAssetId)
          patch.siteId = childSiteFromFolder(parent.siteId).siteId
        }
      }
      if (input.purchaseDate !== undefined) {
        patch.purchaseDate = input.purchaseDate
      }
      if (input.purchaseCost !== undefined) {
        patch.purchaseCost = input.purchaseCost
      }
      if (input.warrantyExpiresOn !== undefined) {
        patch.warrantyExpiresOn = input.warrantyExpiresOn
      }
      if (input.retireAfterMonths !== undefined) {
        patch.retireAfterMonths = input.retireAfterMonths
      }
      if (input.retireOn !== undefined) {
        patch.retireOn = input.retireOn
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

        const siteChanged =
          input.siteId !== undefined && input.siteId !== existing.siteId
        if (siteChanged && isFolderAsset(record)) {
          await cascadeFolderSiteMove(ctx, record, record.siteId)
        }

        await writeAuditEvent(ctx, {
          eventType: "asset_updated",
          organizationId: existing.organizationId,
          siteId: record.siteId,
          eventData: {
            assetId: record.id,
            tag: record.tag,
            folderKind: record.folderKind,
            parentAssetId: record.parentAssetId,
            siteChanged,
          },
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
  folderKindLabels: permissionProcedure("device:view").query(() => ({
    ...Object.fromEntries(
      assetFolderKinds.map((kind) => [kind, assetFolderKindLabels[kind]])
    ),
  })),
})
