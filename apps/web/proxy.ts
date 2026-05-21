import { type NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"

export async function proxy(request: NextRequest) {
  const isSignInPage = request.nextUrl.pathname.startsWith("/sign-in")
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  if (!session && !isSignInPage) {
    return NextResponse.redirect(new URL("/sign-in", request.url))
  }

  if (session && isSignInPage) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
