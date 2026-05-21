import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"

const TRUSTED_GUACAMOLE_USER = "guacadmin"
const GUACAMOLE_LAUNCH_COOKIE = "guacamole_launch"

function getAppBaseUrl() {
  return (
    process.env.APP_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  )
}

async function handleAuth(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", getAppBaseUrl()), {
      status: 302,
    })
  }

  if (!request.cookies.get(GUACAMOLE_LAUNCH_COOKIE)) {
    return NextResponse.redirect(new URL("/", getAppBaseUrl()), { status: 302 })
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Authenticated-User": TRUSTED_GUACAMOLE_USER,
    },
  })
}

export const GET = handleAuth
export const POST = handleAuth
export const HEAD = handleAuth
