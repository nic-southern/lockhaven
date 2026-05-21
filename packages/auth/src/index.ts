import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { betterAuth } from "better-auth"

import { db } from "@nms/db/client"
import * as schema from "@nms/db/schema"
import type { Permission } from "@nms/shared"

import { hashPassword, verifyPassword } from "./password"

export type AdminPrincipal = {
  id: string
  email: string
  name: string | null
  permissions: Permission[]
}

export function permissionsForRole(role: string): Permission[] {
  if (role === "owner") {
    return [
      "device:view",
      "device:create",
      "device:update",
      "device:enroll",
      "device:revoke_vpn",
      "device:start_vnc",
      "device:start_rdp",
      "device:start_ssh",
      "organization:admin",
      "site:admin",
      "audit:view",
    ]
  }

  return [
    "device:view",
    "device:create",
    "device:update",
    "device:enroll",
    "device:revoke_vpn",
    "device:start_vnc",
    "device:start_rdp",
    "device:start_ssh",
    "audit:view",
  ]
}

export function hasPermission(
  permissions: Permission[],
  required: Permission
): boolean {
  return permissions.includes(required)
}

function isLocalhostHost(hostname: string) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  )
}

function getAuthBaseHostname() {
  const baseUrl =
    process.env.BETTER_AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.APP_BASE_URL ??
    "http://localhost:3000"

  try {
    return new URL(baseUrl).hostname
  } catch {
    return "localhost"
  }
}

function getCrossSubdomainCookieDomain() {
  const overrideDomain = process.env.AUTH_COOKIE_DOMAIN

  if (overrideDomain) {
    return isLocalhostHost(overrideDomain) ? undefined : overrideDomain
  }

  const rootDomain = process.env.ROOT_DOMAIN

  if (!rootDomain || isLocalhostHost(getAuthBaseHostname())) {
    return undefined
  }

  return rootDomain
}

export const auth = betterAuth({
  appName: process.env.PRODUCT_NAME ?? process.env.APP_NAME ?? "Lockhaven",
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.APP_BASE_URL ??
    "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  advanced: getCrossSubdomainCookieDomain()
    ? {
        crossSubDomainCookies: {
          enabled: true,
          domain: getCrossSubdomainCookieDomain() ?? "",
        },
      }
    : undefined,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    password: {
      hash: hashPassword,
      verify: ({ password, hash }) => verifyPassword(password, hash),
    },
  },
  session: {
    cookieCache: {
      enabled: false,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "admin",
        input: false,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "active",
        input: false,
      },
    },
  },
})
