import { type NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import { buildContentSecurityPolicy } from "@/lib/security-headers"

const PUBLIC_PREFIXES = ["/sign-in", "/accept-invite", "/reset-password"]
const SECURITY_SETUP_PATH = "/setup-security"
const CSP_HEADER = "Content-Security-Policy"

/**
 * Renders the page with a per-request script nonce. The policy travels on the
 * request so the framework stamps the nonce onto its own inline scripts, and
 * on the response so the browser enforces it.
 */
function renderWithPolicy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const policy = buildContentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV !== "production",
  })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(CSP_HEADER, policy)
  requestHeaders.set("x-nonce", nonce)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set(CSP_HEADER, policy)
  return response
}

type SessionUser = {
  status?: string | null
  twoFactorEnabled?: boolean | null
  mustChangePassword?: boolean | null
  ssoMfaTrusted?: boolean | null
}

function needsSecuritySetup(user: SessionUser) {
  if (user.mustChangePassword === true) {
    return true
  }
  if (user.ssoMfaTrusted === true) {
    return false
  }
  return user.twoFactorEnabled !== true
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isSecuritySetup = pathname.startsWith(SECURITY_SETUP_PATH)

  const session = await auth.api.getSession({
    headers: request.headers,
  })

  if (!session) {
    if (isPublic) {
      return renderWithPolicy(request)
    }
    const signIn = new URL("/sign-in", request.url)
    if (pathname !== "/") {
      signIn.searchParams.set("next", pathname)
    }
    return NextResponse.redirect(signIn)
  }

  const user = session.user as SessionUser

  if (user.status && user.status !== "active") {
    const signIn = new URL("/sign-in", request.url)
    signIn.searchParams.set("reason", "suspended")
    return NextResponse.redirect(signIn)
  }

  if (needsSecuritySetup(user)) {
    if (isSecuritySetup) {
      return renderWithPolicy(request)
    }
    return NextResponse.redirect(new URL(SECURITY_SETUP_PATH, request.url))
  }

  if (isSecuritySetup && !needsSecuritySetup(user)) {
    // Fully enrolled users manage security from their account page instead.
    return NextResponse.redirect(new URL("/account", request.url))
  }

  if (pathname.startsWith("/sign-in")) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return renderWithPolicy(request)
}

export const config = {
  matcher: ["/((?!api|install|_next/static|_next/image|favicon.ico).*)"],
}
