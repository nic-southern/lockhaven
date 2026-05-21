import { initTRPC, TRPCError } from "@trpc/server"

import type { ApiContext } from "./context"
import { hasPermission } from "@nms/auth"
import type { Permission } from "@nms/shared"

const t = initTRPC.context<ApiContext>().create()

const ensureAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }

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

    if (!hasPermission(ctx.actor.permissions, permission)) {
      throw new TRPCError({ code: "FORBIDDEN" })
    }

    return next({ ctx })
  })

export const createTRPCRouter = t.router
export const publicProcedure = t.procedure
export const adminProcedure = t.procedure.use(ensureAdmin)
export const permissionProcedure = (permission: Permission) =>
  t.procedure.use(requirePermission(permission))
