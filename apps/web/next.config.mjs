import { staticSecurityHeaders } from "./security-headers.mjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        // Browsers only honour HSTS over TLS, so emitting it for every
        // production build is safe even for a plain-HTTP lab deployment.
        headers: staticSecurityHeaders({
          https: process.env.NODE_ENV === "production",
        }),
      },
    ]
  },
}

export default nextConfig
