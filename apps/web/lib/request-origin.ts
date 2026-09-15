const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export type OriginVerdict =
  | { ok: true }
  | {
      ok: false
      reason:
        | "cross_site_fetch"
        | "origin_mismatch"
        | "referer_mismatch"
        | "missing_origin"
    }

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null
  try {
    return new URL(value).origin.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Reconstructs the origin the browser used, honouring the proxy headers the
 * edge sets in production so `https://console.example` doesn't get compared
 * against the internal `http://web:3000` address.
 */
export function requestOrigin(headers: Headers) {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwardedHost || headers.get("host")
  if (!host) return null
  const forwardedProto = headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase()
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : host.startsWith("localhost") ||
          host.startsWith("127.0.0.1") ||
          host.startsWith("[::1]")
        ? "http"
        : "https"
  return normalizeOrigin(`${proto}://${host}`)
}

/**
 * Same-origin guard for cookie-authenticated, state-changing requests.
 * Browsers always attach `Origin` (and usually `Sec-Fetch-Site`) to POSTs,
 * so a mismatch or an explicit cross-site marker means a forged request.
 * Non-browser callers without cookies are unaffected: they have no session
 * to ride on, but they still must not spoof a foreign origin.
 */
export function verifyRequestOrigin({
  method,
  headers,
  trustedOrigins = [],
}: {
  method: string
  headers: Headers
  trustedOrigins?: string[]
}): OriginVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) {
    return { ok: true }
  }

  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase()
  if (fetchSite === "cross-site") {
    return { ok: false, reason: "cross_site_fetch" }
  }

  const allowed = new Set<string>()
  const self = requestOrigin(headers)
  if (self) allowed.add(self)
  for (const origin of trustedOrigins) {
    const normalized = normalizeOrigin(origin)
    if (normalized) allowed.add(normalized)
  }

  const origin = normalizeOrigin(headers.get("origin"))
  if (origin) {
    return allowed.has(origin)
      ? { ok: true }
      : { ok: false, reason: "origin_mismatch" }
  }

  const referer = normalizeOrigin(headers.get("referer"))
  if (referer) {
    return allowed.has(referer)
      ? { ok: true }
      : { ok: false, reason: "referer_mismatch" }
  }

  // No origin information at all. Browsers never omit it on POST, so this is
  // a scripted client; only refuse when it presents cookies it should not
  // be able to use without a page context.
  if (headers.get("cookie")) {
    return { ok: false, reason: "missing_origin" }
  }
  return { ok: true }
}
