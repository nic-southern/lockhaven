"use client"

import * as React from "react"
import { ArrowLeftRightIcon } from "lucide-react"
import { diffRoutePolicies } from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"

import { PolicyBadge, RouteChip } from "./policy-chip"
import type { RoutePolicyRecord } from "./policy-dialog"

function policyOptions(policies: RoutePolicyRecord[]) {
  return policies.map((policy) => ({
    value: policy.id,
    label: policy.organizationName
      ? `${policy.name} · ${policy.organizationName}`
      : policy.name,
  }))
}

function Column({
  title,
  policy,
  routes,
  emphasis,
}: {
  title: string
  policy: RoutePolicyRecord | null
  routes: string[]
  emphasis: "unique" | "shared"
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
        <Badge variant="secondary" className="tabular-nums">
          {routes.length}
        </Badge>
      </div>
      {policy ? (
        <PolicyBadge
          name={policy.name}
          color={policy.color}
          className="text-sm"
        />
      ) : null}
      {routes.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {routes.map((route) => {
            const entry =
              policy?.entries.find((candidate) => candidate.cidr === route) ??
              route
            return (
              <li key={route}>
                <RouteChip
                  entry={entry}
                  tone={emphasis === "shared" ? "secondary" : "outline"}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Side-by-side diff of two policies' routes, including partial overlaps. */
export function ComparePoliciesDialog({
  open,
  onOpenChange,
  policies,
  initialA,
  initialB,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  policies: RoutePolicyRecord[]
  initialA?: string | null
  initialB?: string | null
}) {
  const [aId, setAId] = React.useState(initialA ?? "")
  const [bId, setBId] = React.useState(initialB ?? "")
  const [seed, setSeed] = React.useState({ open, initialA, initialB })
  if (
    seed.open !== open ||
    seed.initialA !== initialA ||
    seed.initialB !== initialB
  ) {
    setSeed({ open, initialA, initialB })
    if (open) {
      setAId(initialA ?? "")
      setBId(
        initialB ?? policies.find((policy) => policy.id !== initialA)?.id ?? ""
      )
    }
  }

  const a = policies.find((policy) => policy.id === aId) ?? null
  const b = policies.find((policy) => policy.id === bId) ?? null
  const diff = React.useMemo(
    () => (a && b ? diffRoutePolicies(a.routes, b.routes) : null),
    [a, b]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare policies</DialogTitle>
          <DialogDescription>
            See which networks two policies share, and where they differ.
          </DialogDescription>
        </DialogHeader>

        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <FormField label="Policy A" htmlFor="compare-a">
            <SelectField
              id="compare-a"
              value={aId}
              onValueChange={setAId}
              options={policyOptions(policies)}
              placeholder="Choose a policy"
            />
          </FormField>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mb-0.5 hidden sm:inline-flex"
            aria-label="Swap policies"
            onClick={() => {
              setAId(bId)
              setBId(aId)
            }}
          >
            <ArrowLeftRightIcon className="size-4" />
          </Button>
          <FormField label="Policy B" htmlFor="compare-b">
            <SelectField
              id="compare-b"
              value={bId}
              onValueChange={setBId}
              options={policyOptions(policies)}
              placeholder="Choose a policy"
            />
          </FormField>
        </div>

        {diff && a && b ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Column
                title="Only in A"
                policy={a}
                routes={diff.onlyInA}
                emphasis="unique"
              />
              <Column
                title="Shared"
                policy={null}
                routes={diff.shared}
                emphasis="shared"
              />
              <Column
                title="Only in B"
                policy={b}
                routes={diff.onlyInB}
                emphasis="unique"
              />
            </div>
            {diff.overlapping.length > 0 ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  Partial overlaps
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                  {diff.overlapping.map((pair) => (
                    <li key={`${pair.a}-${pair.b}`} className="font-mono">
                      {pair.a} <span className="font-sans">overlaps</span>{" "}
                      {pair.b}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {a.deviceCount}{" "}
              {a.deviceCount === 1 ? "device uses" : "devices use"} {a.name};{" "}
              {b.deviceCount}{" "}
              {b.deviceCount === 1 ? "device uses" : "devices use"} {b.name}.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Choose two policies to compare.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
