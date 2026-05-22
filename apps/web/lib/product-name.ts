export const DEFAULT_PRODUCT_NAME = "Lockhaven"

type ProductNameEnv = {
  PRODUCT_NAME?: string
  APP_NAME?: string
}

type RuntimeProductConfig = {
  productName?: string | null
  vpnPublicHostname?: string | null
  socBaseUrl?: string | null
}

declare global {
  interface Window {
    __LOCKHAVEN_CONFIG__?: RuntimeProductConfig
  }
}

function normalizeProductName(value: string | null | undefined) {
  const trimmed = value?.trim()

  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_PRODUCT_NAME
}

export function getServerProductName(
  env: ProductNameEnv = {
    PRODUCT_NAME: process.env.PRODUCT_NAME,
    APP_NAME: process.env.APP_NAME,
  }
) {
  return normalizeProductName(env.PRODUCT_NAME ?? env.APP_NAME)
}

export function getClientProductName(config?: RuntimeProductConfig) {
  if (config) {
    return normalizeProductName(config.productName)
  }

  if (typeof window !== "undefined") {
    return normalizeProductName(window.__LOCKHAVEN_CONFIG__?.productName)
  }

  return getServerProductName()
}

function normalizeBaseUrl(value: string | null | undefined) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  return withProtocol.replace(/\/+$/, "")
}

export function getClientVpnBaseUrl(config?: RuntimeProductConfig) {
  const configured = normalizeBaseUrl(
    config?.vpnPublicHostname ??
      (typeof window !== "undefined"
        ? window.__LOCKHAVEN_CONFIG__?.vpnPublicHostname
        : null)
  )

  if (configured) {
    return configured
  }

  if (typeof window !== "undefined") {
    return window.location.origin
  }

  return "https://<vpn-hostname>"
}

export function getClientSocBaseUrl(config?: RuntimeProductConfig) {
  return normalizeBaseUrl(
    config?.socBaseUrl ??
      (typeof window !== "undefined"
        ? window.__LOCKHAVEN_CONFIG__?.socBaseUrl
        : null)
  )
}

export function getProductInitials(productName: string) {
  const words = productName.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return "L"
  }

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
}
