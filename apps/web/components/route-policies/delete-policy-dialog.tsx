"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"
import { trpc } from "@/lib/trpc"

import type { RoutePolicyRecord } from "./policy-dialog"

/**
 * Removing a policy would silently strip routes from every device on it, so
 * the dialog asks where those devices and tokens should move first.
 */
export function DeletePolicyDialog({
  open,
  onOpenChange,
  policy,
  policies,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  policy: RoutePolicyRecord | null
  policies: RoutePolicyRecord[]
  onDeleted?: () => void
}) {
  const utils = trpc.useUtils()
  const [reassignTo, setReassignTo] = React.useState("")
  const [seed, setSeed] = React.useState(policy?.id ?? null)
  if (seed !== (policy?.id ?? null)) {
    setSeed(policy?.id ?? null)
    setReassignTo("")
  }

  const deleteMutation = trpc.routePolicies.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.routePolicies.list.invalidate(),
        utils.routePolicies.allocation.invalidate(),
        utils.devices.page.invalidate(),
        utils.devices.facets.invalidate(),
        utils.enrollmentTokens.list.invalidate(),
        utils.audit.page.invalidate(),
      ])
      toast.success("Route policy removed")
      onDeleted?.()
      onOpenChange(false)
    },
    onError(error) {
      toast.error(error.message || "We couldn't remove the route policy.")
    },
  })

  const candidates = policies.filter(
    (candidate) =>
      candidate.id !== policy?.id &&
      (candidate.organizationId === null ||
        candidate.organizationId === policy?.organizationId)
  )
  const inUse = (policy?.deviceCount ?? 0) + (policy?.tokenCount ?? 0) > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !deleteMutation.isPending && onOpenChange(next)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove route policy</DialogTitle>
          <DialogDescription>
            {policy
              ? inUse
                ? `${policy.name} is used by ${policy.deviceCount} ${
                    policy.deviceCount === 1 ? "device" : "devices"
                  } and ${policy.tokenCount} active ${
                    policy.tokenCount === 1 ? "token" : "tokens"
                  }. Choose where they should move.`
                : `Remove ${policy.name}? Nothing is using it right now.`
              : "Remove this route policy?"}
          </DialogDescription>
        </DialogHeader>

        {policy && inUse ? (
          <FormField
            label="Move devices and tokens to"
            htmlFor="policy-reassign"
            description="Devices moved to no policy only reach the tunnel itself."
          >
            <SelectField
              id="policy-reassign"
              value={reassignTo}
              onValueChange={setReassignTo}
              emptyLabel="No policy"
              placeholder="Choose a policy"
              options={candidates.map((candidate) => ({
                value: candidate.id,
                label: candidate.name,
              }))}
            />
          </FormField>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!policy || deleteMutation.isPending}
            onClick={() => {
              if (!policy) return
              deleteMutation.mutate({
                id: policy.id,
                reassignTo: reassignTo || null,
              })
            }}
          >
            {deleteMutation.isPending ? "Removing…" : "Remove policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
