import { z } from "zod"

import { parseMoney } from "./assets"

/** Suggested annual likelihood presets operators can apply or override. */
export const likelihoodClasses = [
  {
    id: "org_default",
    label: "Organization default",
    aroPerYear: 0.05,
  },
  {
    id: "hardware_failure",
    label: "Hardware failure",
    aroPerYear: 0.08,
  },
  {
    id: "theft_or_loss",
    label: "Theft or loss",
    aroPerYear: 0.02,
  },
  {
    id: "site_incident",
    label: "Site incident",
    aroPerYear: 0.03,
  },
] as const

export type LikelihoodClassId = (typeof likelihoodClasses)[number]["id"]

export const DEFAULT_ARO_PER_YEAR =
  likelihoodClasses.find((entry) => entry.id === "org_default")?.aroPerYear ??
  0.05

export const aroPerYearSchema = z.number().min(0).max(100)

export type AssetValueSource =
  | "model_replacement"
  | "model_purchase"
  | "asset_purchase"
  | null

export type AssetRiskCostInput = {
  modelReplacementCost?: string | null
  modelPurchaseCost?: string | null
  /** Used only when the catalog model has no cost set. */
  assetPurchaseCost?: string | null
}

/**
 * Asset value for expected-loss and installed-value math. Replacement cost on
 * the device model is preferred; model purchase is next; asset purchase is a
 * last-resort fallback when the catalog has no cost. Model costs remain the
 * source of truth.
 */
export function resolveAssetValue(
  input: AssetRiskCostInput
): { amount: string; source: Exclude<AssetValueSource, null> } | null {
  const replacement = parseMoney(input.modelReplacementCost)
  if (replacement !== null) {
    return { amount: replacement, source: "model_replacement" }
  }
  const modelPurchase = parseMoney(input.modelPurchaseCost)
  if (modelPurchase !== null) {
    return { amount: modelPurchase, source: "model_purchase" }
  }
  const assetPurchase = parseMoney(input.assetPurchaseCost)
  if (assetPurchase !== null) {
    return { amount: assetPurchase, source: "asset_purchase" }
  }
  return null
}

export type PurchaseValueSource = "model_purchase" | "asset_purchase"

/**
 * Purchase-only value (ignores replacement). Model purchase first, then asset
 * purchase. Used for the optional purchase rollup beside installed value.
 */
export function resolvePurchaseValue(
  input: AssetRiskCostInput
): { amount: string; source: PurchaseValueSource } | null {
  const modelPurchase = parseMoney(input.modelPurchaseCost)
  if (modelPurchase !== null) {
    return { amount: modelPurchase, source: "model_purchase" }
  }
  const assetPurchase = parseMoney(input.assetPurchaseCost)
  if (assetPurchase !== null) {
    return { amount: assetPurchase, source: "asset_purchase" }
  }
  return null
}

export function moneyToCents(value: string | null | undefined): number | null {
  const parsed = parseMoney(value)
  if (parsed === null) return null
  return Math.round(Number(parsed) * 100)
}

