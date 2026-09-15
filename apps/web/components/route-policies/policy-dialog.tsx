"use client"

import * as React from "react"
import { keepPreviousData } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  analyzeRoutes,
  routePolicyColors,
  type RouteAnalysis,
  type RoutePolicyColor,
  type RoutePolicyEntry,
} from "@nms/shared"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"
import { trpc, type RouterOutputs } from "@/lib/trpc"
import { cn } from "@/lib/utils"

import { policyColorDot, policyColorLabel } from "./policy-chip"
import { RouteEditor } from "./route-editor"

export type RoutePolicyRecord = RouterOutputs["routePolicies"]["list"][number]

type DraftState = {
  organizationId: string
  name: string
  description: string
  color: RoutePolicyColor | null
  isDefault: boolean
  entries: RoutePolicyEntry[]
}

function initialDraft(
  policy: RoutePolicyRecord | null,
  defaultOrganizationId: string
): DraftState {
  return {
    organizationId: policy?.organizationId ?? defaultOrganizationId,
    name: policy?.name ?? "",
    description: policy?.description ?? "",
    color: (policy?.color as RoutePolicyColor | null | undefined) ?? null,
    isDefault: policy?.isDefault ?? false,
    entries: policy?.entries.map((entry) => ({ ...entry })) ?? [],
  }
}

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(handle)
  }, [value, delay])
  return debounced
}

/**
 * Create or edit a route policy. Validation runs locally for instant
 * feedback and against the server for tunnel and sibling-policy overlaps.
 */
