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
 * Asset value for expected-loss math. Replacement cost on the device model is
 * preferred; model purchase is next; asset purchase is a last-resort fallback
 * when the catalog has no cost. Model costs remain the source of truth.
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
