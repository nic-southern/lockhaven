"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CodeBlock } from "@/components/dashboard/code-block"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { FormField } from "@/components/dashboard/form-field"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import {
  buildLinuxUninstallCommand,
  buildWindowsUninstallCommand,
} from "@/lib/enrollment-commands"
import { getClientVpnBaseUrl } from "@/lib/product-name"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

import { type DeviceDetail, useInvalidateDevice } from "./shared"

export function SettingsTab({ device }: { device: DeviceDetail }) {
  const router = useRouter()
  const { can } = usePermissions()
  const canUpdate = can("device:update")
  const canRevoke = can("device:revoke_vpn")
  const canDelete = can("device:delete")
  const invalidate = useInvalidateDevice(device.id)

  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: canUpdate })
  const routePoliciesQuery = trpc.routePolicies.list.useQuery(undefined, {
    enabled: canUpdate,
  })

  const [displayName, setDisplayName] = React.useState(device.displayName)
  const [hostname, setHostname] = React.useState(device.hostname ?? "")
  const [siteId, setSiteId] = React.useState(device.siteId ?? "")
  const [routePolicyId, setRoutePolicyId] = React.useState(
    device.vpnIdentity?.routePolicyId ?? ""
  )
  const [confirm, setConfirm] = React.useState<"revoke" | "delete" | null>(null)

  // Reset the form when the server record changes underneath it.
  const [baseline, setBaseline] = React.useState(device)
  if (baseline !== device) {
    setBaseline(device)
    setDisplayName(device.displayName)
    setHostname(device.hostname ?? "")
    setSiteId(device.siteId ?? "")
    setRoutePolicyId(device.vpnIdentity?.routePolicyId ?? "")
  }

  const detailsDirty =
    displayName.trim() !== device.displayName ||
    hostname.trim() !== (device.hostname ?? "") ||
    siteId !== (device.siteId ?? "")
  const policyDirty =
    routePolicyId !== (device.vpnIdentity?.routePolicyId ?? "")

  const updateDevice = trpc.devices.update.useMutation({
    async onSuccess() {
      await invalidate()
      toast.success("Device updated")
    },
    onError() {
      toast.error("We couldn't update the device.")
    },
  })
  const assignRoutePolicy = trpc.devices.assignRoutePolicy.useMutation({
    async onSuccess() {
      await invalidate()
      toast.success("Route policy updated")
    },
    onError() {
      toast.error("We couldn't update the route policy.")
    },
  })
  const revokeVpn = trpc.devices.revokeVpn.useMutation({
    async onSuccess() {
      await invalidate()
      setConfirm(null)
      toast.success("Tunnel access revoked")
    },
    onError() {
      toast.error("We couldn't revoke tunnel access.")
    },
  })
  const deleteDevice = trpc.devices.delete.useMutation({
    async onSuccess() {
      await invalidate()
      toast.success("Device removed")
      router.push("/devices")
    },
    onError() {
      toast.error("We couldn't remove the device.")
    },
  })

  const baseUrl = getClientVpnBaseUrl()
  const linuxUninstall = buildLinuxUninstallCommand({ baseUrl })
  const windowsUninstall = buildWindowsUninstallCommand({ baseUrl })
  const alreadyRevoked = Boolean(device.vpnIdentity?.revokedAt)

  return (
    <div className="flex flex-col gap-6">
      {canUpdate ? (
        <SectionCard
          title="Details"
          description="How this device is named and where it belongs."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Display name" htmlFor="device-name">
              <Input
                id="device-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </FormField>
            <FormField
              label="Host name"
              htmlFor="device-hostname"
              description="Reported by the agent; override only if it's wrong."
            >
              <Input
                id="device-hostname"
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
              />
            </FormField>
            <FormField label="Site" htmlFor="device-site">
              <SelectField
                id="device-site"
                value={siteId}
                onValueChange={setSiteId}
                emptyLabel="No site"
                options={(sitesQuery.data ?? []).map((site) => ({
                  value: site.id,
                  label: site.name,
                }))}
              />
            </FormField>
          </div>
          <div className="mt-6 flex gap-2">
            <Button
              disabled={
                !detailsDirty ||
                displayName.trim().length === 0 ||
                updateDevice.isPending
              }
              onClick={() =>
                updateDevice.mutate({
                  id: device.id,
                  displayName: displayName.trim(),
                  hostname: hostname.trim() || null,
                  siteId: siteId || null,
                })
              }
            >
              {updateDevice.isPending ? "Saving…" : "Save details"}
            </Button>
            {detailsDirty ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDisplayName(device.displayName)
                  setHostname(device.hostname ?? "")
                  setSiteId(device.siteId ?? "")
                }}
              >
                Discard
              </Button>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {canUpdate && device.vpnIdentity ? (
        <SectionCard
          title="Route policy"
          description="Which private networks this device can reach through the tunnel."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Policy" htmlFor="device-route-policy">
              <SelectField
                id="device-route-policy"
                value={routePolicyId}
                onValueChange={setRoutePolicyId}
                emptyLabel="No policy"
                options={(routePoliciesQuery.data ?? []).map((policy) => ({
                  value: policy.id,
                  label: policy.name,
                  description:
                    policy.routes.length > 0
                      ? policy.routes.slice(0, 3).join(", ") +
                        (policy.routes.length > 3
                          ? ` +${policy.routes.length - 3}`
                          : "")
                      : undefined,
                }))}
              />
            </FormField>
          </div>
          <div className="mt-6 flex gap-2">
            <Button
              disabled={!policyDirty || assignRoutePolicy.isPending}
              onClick={() =>
                assignRoutePolicy.mutate({
                  id: device.id,
                  routePolicyId: routePolicyId || null,
                })
              }
            >
              {assignRoutePolicy.isPending ? "Saving…" : "Save route policy"}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Uninstall"
        description="Run this on the device to remove the tunnel and local files, then revoke access or remove the device below."
      >
        <div className="flex flex-col gap-4">
          <CodeBlock label="Linux" value={linuxUninstall} />
          <CodeBlock label="Windows" value={windowsUninstall} />
        </div>
      </SectionCard>

      {canRevoke || canDelete ? (
        <SectionCard
          title="Danger zone"
          description="These actions are recorded in the audit log and can't be undone from here."
          className="border-destructive/40"
        >
          <div className="flex flex-col divide-y">
            {canRevoke ? (
              <div className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Revoke tunnel access</p>
                  <p className="text-xs text-muted-foreground">
                    Disables the peer immediately. The device stays in inventory
                    and must re-enroll to reconnect.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={alreadyRevoked || !device.vpnIdentity}
                  onClick={() => setConfirm("revoke")}
                >
                  {alreadyRevoked ? "Already revoked" : "Revoke access"}
                </Button>
              </div>
            ) : null}
            {canDelete ? (
              <div className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Remove from inventory</p>
                  <p className="text-xs text-muted-foreground">
                    Deletes the device, its tunnel peer, services, and saved
                    credentials.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setConfirm("delete")}
                >
                  Remove device
                </Button>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(open) => (!open ? setConfirm(null) : null)}
        title="Revoke tunnel access"
        description={`Revoke tunnel access for ${device.displayName}? Active sessions will drop and the device must re-enroll to reconnect.`}
        confirmLabel="Revoke access"
        destructive
        pending={revokeVpn.isPending}
        onConfirm={() => revokeVpn.mutate({ id: device.id })}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => (!open ? setConfirm(null) : null)}
        title="Remove device"
        description={`Remove ${device.displayName} from inventory? Related access entries are cleared. Uninstall the tunnel on the device first if it is still installed.`}
        confirmLabel="Remove device"
        destructive
        pending={deleteDevice.isPending}
        onConfirm={() => deleteDevice.mutate({ id: device.id })}
      />
    </div>
  )
}
