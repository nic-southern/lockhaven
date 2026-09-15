/**
 * Response headers that apply to every route, pages and API alike. Kept as
 * plain JavaScript so the framework config can load it without a build step.
 * HSTS is only meaningful over TLS, so callers pass `https` for production
 * origins.
 *
 * @param {{ https: boolean }} options
 * @returns {Array<{ key: string; value: string }>}
 */
export function staticSecurityHeaders({ https }) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        "payment=()",
        "usb=()",
        "interest-cohort=()",
      ].join(", "),
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ]
  if (https) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    })
  }
  return headers
}
