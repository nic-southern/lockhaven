"use client"

import * as React from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { cn } from "@/lib/utils"

import { PolicyDot } from "./policy-chip"
import type { RoutePolicyRecord } from "./policy-dialog"

/**
 * Which policy each site's devices are on. Sites with devices on no policy
 * or split across several stand out so coverage gaps are obvious.
 */
export function AllocationMap({
  policies,
  onSelectPolicy,
  activePolicyId,
}: {
  policies: RoutePolicyRecord[]
  onSelectPolicy?: (id: string) => void
  activePolicyId?: string | null
}) {
  const allocationQuery = trpc.routePolicies.allocation.useQuery(undefined, {
    staleTime: 30_000,
  })
  const policyById = React.useMemo(
    () => new Map(policies.map((policy) => [policy.id, policy])),
    [policies]
  )

  if (allocationQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  const organizations = allocationQuery.data?.organizations ?? []
  const withDevices = organizations.filter((organization) =>
    organization.sites.some((site) => site.deviceCount > 0)
  )

  if (withDevices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Once devices enroll, this shows which policy each site is using.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {withDevices.map((organization) => (
        <div key={organization.id} className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {organization.name}
          </p>
          <ul className="divide-y rounded-lg border">
            {organization.sites
              .filter((site) => site.deviceCount > 0)
              .map((site) => {
                const unassigned = site.policies.find(
                  (cell) => cell.routePolicyId === null
                )
                const assigned = site.policies.filter(
                  (cell) => cell.routePolicyId !== null
                )
                const mixed = assigned.length > 1
                return (
                  <li
                    key={site.siteId ?? "none"}
                    className="flex flex-col gap-2 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 text-sm font-medium break-words">
                        {site.siteName ?? "No site"}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {site.deviceCount}{" "}
                        {site.deviceCount === 1 ? "device" : "devices"}
                      </span>
                      {mixed ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/50 text-[10px] text-amber-700 dark:text-amber-400"
                        >
                          Mixed
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {assigned.map((cell) => {
                        const policy = policyById.get(cell.routePolicyId!)
                        const share = Math.round(
                          (cell.deviceCount / site.deviceCount) * 100
                        )
                        return (
                          <button
                            key={cell.routePolicyId}
                            type="button"
                            onClick={() =>
                              onSelectPolicy?.(cell.routePolicyId!)
                            }
                            title={`${policy?.name ?? "Policy"} · ${cell.deviceCount} of ${site.deviceCount} (${share}%)`}
                            className={cn(
                              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-accent",
                              activePolicyId === cell.routePolicyId &&
                                "border-primary bg-accent"
                            )}
                          >
                            <PolicyDot color={policy?.color} />
                            <span className="max-w-[10rem] truncate">
                              {policy?.name ?? "Unknown policy"}
                            </span>
                            <span className="text-muted-foreground tabular-nums">
                              {cell.deviceCount}
                            </span>
                          </button>
                        )
                      })}
                      {unassigned ? (
                        <Link
                          href={`/devices?f.routePolicyId=none${
                            site.siteId
                              ? `&f.siteId=${encodeURIComponent(site.siteId)}`
                              : ""
                          }`}
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          title="Devices with no route policy"
                        >
                          No policy
                          <span className="tabular-nums">
                            {unassigned.deviceCount}
                          </span>
                        </Link>
                      ) : null}
                    </div>
                  </li>
                )
              })}
          </ul>
        </div>
      ))}
    </div>
  )
}
