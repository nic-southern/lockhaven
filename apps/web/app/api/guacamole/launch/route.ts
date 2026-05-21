import { randomUUID } from "node:crypto"

import { type NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"

const GUACAMOLE_LAUNCH_COOKIE = "guacamole_launch"
const GUACAMOLE_LAUNCH_TTL_SECONDS = 8 * 60 * 60

function getAppBaseUrl() {
  return (
    process.env.APP_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  )
}

function getGuacamoleBaseUrl() {
  return process.env.GUACAMOLE_BASE_URL ?? "https://guac.example.com/guacamole/"
}

function createCookieDomain() {
  const overrideDomain = process.env.AUTH_COOKIE_DOMAIN

  if (
    overrideDomain === "localhost" ||
    overrideDomain === "127.0.0.1" ||
    overrideDomain === "::1"
  ) {
    return undefined
  }

  if (overrideDomain) {
    return overrideDomain
  }

  const rootDomain = process.env.ROOT_DOMAIN
  const appBaseUrl = getAppBaseUrl()

  try {
    const hostname = new URL(appBaseUrl).hostname
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return undefined
    }
  } catch {
    return undefined
  }

  return rootDomain
}

function shouldSetSecureCookie() {
  try {
    return new URL(getAppBaseUrl()).protocol === "https:"
  } catch {
    return false
  }
}

async function handleLaunch(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", getAppBaseUrl()), {
      status: 302,
    })
  }

  const target = request.nextUrl.searchParams.get("target")

  if (!target) {
    return NextResponse.json(
      { error: "Missing launch target" },
      { status: 400 }
    )
  }

  const targetUrl = new URL(target)
  const guacamoleBaseUrl = new URL(getGuacamoleBaseUrl())

  if (
    targetUrl.origin !== guacamoleBaseUrl.origin ||
    !targetUrl.pathname.startsWith(guacamoleBaseUrl.pathname)
  ) {
    return NextResponse.json(
      { error: "Invalid launch target" },
      { status: 400 }
    )
  }

  const response = NextResponse.redirect(targetUrl, { status: 302 })
  response.cookies.set({
    name: GUACAMOLE_LAUNCH_COOKIE,
    value: randomUUID(),
    httpOnly: true,
    sameSite: "lax",
    secure: shouldSetSecureCookie(),
    path: "/guacamole/",
    maxAge: GUACAMOLE_LAUNCH_TTL_SECONDS,
    ...(createCookieDomain() ? { domain: createCookieDomain() } : {}),
  })

  return response
}

export const GET = handleLaunch
