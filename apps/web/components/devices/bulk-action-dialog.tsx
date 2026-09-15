"use client"

import * as React from "react"
import type { DeviceBulkAction } from "@nms/shared"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { TagEditor } from "@/components/devices/tag-chips"

export type BulkActionKind = DeviceBulkAction["action"]

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never

/** A bulk action payload without the target ids (supplied by the table). */
export type BulkActionPayload = DistributiveOmit<DeviceBulkAction, "ids">

const titles: Record<BulkActionKind, string> = {
  assign_site: "Move to a site",
  assign_route_policy: "Assign a route policy",
  add_tags: "Add tags",
  remove_tags: "Remove tags",
  revoke_vpn: "Revoke tunnel access",
  delete: "Remove from inventory",
}

export function BulkActionDialog({
  action,
  count,
  sites,
  routePolicies,
  tagSuggestions,
  pending,
  onClose,
  onConfirm,
}: {
  action: BulkActionKind | null
  count: number
  sites: Array<{ id: string; name: string }>
  routePolicies: Array<{ id: string; name: string }>
  tagSuggestions: string[]
  pending: boolean
  onClose: () => void
  onConfirm: (payload: BulkActionPayload) => void
}) {
  const [siteId, setSiteId] = React.useState("")
  const [routePolicyId, setRoutePolicyId] = React.useState("")
  const [tags, setTags] = React.useState<string[]>([])

  const open = action !== null
  const label = `${count} ${count === 1 ? "device" : "devices"}`

  function reset() {
    setSiteId("")
    setRoutePolicyId("")
    setTags([])
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!action) return
    switch (action) {
      case "assign_site":
        onConfirm({ action, siteId: siteId || null })
        break
      case "assign_route_policy":
        onConfirm({ action, routePolicyId: routePolicyId || null })
        break
      case "add_tags":
      case "remove_tags":
        if (tags.length === 0) return
        onConfirm({ action, tags })
        break
      case "revoke_vpn":
      case "delete":
        onConfirm({ action })
        break
    }
  }

  const destructive = action === "revoke_vpn" || action === "delete"
  const disabled =
    pending ||
    ((action === "add_tags" || action === "remove_tags") && tags.length === 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {action ? (
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{titles[action]}</DialogTitle>
              <DialogDescription>
                {action === "assign_site"
                  ? `Move ${label} to a site. Access for site-scoped users updates immediately.`
                  : action === "assign_route_policy"
                    ? `Apply one route policy to ${label}. The tunnel reconciles on its next pass.`
                    : action === "add_tags"
                      ? `Tags are added to ${label}; existing tags stay.`
                      : action === "remove_tags"
                        ? `These tags are removed from ${label} where present.`
                        : action === "revoke_vpn"
                          ? `${label} will lose tunnel access right away. Re-enrollment is required to restore it.`
                          : `Remove ${label} from inventory. Related access entries are cleared. This cannot be undone.`}
              </DialogDescription>
            </DialogHeader>

            {action === "assign_site" ? (
              <FormField label="Site" htmlFor="bulk-site">
                <NativeSelect
                  id="bulk-site"
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value)}
                >
                  <option value="">No site</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}

            {action === "assign_route_policy" ? (
              <FormField label="Route policy" htmlFor="bulk-policy">
                <NativeSelect
                  id="bulk-policy"
                  value={routePolicyId}
                  onChange={(event) => setRoutePolicyId(event.target.value)}
                >
                  <option value="">No policy</option>
                  {routePolicies.map((policy) => (
                    <option key={policy.id} value={policy.id}>
                      {policy.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}

            {action === "add_tags" || action === "remove_tags" ? (
              <FormField label="Tags" htmlFor="bulk-tags">
                <TagEditor
                  id="bulk-tags"
                  value={tags}
                  onChange={setTags}
                  suggestions={tagSuggestions}
                  placeholder="Type a tag and press Enter"
                />
              </FormField>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  reset()
                  onClose()
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={destructive ? "destructive" : "default"}
                disabled={disabled}
              >
                {pending ? "Applying…" : titles[action]}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
