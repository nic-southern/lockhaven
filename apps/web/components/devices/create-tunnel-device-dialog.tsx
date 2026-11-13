"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"
import { WireGuardConfigDialog } from "@/components/vpn/wireguard-config-dialog"
import { downloadTextFile } from "@/lib/wireguard"
import { trpc } from "@/lib/trpc"

export function CreateTunnelDeviceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: open,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: open })
  const routePoliciesQuery = trpc.routePolicies.list.useQuery(undefined, {
    enabled: open,
  })

  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const sites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const routePolicies = React.useMemo(
    () => routePoliciesQuery.data ?? [],
    [routePoliciesQuery.data]
  )

  const [organizationId, setOrganizationId] = React.useState("")
  const [siteId, setSiteId] = React.useState("")
  const [name, setName] = React.useState("")
  const [chosenRoutePolicyId, setChosenRoutePolicyId] = React.useState<
    string | null
  >(null)
  const [sshEnabled, setSshEnabled] = React.useState(true)
  const [sshPort, setSshPort] = React.useState("22")
  const [issuedConfig, setIssuedConfig] = React.useState<{
    filename: string
    config: string
  } | null>(null)

  const orgSites = sites.filter(
    (site) => site.organizationId === organizationId
  )
  const orgPolicies = routePolicies.filter(
    (policy) =>
      policy.organizationId === null || policy.organizationId === organizationId
  )
  const defaultPolicy = orgPolicies.find(
    (policy) =>
      policy.isDefault &&
      (policy.organizationId === organizationId ||
        (policy.organizationId === null &&
          !orgPolicies.some(
            (row) => row.isDefault && row.organizationId === organizationId
          )))
  )
  const routePolicyId = chosenRoutePolicyId ?? defaultPolicy?.id ?? ""
  const sshPortNumber = Number(sshPort)
  const sshPortValid =
    Number.isInteger(sshPortNumber) &&
    sshPortNumber > 0 &&
    sshPortNumber <= 65535

  React.useEffect(() => {
    if (organizations.length > 0 && !organizationId) {
      setOrganizationId(organizations[0].id)
    }
  }, [organizationId, organizations])

  const createTunnel = trpc.devices.createTunnel.useMutation({
    async onSuccess(result) {
      await Promise.all([
        utils.devices.page.invalidate(),
        utils.devices.list.invalidate(),
        utils.devices.facets.invalidate(),
        utils.dashboard.summary.invalidate(),
      ])
      downloadTextFile(result.filename, result.config)
      setIssuedConfig({ filename: result.filename, config: result.config })
      setName("")
      setSshEnabled(true)
      setSshPort("22")
      onOpenChange(false)
      toast.success(
        "Tunnel-only device created. The config is shown only once."
      )
    },
    onError(error) {
      toast.error(error.message || "We couldn't create the WireGuard config.")
    },
  })

  const nameValid = name.trim().length > 0

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create WireGuard config</DialogTitle>
            <DialogDescription>
              For gateways and other hosts that cannot run the installer. The
              config is shown only once — download it or scan the QR code.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <FormField label="Organization" htmlFor="tunnel-device-org">
              <SelectField
                id="tunnel-device-org"
                value={organizationId}
                onValueChange={(value) => {
                  setOrganizationId(value)
                  setSiteId("")
                  setChosenRoutePolicyId(null)
                }}
                disabled={organizationsQuery.isLoading}
                options={organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
              />
            </FormField>
            <FormField
              label="Device name"
              htmlFor="tunnel-device-name"
              description="Used as the host name in inventory. Must be unique in this organization."
            >
              <Input
                id="tunnel-device-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Office gateway"
              />
            </FormField>
            <FormField
              label="Site"
              htmlFor="tunnel-device-site"
              description="Optional. Assign a site now, or later from the device page."
            >
              <SelectField
                id="tunnel-device-site"
                value={siteId}
                onValueChange={setSiteId}
                emptyLabel="No site"
                options={orgSites.map((site) => ({
                  value: site.id,
                  label: site.name,
                }))}
              />
            </FormField>
            <FormField label="Route policy" htmlFor="tunnel-device-policy">
              <SelectField
                id="tunnel-device-policy"
                value={routePolicyId}
                onValueChange={setChosenRoutePolicyId}
                emptyLabel="No policy"
                options={orgPolicies.map((policy) => ({
                  value: policy.id,
                  label: policy.isDefault
                    ? `${policy.name} (default)`
                    : policy.name,
                }))}
              />
            </FormField>
            <div className="flex items-center gap-2">
              <Checkbox
                id="tunnel-device-ssh"
                checked={sshEnabled}
                onCheckedChange={(checked) => setSshEnabled(checked === true)}
              />
              <Label
                htmlFor="tunnel-device-ssh"
                className="text-sm font-normal"
              >
                Add an SSH service
              </Label>
            </div>
            {sshEnabled ? (
              <FormField
                label="SSH port"
                htmlFor="tunnel-device-ssh-port"
                description="Reached at this device's tunnel address. Add credentials on the device page if you need Console SSH."
                error={sshPortValid ? undefined : "Use a port from 1 to 65535"}
              >
                <Input
                  id="tunnel-device-ssh-port"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={65535}
                  value={sshPort}
                  onChange={(event) => setSshPort(event.target.value)}
                />
              </FormField>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !organizationId ||
                !nameValid ||
                createTunnel.isPending ||
                (sshEnabled && !sshPortValid)
              }
              onClick={() =>
                createTunnel.mutate({
                  organizationId,
                  name: name.trim(),
                  siteId: siteId || null,
                  routePolicyId: routePolicyId || null,
                  ssh: sshEnabled
                    ? { enabled: true, port: sshPortNumber }
                    : { enabled: false },
                })
              }
            >
              {createTunnel.isPending ? "Creating…" : "Create and download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WireGuardConfigDialog
        open={issuedConfig !== null}
        filename={issuedConfig?.filename ?? ""}
        config={issuedConfig?.config ?? ""}
        onOpenChange={(next) => {
          if (!next) setIssuedConfig(null)
        }}
        title="Config ready"
        description="Scan this QR code with WireGuard, or download the config. Import it on the gateway, then activate the tunnel. It is shown only once."
      />
    </>
  )
}
