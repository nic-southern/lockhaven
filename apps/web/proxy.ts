import { type NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"

const PUBLIC_PREFIXES = ["/sign-in", "/accept-invite"]
const SECURITY_SETUP_PATH = "/setup-security"

type SessionUser = {
  status?: string | null
  twoFactorEnabled?: boolean | null
  mustChangePassword?: boolean | null
}

function needsSecuritySetup(user: SessionUser) {
  return user.mustChangePassword === true || user.twoFactorEnabled !== true
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
      return NextResponse.next()
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
      return NextResponse.next()
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

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|install|_next/static|_next/image|favicon.ico).*)"],
}
