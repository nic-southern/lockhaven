import { eq } from "drizzle-orm"
import { type NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import { authorize } from "@nms/auth"
import { resolveAdminPrincipalByEmail } from "@nms/auth/server"
import { devices, remoteSessions } from "@nms/db"
import { db } from "@nms/db/client"
import { getRemoteAccessProvider } from "@nms/api-contract"
import {
  BROWSER_CONNECTION_METHOD,
  buildSessionHistoryPlayerUrl, // pragma: allowlist secret
} from "@nms/shared"

function getAppBaseUrl() {
  return (
    process.env.APP_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  )
}

function sessionGatewayBaseUrl() {
  // pragma: allowlist secret
  return process.env.GUACAMOLE_BASE_URL ?? "https://guac.example.com/guacamole/" // pragma: allowlist secret
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  const email = session?.user?.email
  if (!email) {
    const signIn = new URL("/sign-in", getAppBaseUrl())
    signIn.searchParams.set("next", request.nextUrl.pathname)
    return NextResponse.redirect(signIn)
  }
  const actor = await resolveAdminPrincipalByEmail(email)
  if (!actor) {
    return NextResponse.redirect(new URL("/sign-in", getAppBaseUrl()))
  }

  const { id } = await context.params
  const [row] = await db
    .select({
      session: remoteSessions,
      organizationId: devices.organizationId,
      siteId: devices.siteId,
    })
    .from(remoteSessions)
    .innerJoin(devices, eq(devices.id, remoteSessions.deviceId))
    .where(eq(remoteSessions.id, id))

  if (!row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const decision = authorize(actor, "device:view", {
    kind: "device",
    organizationId: row.organizationId,
    siteId: row.siteId,
  })
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "You don't have access." },
      { status: 403 }
    )
  }

  if (row.session.connectionMethod !== BROWSER_CONNECTION_METHOD) {
    return NextResponse.json(
      { error: "No recording is available." },
      { status: 404 }
    )
  }

  const connectionName =
    row.session.auditMetadata[`${BROWSER_CONNECTION_METHOD}SessionId`]
  if (typeof connectionName !== "string" || !connectionName) {
    return NextResponse.json(
      { error: "No recording is available." },
      { status: 404 }
    )
  }

  let historyId: string | null = null
  try {
    const history =
      await getRemoteAccessProvider().getSessionHistory(connectionName)
    historyId = history?.historyId ?? null
  } catch {
    historyId = null
  }

  if (!historyId) {
    return NextResponse.json(
      { error: "No recording is available." },
      { status: 404 }
    )
  }

  const playerUrl = buildSessionHistoryPlayerUrl(
    // pragma: allowlist secret
    sessionGatewayBaseUrl(), // pragma: allowlist secret
    historyId
  )
  const launchUrl = new URL("/api/guacamole/launch", getAppBaseUrl()) // pragma: allowlist secret
  launchUrl.searchParams.set("target", playerUrl)
  return NextResponse.redirect(launchUrl)
}
