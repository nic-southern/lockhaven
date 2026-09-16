"use client"

import * as React from "react"
import type { Permission } from "@nms/shared"

import { trpc } from "@/lib/trpc"

/**
 * Permission checks for the signed-in user. Backed by the cached `access.me`
 * query so every component shares one request.
 */
export function usePermissions() {
  const meQuery = trpc.access.me.useQuery(undefined, { staleTime: 60_000 })
  const permissions = React.useMemo(
    () => new Set<Permission>(meQuery.data?.permissions ?? []),
    [meQuery.data?.permissions]
  )
  const can = React.useCallback(
    (permission: Permission) => permissions.has(permission),
    [permissions]
  )

  return {
    can,
    permissions,
    uiScope: meQuery.data?.uiScope ?? "admin",
    platformRole: meQuery.data?.platformRole ?? null,
    isPlatformAdmin:
      meQuery.data?.platformRole === "owner" ||
      meQuery.data?.platformRole === "admin",
    isLoading: meQuery.isLoading,
  }
}
