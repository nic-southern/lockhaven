import { PLATFORM_SSO_PROVIDER_ID_DEFAULT } from "@nms/shared"

export const SSO_START_ERROR = "We couldn't complete sign-in. Try again."

export type SsoSignInMethod = "oauth2" | "sso"

export type SsoStartSource = {
  signInMethod?: SsoSignInMethod | null
  providerId?: string | null
} | null

export type SsoStartIntent =
  | { action: "oauth2"; providerId: string }
  | { action: "sso"; providerId?: string; email?: string }
  | { action: "error"; message: string }

function trimmed(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined
  }
  const next = value.trim()
  return next || undefined
}

/**
 * Start company SSO without collecting email first. A typed email may select
 * an organization provider, but it is never required.
 */
export function resolveSsoStart(input: {
  email?: string | null
  status?: SsoStartSource
  hint?: SsoStartSource
}): SsoStartIntent {
  const email = trimmed(input.email)
  const hinted = email ? input.hint : null
  const signInMethod =
    hinted?.signInMethod ?? input.status?.signInMethod ?? null
  const providerId =
    trimmed(hinted?.providerId) ?? trimmed(input.status?.providerId)

  if (signInMethod === "sso" && (providerId || email)) {
    if (providerId) {
      return email
        ? { action: "sso", providerId, email }
        : { action: "sso", providerId }
    }
    return { action: "sso", email }
  }

  return {
    action: "oauth2",
    providerId: providerId ?? PLATFORM_SSO_PROVIDER_ID_DEFAULT,
  }
}

export function ssoRedirectUrl(result: unknown) {
  if (!result || typeof result !== "object" || !("data" in result)) {
    return null
  }
  const data = (result as { data?: unknown }).data
  if (!data || typeof data !== "object" || !("url" in data)) {
    return null
  }
  const url = (data as { url?: unknown }).url
  return typeof url === "string" && url.trim() ? url : null
}
