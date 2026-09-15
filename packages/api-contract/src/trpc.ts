import { initTRPC, TRPCError } from "@trpc/server"

import type { ApiContext } from "./context"
import { hasPermission } from "@nms/auth"
import type { Permission } from "@nms/shared"

const t = initTRPC.context<ApiContext>().create()

/**
 * Mirrors the page-level redirect in the web proxy: until a user has changed
 * a temporary password and enrolled two-step verification, the API is closed
 * to them as well. The setup flow itself only uses the auth routes.
 */
function assertSecuritySetupComplete(actor: NonNullable<ApiContext["actor"]>) {
  const security = actor.security
  if (security && (security.mustChangePassword || !security.twoFactorEnabled)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Finish setting up your account security to continue.",
    })
  }
}

const ensureAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  assertSecuritySetupComplete(ctx.actor)

  return next({
    ctx: {
      ...ctx,
      actor: ctx.actor,
    },
  })
})

const ensurePlatformAccess = t.middleware(({ ctx, next }) => {
  if (!ctx.actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  assertSecuritySetupComplete(ctx.actor)

  return next({
    ctx: {
      ...ctx,
      actor: ctx.actor,
    },
  })
})

const requirePermission = (permission: Permission) =>
  t.middleware(({ ctx, next }) => {
    if (!ctx.actor) {
      throw new TRPCError({ code: "UNAUTHORIZED" })
    }

    assertSecuritySetupComplete(ctx.actor)

    if (!hasPermission(ctx.actor.permissions, permission)) {
      throw new TRPCError({ code: "FORBIDDEN" })
    }

    return next({ ctx })
  })

export const createTRPCRouter = t.router
export const publicProcedure = t.procedure
export const adminProcedure = t.procedure.use(ensureAdmin)
export const platformProcedure = t.procedure.use(ensurePlatformAccess)
export const permissionProcedure = (permission: Permission) =>
  t.procedure.use(requirePermission(permission))
