/**
 * Content Security Policy for Console pages. Scripts are nonce-gated and
 * `strict-dynamic` lets the framework's own loader pull in chunked bundles.
 * Styles keep `unsafe-inline` because the UI primitives position popovers
 * and tooltips with inline style attributes.
 */
export function buildContentSecurityPolicy({
  nonce,
  dev = false,
}: {
  nonce: string
  dev?: boolean
}) {
  const scriptSources = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`]
  if (dev) {
    // The development bundler evaluates modules for fast refresh.
    scriptSources.push(`'unsafe-eval'`)
  }

  const directives: Array<[string, string[]]> = [
    ["default-src", [`'self'`]],
    ["script-src", scriptSources],
    ["style-src", [`'self'`, `'unsafe-inline'`]],
    ["img-src", [`'self'`, "data:", "blob:"]],
    ["font-src", [`'self'`, "data:"]],
    ["connect-src", dev ? [`'self'`, "ws:", "wss:"] : [`'self'`]],
    ["worker-src", [`'self'`, "blob:"]],
    ["manifest-src", [`'self'`]],
    ["media-src", [`'self'`]],
    ["object-src", [`'none'`]],
    ["base-uri", [`'self'`]],
    ["form-action", [`'self'`]],
    ["frame-ancestors", [`'none'`]],
    ["frame-src", [`'none'`]],
  ]
  if (!dev) {
    directives.push(["upgrade-insecure-requests", []])
  }

  return directives
    .map(([name, values]) =>
      values.length > 0 ? `${name} ${values.join(" ")}` : name
    )
    .join("; ")
}

/** Extracts the script nonce from a policy string, mirroring how the framework reads it. */
export function nonceFromPolicy(policy: string) {
  const match = /script-src[^;]*'nonce-([^']+)'/.exec(policy)
  return match?.[1] ?? null
}

export { staticSecurityHeaders } from "../security-headers.mjs"