export function PolicyDialog({
  open,
  onOpenChange,
  policy,
  organizations,
  defaultOrganizationId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing policy to edit; `null` creates a new one. */
  policy: RoutePolicyRecord | null
  organizations: Array<{ id: string; name: string }>
  defaultOrganizationId: string
  onSaved?: (policy: { id: string }) => void
}) {
  const utils = trpc.useUtils()
  const [draft, setDraft] = React.useState<DraftState>(() =>
    initialDraft(policy, defaultOrganizationId)
  )
  const [seed, setSeed] = React.useState<{
    open: boolean
    policyId: string | null
  }>({ open, policyId: policy?.id ?? null })
  if (seed.open !== open || seed.policyId !== (policy?.id ?? null)) {
    // Re-seed the form whenever the dialog opens for a different target.
    setSeed({ open, policyId: policy?.id ?? null })
    if (open) {
      setDraft(initialDraft(policy, defaultOrganizationId))
    }
  }

  const localAnalysis = React.useMemo(
    () => analyzeRoutes(draft.entries),
    [draft.entries]
  )
  const debouncedEntries = useDebounced(draft.entries, 350)
  const previewQuery = trpc.routePolicies.preview.useQuery(
    {
      id: policy?.id,
      organizationId: policy ? undefined : draft.organizationId || undefined,
      entries: debouncedEntries,
    },
    {
      enabled: open && debouncedEntries.length > 0,
      placeholderData: keepPreviousData,
      staleTime: 10_000,
    }
  )

  const serverMatchesDraft =
    previewQuery.data &&
    JSON.stringify(debouncedEntries) === JSON.stringify(draft.entries) &&
    previewQuery.data.routes.length === draft.entries.length
  const analysis: RouteAnalysis | null =
    draft.entries.length === 0
      ? null
      : serverMatchesDraft
        ? previewQuery.data!
        : localAnalysis

  const invalidate = React.useCallback(async () => {
    await Promise.all([
      utils.routePolicies.list.invalidate(),
      utils.routePolicies.allocation.invalidate(),
      utils.devices.facets.invalidate(),
      utils.audit.page.invalidate(),
    ])
  }, [utils])

  const createMutation = trpc.routePolicies.create.useMutation({
    async onSuccess(result) {
      await invalidate()
      toast.success("Route policy created")
      onSaved?.(result)
      onOpenChange(false)
    },
    onError(error) {
      toast.error(error.message || "We couldn't create the route policy.")
    },
  })
  const updateMutation = trpc.routePolicies.update.useMutation({
    async onSuccess(result) {
      await Promise.all([
        invalidate(),
        utils.routePolicies.byId.invalidate({ id: result.id }),
      ])
      toast.success("Route policy updated")
      onSaved?.(result)
      onOpenChange(false)
    },
    onError(error) {
      toast.error(error.message || "We couldn't update the route policy.")
    },
  })

  const pending = createMutation.isPending || updateMutation.isPending
  const hasErrors = (analysis?.errorCount ?? localAnalysis.errorCount) > 0
  const canSubmit =
    draft.name.trim().length > 0 &&
    draft.entries.length > 0 &&
    !hasErrors &&
    (policy ? true : Boolean(draft.organizationId)) &&
    !pending

  const submit = () => {
    if (!canSubmit) return
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      color: draft.color,
      isDefault: draft.isDefault,
      entries: draft.entries.map((entry) => ({
        cidr: entry.cidr.trim(),
        label: entry.label?.trim() || null,
        comment: entry.comment?.trim() || null,
      })),
    }
    if (policy) {
      updateMutation.mutate({ id: policy.id, ...payload })
    } else {
      createMutation.mutate({
        organizationId: draft.organizationId,
        ...payload,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {policy ? "Edit policy" : "New route policy"}
          </DialogTitle>
          <DialogDescription>
            {policy
              ? "Changes apply to every device and enrollment token using this policy."
              : "A named set of networks devices can reach through the tunnel."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {!policy ? (
              <FormField label="Organization" htmlFor="policy-organization">
                <SelectField
                  id="policy-organization"
                  value={draft.organizationId}
                  onValueChange={(organizationId) =>
                    setDraft((current) => ({ ...current, organizationId }))
                  }
                  placeholder="Choose an organization"
                  options={organizations.map((organization) => ({
                    value: organization.id,
                    label: organization.name,
                  }))}
                />
              </FormField>
            ) : null}
            <FormField
              label="Name"
              htmlFor="policy-name"
              className={policy ? "sm:col-span-2" : undefined}
            >
              <Input
                id="policy-name"
                value={draft.name}
                maxLength={80}
                placeholder="e.g. Office network"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </FormField>
          </div>

          <FormField
            label="Routes"
            htmlFor="policy-routes"
            description={
              analysis && analysis.normalizedRoutes.length > 0
                ? `${analysis.normalizedRoutes.length} ${
                    analysis.normalizedRoutes.length === 1 ? "route" : "routes"
                  } covering ${analysis.addressCount.toLocaleString()} addresses.`
                : undefined
            }
          >
            <RouteEditor
              id="policy-routes"
              value={draft.entries}
              analysis={analysis}
              disabled={pending}
              onChange={(entries) =>
                setDraft((current) => ({ ...current, entries }))
              }
            />
          </FormField>

          <FormField label="Description" htmlFor="policy-description">
            <Textarea
              id="policy-description"
              value={draft.description}
              maxLength={500}
              placeholder="What this policy is for and who should use it."
              className="min-h-20"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Color">
              <div
                role="radiogroup"
                aria-label="Policy color"
                className="flex flex-wrap items-center gap-2"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.color === null}
                  aria-label="No color"
                  onClick={() =>
                    setDraft((current) => ({ ...current, color: null }))
                  }
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border border-dashed text-[10px] text-muted-foreground",
                    draft.color === null && "ring-2 ring-ring ring-offset-2"
                  )}
                >
                  —
                </button>
                {routePolicyColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={draft.color === color}
                    aria-label={policyColorLabel[color]}
                    title={policyColorLabel[color]}
                    onClick={() =>
                      setDraft((current) => ({ ...current, color }))
                    }
                    className={cn(
                      "size-7 rounded-full border border-black/10 transition-transform hover:scale-105",
                      policyColorDot[color],
                      draft.color === color && "ring-2 ring-ring ring-offset-2"
                    )}
                  />
                ))}
              </div>
            </FormField>
            <FormField
              label="Default for organization"
              description="Pre-selected when enrolling devices and creating tokens."
            >
              <div className="flex h-9 items-center">
                <Switch
                  checked={draft.isDefault}
                  onCheckedChange={(isDefault) =>
                    setDraft((current) => ({ ...current, isDefault }))
                  }
                  aria-label="Default policy"
                />
              </div>
            </FormField>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? "Saving…" : policy ? "Save changes" : "Create policy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