export function centsToMoney(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Single-loss figure ≈ resolved asset value (cents). */
export function expectedLossCents(assetValueCents: number): number {
  return Math.max(0, Math.round(assetValueCents))
}

/** Annual expected loss ≈ expected loss × likelihood per year. */
export function annualExpectedLossCents(
  expectedLoss: number,
  aroPerYear: number
): number {
  if (!(aroPerYear >= 0) || !Number.isFinite(aroPerYear)) return 0
  return Math.max(0, Math.round(expectedLoss * aroPerYear))
}

export type AssetRiskRowInput = {
  id: string
  tag: string
  status: string
  linked: boolean
  siteId: string | null
  siteName: string | null
  organizationId: string
  organizationName: string | null
  deviceModelName: string | null
  modelReplacementCost: string | null
  modelPurchaseCost: string | null
  assetPurchaseCost: string | null
}

export type AssetRiskLine = {
  assetId: string
  tag: string
  siteId: string | null
  siteName: string | null
  organizationId: string
  organizationName: string | null
  deviceModelName: string | null
  value: string
  valueSource: Exclude<AssetValueSource, null>
  expectedLoss: string
  annualExpectedLoss: string
}

export type AssetRiskSummary = {
  aroPerYear: number
  inServiceLinkedCount: number
  withCostCount: number
  noCostCount: number
  totalReplacementValue: string
  totalExpectedLoss: string
  totalAnnualExpectedLoss: string
  lines: AssetRiskLine[]
}

/**
 * Morning risk slice: in-service assets linked to a device. Missing cost is
 * fail-closed — excluded from dollar totals and counted as “no cost set.”
 */
export function summarizeAssetRisk(
  rows: AssetRiskRowInput[],
  aroPerYear: number
): AssetRiskSummary {
  const aro = aroPerYearSchema.parse(aroPerYear)
  const eligible = rows.filter(
    (row) => row.status === "in_service" && row.linked
  )
  const lines: AssetRiskLine[] = []
  let totalValueCents = 0
  let totalAnnualCents = 0
  let noCostCount = 0

  for (const row of eligible) {
    const resolved = resolveAssetValue({
      modelReplacementCost: row.modelReplacementCost,
      modelPurchaseCost: row.modelPurchaseCost,
      assetPurchaseCost: row.assetPurchaseCost,
    })
    if (!resolved) {
      noCostCount += 1
      continue
    }
    const valueCents = moneyToCents(resolved.amount)
    if (valueCents === null) {
      noCostCount += 1
      continue
    }
    const lossCents = expectedLossCents(valueCents)
    const annualCents = annualExpectedLossCents(lossCents, aro)
    totalValueCents += lossCents
    totalAnnualCents += annualCents
    lines.push({
      assetId: row.id,
      tag: row.tag,
      siteId: row.siteId,
      siteName: row.siteName,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      deviceModelName: row.deviceModelName,
      value: centsToMoney(valueCents),
      valueSource: resolved.source,
      expectedLoss: centsToMoney(lossCents),
      annualExpectedLoss: centsToMoney(annualCents),
    })
  }

  lines.sort((left, right) => {
    const bySite = (left.siteName ?? "").localeCompare(right.siteName ?? "")
    if (bySite !== 0) return bySite
    return left.tag.localeCompare(right.tag)
  })

  return {
    aroPerYear: aro,
    inServiceLinkedCount: eligible.length,
    withCostCount: lines.length,
    noCostCount,
    totalReplacementValue: centsToMoney(totalValueCents),
    totalExpectedLoss: centsToMoney(totalValueCents),
    totalAnnualExpectedLoss: centsToMoney(totalAnnualCents),
    lines,
  }
}

export type InstalledValueLine = {
  assetId: string
  tag: string
  siteId: string | null
  siteName: string | null
  organizationId: string
  organizationName: string | null
  deviceModelName: string | null
  installedValue: string
  installedValueSource: Exclude<AssetValueSource, null>
  purchaseValue: string | null
  purchaseValueSource: PurchaseValueSource | null
}

export type InstalledValueSiteRollup = {
  siteId: string | null
  siteName: string | null
  inServiceLinkedCount: number
  withCostCount: number
  noCostCount: number
  totalInstalledValue: string
  totalPurchaseValue: string
}

export type InstalledValueSummary = {
  inServiceLinkedCount: number
  withCostCount: number
  noCostCount: number
  /** Sum of resolveAssetValue (replacement preferred). */
  totalInstalledValue: string
  /** Sum of purchase-only costs; assets with only replacement cost contribute 0. */
  totalPurchaseValue: string
  sites: InstalledValueSiteRollup[]
  lines: InstalledValueLine[]
}

export type SummarizeInstalledValueOptions = {
  /** When set, only assets at this site are included. */
  siteId?: string | null
}

type SiteAccumulator = {
  siteId: string | null
  siteName: string | null
  inServiceLinkedCount: number
  withCostCount: number
  noCostCount: number
  installedCents: number
  purchaseCents: number
}

/**
 * Site / org installed-value rollup for linked in-service assets. Uses the same
 * cost resolution as expected loss. Missing cost is fail-closed — excluded from
 * dollar totals and counted as “no cost set.”
 */
export function summarizeInstalledValue(
  rows: AssetRiskRowInput[],
  options?: SummarizeInstalledValueOptions
): InstalledValueSummary {
  const siteFilter = options?.siteId
  const eligible = rows.filter((row) => {
    if (row.status !== "in_service" || !row.linked) return false
    if (siteFilter) return row.siteId === siteFilter
    return true
  })

  const lines: InstalledValueLine[] = []
  let totalInstalledCents = 0
  let totalPurchaseCents = 0
  let noCostCount = 0
  const bySite = new Map<string, SiteAccumulator>()

  function siteKey(siteId: string | null) {
    return siteId ?? ""
  }

  function ensureSite(row: AssetRiskRowInput): SiteAccumulator {
    const key = siteKey(row.siteId)
    const existing = bySite.get(key)
    if (existing) return existing
    const created: SiteAccumulator = {
      siteId: row.siteId,
      siteName: row.siteName,
      inServiceLinkedCount: 0,
      withCostCount: 0,
      noCostCount: 0,
      installedCents: 0,
      purchaseCents: 0,
    }
    bySite.set(key, created)
    return created
  }

  for (const row of eligible) {
    const site = ensureSite(row)
    site.inServiceLinkedCount += 1

    const resolved = resolveAssetValue({
      modelReplacementCost: row.modelReplacementCost,
      modelPurchaseCost: row.modelPurchaseCost,
      assetPurchaseCost: row.assetPurchaseCost,
    })
    if (!resolved) {
      noCostCount += 1
      site.noCostCount += 1
      continue
    }
    const valueCents = moneyToCents(resolved.amount)
    if (valueCents === null) {
      noCostCount += 1
      site.noCostCount += 1
      continue
    }

    const purchase = resolvePurchaseValue({
      modelPurchaseCost: row.modelPurchaseCost,
      assetPurchaseCost: row.assetPurchaseCost,
    })
    const purchaseCents = purchase ? moneyToCents(purchase.amount) : null

    totalInstalledCents += valueCents
    site.installedCents += valueCents
    site.withCostCount += 1
    if (purchaseCents !== null) {
      totalPurchaseCents += purchaseCents
      site.purchaseCents += purchaseCents
    }

    lines.push({
      assetId: row.id,
      tag: row.tag,
      siteId: row.siteId,
      siteName: row.siteName,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      deviceModelName: row.deviceModelName,
      installedValue: centsToMoney(valueCents),
      installedValueSource: resolved.source,
      purchaseValue:
        purchaseCents !== null ? centsToMoney(purchaseCents) : null,
      purchaseValueSource: purchase?.source ?? null,
    })
  }

  lines.sort((left, right) => {
    const bySiteName = (left.siteName ?? "").localeCompare(right.siteName ?? "")
    if (bySiteName !== 0) return bySiteName
    return left.tag.localeCompare(right.tag)
  })

  const sites = [...bySite.values()]
    .map((entry) => ({
      siteId: entry.siteId,
      siteName: entry.siteName,
      inServiceLinkedCount: entry.inServiceLinkedCount,
      withCostCount: entry.withCostCount,
      noCostCount: entry.noCostCount,
      totalInstalledValue: centsToMoney(entry.installedCents),
      totalPurchaseValue: centsToMoney(entry.purchaseCents),
    }))
    .sort((left, right) =>
      (left.siteName ?? "").localeCompare(right.siteName ?? "")
    )

  return {
    inServiceLinkedCount: eligible.length,
    withCostCount: lines.length,
    noCostCount,
    totalInstalledValue: centsToMoney(totalInstalledCents),
    totalPurchaseValue: centsToMoney(totalPurchaseCents),
    sites,
    lines,
  }
}
