import assert from "node:assert/strict"
import test from "node:test"

import {
  annualExpectedLossCents,
  DEFAULT_ARO_PER_YEAR,
  expectedLossCents,
  resolveAssetValue,
  summarizeAssetRisk,
} from "./asset-risk"

test("resolveAssetValue prefers model replacement over purchase", () => {
  const resolved = resolveAssetValue({
    modelReplacementCost: "1200.00",
    modelPurchaseCost: "900.00",
    assetPurchaseCost: "800.00",
  })
  assert.deepEqual(resolved, {
    amount: "1200.00",
    source: "model_replacement",
  })
})

test("resolveAssetValue falls back to model purchase then asset purchase", () => {
  assert.deepEqual(
    resolveAssetValue({
      modelReplacementCost: null,
      modelPurchaseCost: "900.5",
      assetPurchaseCost: "800",
    }),
    { amount: "900.50", source: "model_purchase" }
  )
  assert.deepEqual(
    resolveAssetValue({
      modelReplacementCost: null,
      modelPurchaseCost: null,
      assetPurchaseCost: "800",
    }),
    { amount: "800.00", source: "asset_purchase" }
  )
  assert.equal(
    resolveAssetValue({
      modelReplacementCost: null,
      modelPurchaseCost: null,
      assetPurchaseCost: null,
    }),
    null
  )
})

test("expected loss equals asset value; annual loss multiplies by likelihood", () => {
  assert.equal(expectedLossCents(125_050), 125_050)
  assert.equal(annualExpectedLossCents(100_000, 0.05), 5_000)
  assert.equal(annualExpectedLossCents(100_000, 0), 0)
  assert.equal(annualExpectedLossCents(100_000, 1.5), 150_000)
})

test("summarizeAssetRisk excludes missing cost from dollar totals", () => {
  const summary = summarizeAssetRisk(
    [
      {
        id: "a1",
        tag: "LH-AAA",
        status: "in_service",
        linked: true,
        siteId: "s1",
        siteName: "Floor",
        organizationId: "o1",
        organizationName: "Org",
        deviceModelName: "PC",
        modelReplacementCost: "1000.00",
        modelPurchaseCost: null,
        assetPurchaseCost: null,
      },
      {
        id: "a2",
        tag: "LH-BBB",
        status: "in_service",
        linked: true,
        siteId: "s1",
        siteName: "Floor",
        organizationId: "o1",
        organizationName: "Org",
        deviceModelName: "Monitor",
        modelReplacementCost: null,
        modelPurchaseCost: null,
        assetPurchaseCost: null,
      },
      {
        id: "a3",
        tag: "LH-CCC",
        status: "stock",
        linked: true,
        siteId: "s1",
        siteName: "Floor",
        organizationId: "o1",
        organizationName: "Org",
        deviceModelName: "PC",
        modelReplacementCost: "500.00",
        modelPurchaseCost: null,
        assetPurchaseCost: null,
      },
      {
        id: "a4",
        tag: "LH-DDD",
        status: "in_service",
        linked: false,
        siteId: null,
        siteName: null,
        organizationId: "o1",
        organizationName: "Org",
        deviceModelName: "PC",
        modelReplacementCost: "500.00",
        modelPurchaseCost: null,
        assetPurchaseCost: null,
      },
    ],
    DEFAULT_ARO_PER_YEAR
  )

  assert.equal(summary.inServiceLinkedCount, 2)
  assert.equal(summary.withCostCount, 1)
  assert.equal(summary.noCostCount, 1)
  assert.equal(summary.totalReplacementValue, "1000.00")
  assert.equal(summary.totalExpectedLoss, "1000.00")
  assert.equal(summary.totalAnnualExpectedLoss, "50.00")
  assert.equal(summary.lines.length, 1)
  assert.equal(summary.lines[0]?.tag, "LH-AAA")
  assert.equal(summary.lines[0]?.annualExpectedLoss, "50.00")
})

test("summarizeAssetRisk uses editable likelihood per year", () => {
  const summary = summarizeAssetRisk(
    [
      {
        id: "a1",
        tag: "LH-AAA",
        status: "in_service",
        linked: true,
        siteId: null,
        siteName: null,
        organizationId: "o1",
        organizationName: "Org",
        deviceModelName: null,
        modelReplacementCost: null,
        modelPurchaseCost: "200.00",
        assetPurchaseCost: null,
      },
    ],
    0.1
  )
  assert.equal(summary.totalExpectedLoss, "200.00")
  assert.equal(summary.totalAnnualExpectedLoss, "20.00")
  assert.equal(summary.aroPerYear, 0.1)
})
