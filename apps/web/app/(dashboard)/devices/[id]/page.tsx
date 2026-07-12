"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/dashboard/empty-state"
import { CodeBlock } from "@/components/dashboard/code-block"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { VpnStatusStrip } from "@/components/dashboard/stat-strip"
import {
  formatBytes,
  formatDate,
  statusLabel,
  statusVariant,
} from "@/lib/dashboard"
import {
  buildLinuxUninstallCommand,
  buildWindowsUninstallCommand,
} from "@/lib/enrollment-commands"
import { getClientVpnBaseUrl } from "@/lib/product-name"
import { trpc } from "@/lib/trpc"
import { serviceDefaults, type ServiceType } from "@nms/shared"

const serviceTypes = ["vnc", "rdp", "ssh", "winrm_https"] as const
const quickServiceTypes = ["vnc", "rdp", "ssh"] as const

const serviceLabels: Record<ServiceType, string> = {
  vnc: "VNC",
  rdp: "RDP",
  ssh: "SSH",
  winrm_https: "WinRM",
}

const serviceDescriptions: Record<(typeof quickServiceTypes)[number], string> =
  {
    vnc: "Screen access",
    rdp: "Desktop access",
    ssh: "Terminal access",
  }

export default function DeviceConfigPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const deviceId = params.id
  const utils = trpc.useUtils()
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const deviceQuery = trpc.devices.byId.useQuery(
    { id: deviceId },
    { enabled: Boolean(deviceId) }
  )

  const updateDevice = trpc.devices.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Device updated")
    },
    onError() {
      toast.error("We couldn't update the device.")
    },
  })
  const assignRoutePolicy = trpc.devices.assignRoutePolicy.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Route policy updated")
    },
    onError() {
      toast.error("We couldn't update the route policy.")
    },
  })
  const revokeVpn = trpc.devices.revokeVpn.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("VPN access revoked")
    },
    onError() {
      toast.error("We couldn't revoke VPN access.")
    },
  })
  const deleteDevice = trpc.devices.delete.useMutation({
    async onSuccess() {
      await utils.devices.list.invalidate()
      toast.success("Device removed")
      router.push("/devices")
    },
    onError() {
      toast.error("We couldn't remove the device.")
    },
  })
  const createService = trpc.managementServices.create.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
      toast.success("Service added")
    },
    onError() {
      toast.error("We couldn't add the service.")
    },
  })
  const updateService = trpc.managementServices.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
      toast.success("Service updated")
    },
    onError() {
      toast.error("We couldn't update the service.")
    },
  })
  const deleteService = trpc.managementServices.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
      toast.success("Service removed")
    },
    onError() {
      toast.error("We couldn't remove the service.")
    },
  })
  const setCredential = trpc.managementServices.setCredential.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
      toast.success("Password saved")
    },
    onError() {
      toast.error("We couldn't save the password.")
    },
  })
  const setSshCredential = trpc.managementServices.setSshCredential.useMutation(
    {
      async onSuccess() {
        await Promise.all([
          utils.devices.byId.invalidate(),
          utils.managementServices.list.invalidate(),
        ])
        toast.success("SSH key saved")
      },
      onError() {
        toast.error("We couldn't save the SSH key.")
      },
    }
  )
  const clearCredential = trpc.managementServices.clearCredential.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
      toast.success("Credential cleared")
    },
    onError() {
      toast.error("We couldn't clear the credential.")
    },
  })
  const launchSession = trpc.sessions.create.useMutation({
    onSuccess(result) {
      if (!result) {
        return
      }

      window.open(result.url, "_blank", "noopener,noreferrer")
    },
    onError() {
      toast.error("Couldn't start the session.")
    },
  })

  const [deviceName, setDeviceName] = React.useState("")
  const [deviceHostname, setDeviceHostname] = React.useState("")
  const [deviceSiteId, setDeviceSiteId] = React.useState("")
  const [deviceRoutePolicyId, setDeviceRoutePolicyId] = React.useState("")
  const [newServiceType, setNewServiceType] =
    React.useState<(typeof serviceTypes)[number]>("ssh")
  const [newServiceProtocol, setNewServiceProtocol] = React.useState<string>(
    serviceDefaults.ssh.protocol
  )
  const [newServicePort, setNewServicePort] = React.useState(
    String(serviceDefaults.ssh.port)
  )
  const sitesQuery = trpc.sites.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const [installBaseUrl, setInstallBaseUrl] =
    React.useState(getClientVpnBaseUrl)

  React.useEffect(() => {
    setInstallBaseUrl(getClientVpnBaseUrl())
  }, [])

  React.useEffect(() => {
    if (deviceQuery.data) {
      setDeviceName(deviceQuery.data.displayName)
      setDeviceHostname(deviceQuery.data.hostname ?? "")
      setDeviceSiteId(deviceQuery.data.siteId ?? "")
      setDeviceRoutePolicyId(deviceQuery.data.vpnIdentity?.routePolicyId ?? "")
    }
  }, [deviceQuery.data])

  const device = deviceQuery.data
  const linuxUninstallCommand = buildLinuxUninstallCommand({
    baseUrl: installBaseUrl,
  })
  const windowsUninstallCommand = buildWindowsUninstallCommand({
    baseUrl: installBaseUrl,
  })
  const serviceByType = React.useMemo(
    () =>
      new Map(
        (device?.services ?? []).map((service) => [
          service.serviceType as ServiceType,
          service,
        ])
      ),
    [device?.services]
  )
  const sites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const routePolicies = React.useMemo(
    () => routePoliciesQuery.data ?? [],
    [routePoliciesQuery.data]
  )

  const vpnStatus = device
    ? device.vpnIdentity?.revokedAt
      ? "revoked"
      : device.vpnIdentity?.lastHandshakeAt
        ? "vpn_online"
        : "pending"
    : "pending"

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Device config"
        title={device ? device.displayName : "Device details"}
        description="Edit the device, adjust service entries, and launch remote access from one place."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/devices">Back</Link>
          </Button>
        }
      />

      {deviceQuery.isLoading ? (
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-6 w-48" />
          </CardContent>
        </Card>
      ) : !device ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              title="Device not found"
              description="We couldn't find that device."
              bordered={false}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Device details</CardTitle>
              <CardDescription>
                Update the selected device and its connection state.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Display name" htmlFor="device-name">
                  <Input
                    id="device-name"
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                  />
                </FormField>
                <FormField label="Host name" htmlFor="device-hostname">
                  <Input
                    id="device-hostname"
                    value={deviceHostname}
                    onChange={(event) => setDeviceHostname(event.target.value)}
                  />
                </FormField>
                <FormField label="Site" htmlFor="device-site">
                  <NativeSelect
                    id="device-site"
                    value={deviceSiteId}
                    onChange={(event) => setDeviceSiteId(event.target.value)}
                  >
                    <option value="">No site</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Route policy" htmlFor="device-route-policy">
                  <NativeSelect
                    id="device-route-policy"
                    value={deviceRoutePolicyId}
                    onChange={(event) =>
                      setDeviceRoutePolicyId(event.target.value)
                    }
                  >
                    <option value="">No policy</option>
                    {routePolicies.map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => {
                    void updateDevice.mutateAsync({
                      id: device.id,
                      displayName: deviceName,
                      hostname: deviceHostname || null,
                      siteId: deviceSiteId || null,
                    })
                  }}
                  disabled={!deviceName || updateDevice.isPending}
                >
                  Save device
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void assignRoutePolicy.mutateAsync({
                      id: device.id,
                      routePolicyId: deviceRoutePolicyId || null,
                    })
                  }}
                  disabled={assignRoutePolicy.isPending}
                >
                  Save route policy
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void revokeVpn.mutateAsync({ id: device.id })
                  }}
                  disabled={
                    revokeVpn.isPending ||
                    Boolean(device.vpnIdentity?.revokedAt)
                  }
                >
                  Revoke VPN
                </Button>
              </div>

              <VpnStatusStrip
                items={[
                  {
                    label: "VPN",
                    value: (
                      <Badge variant={statusVariant[vpnStatus] ?? "outline"}>
                        {statusLabel(vpnStatus)}
                      </Badge>
                    ),
                  },
                  {
                    label: "Last connected",
                    value: formatDate(device.vpnIdentity?.lastHandshakeAt),
                  },
                  {
                    label: "Endpoint",
                    value: device.vpnIdentity?.latestEndpoint ?? "—",
                  },
                  {
                    label: "Traffic",
                    value: `${formatBytes(device.vpnIdentity?.rxBytes)} in / ${formatBytes(device.vpnIdentity?.txBytes)} out`,
                  },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Uninstall</CardTitle>
              <CardDescription>
                Run this on the device to remove the tunnel and local files.
                After uninstall, revoke VPN access or remove the device from
                inventory.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <CodeBlock label="Linux" value={linuxUninstallCommand} />
              <CodeBlock label="Windows" value={windowsUninstallCommand} />
              <div className="border-t pt-4">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setDeleteOpen(true)}
                  disabled={deleteDevice.isPending}
                >
                  Remove from inventory
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Services</CardTitle>
              <CardDescription>
                Manage the connection details attached to this device.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-3 md:grid-cols-3">
                {quickServiceTypes.map((serviceType) => {
                  const defaults = serviceDefaults[serviceType]
                  const existingService = serviceByType.get(serviceType)
                  const isEnabled = Boolean(existingService?.enabled)

                  return (
                    <div
                      key={serviceType}
                      className="flex min-h-32 flex-col justify-between rounded-xl border bg-card p-4"
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">
                              {serviceLabels[serviceType]}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {serviceDescriptions[serviceType]}
                            </p>
                          </div>
                          <Badge variant={isEnabled ? "secondary" : "outline"}>
                            {isEnabled ? "Enabled" : "Off"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {defaults.protocol} · {defaults.port}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-4 w-fit"
                        variant={isEnabled ? "outline" : "default"}
                        onClick={() => {
                          if (existingService) {
                            void updateService.mutateAsync({
                              id: existingService.id,
                              serviceType,
                              protocol: defaults.protocol,
                              port: defaults.port,
                              enabled: true,
                            })
                            return
                          }

                          void createService.mutateAsync({
                            deviceId: device.id,
                            serviceType,
                            protocol: defaults.protocol,
                            port: defaults.port,
                            enabled: true,
                          })
                        }}
                        disabled={
                          isEnabled ||
                          createService.isPending ||
                          updateService.isPending
                        }
                      >
                        {isEnabled
                          ? "Enabled"
                          : `Enable ${serviceLabels[serviceType]}`}
                      </Button>
                    </div>
                  )
                })}
              </div>

              <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-5 md:items-end">
                <FormField label="Type" htmlFor="new-service-type">
                  <NativeSelect
                    id="new-service-type"
                    value={newServiceType}
                    onChange={(event) => {
                      const serviceType = event.target
                        .value as (typeof serviceTypes)[number]
                      const defaults = serviceDefaults[serviceType]

                      setNewServiceType(serviceType)
                      setNewServiceProtocol(defaults.protocol)
                      setNewServicePort(String(defaults.port))
                    }}
                  >
                    {serviceTypes.map((type) => (
                      <option key={type} value={type}>
                        {serviceLabels[type]}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Protocol" htmlFor="new-service-protocol">
                  <Input
                    id="new-service-protocol"
                    value={newServiceProtocol}
                    onChange={(event) =>
                      setNewServiceProtocol(event.target.value)
                    }
                  />
                </FormField>
                <FormField label="Port" htmlFor="new-service-port">
                  <Input
                    id="new-service-port"
                    type="number"
                    value={newServicePort}
                    onChange={(event) => setNewServicePort(event.target.value)}
                  />
                </FormField>
                <div className="md:col-span-2">
                  <Button
                    type="button"
                    onClick={() => {
                      void createService.mutateAsync({
                        deviceId: device.id,
                        serviceType: newServiceType,
                        protocol: newServiceProtocol,
                        port: Number(newServicePort),
                        enabled: true,
                      })
                    }}
                    disabled={createService.isPending}
                  >
                    Add service
                  </Button>
                </div>
              </div>

              {device.services.length === 0 ? (
                <EmptyState title="No services yet" bordered />
              ) : (
                device.services.map((service) => {
                  const serviceType = service.serviceType as ServiceType
                  const isVnc = serviceType === "vnc"
                  const isRdp = serviceType === "rdp"
                  const isSsh = serviceType === "ssh"
                  const isPasswordService = isVnc || isRdp

                  return (
                    <div
                      key={service.id}
                      className="grid gap-3 rounded-lg border p-4 md:grid-cols-5 md:items-end"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-5">
                        <div>
                          <p className="font-medium">
                            {serviceLabels[serviceType]}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {service.protocol} · {service.port}
                          </p>
                        </div>
                        <Badge
                          variant={service.enabled ? "secondary" : "outline"}
                        >
                          {service.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>

                      {isPasswordService ? (
                        <div className="rounded-lg border bg-muted/20 p-3 text-sm md:col-span-5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">
                                {serviceLabels[serviceType]}
                              </p>
                              <p className="text-muted-foreground">
                                {serviceDefaults[serviceType].protocol} ·{" "}
                                {serviceDefaults[serviceType].port}
                              </p>
                            </div>
                            {service.enabled ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  void launchSession.mutateAsync({
                                    deviceId: device.id,
                                    serviceId: service.id,
                                    connectionMethod: "guacamole",
                                  })
                                }}
                                disabled={launchSession.isPending}
                              >
                                Launch
                              </Button>
                            ) : (
                              <Badge variant="outline">Enable to launch</Badge>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge
                              variant={
                                service.hasSavedPassword
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {service.hasSavedPassword
                                ? "Saved password"
                                : "No saved password"}
                            </Badge>
                          </div>
                          <label className="mt-3 flex items-center gap-2 text-sm">
                            <Checkbox
                              defaultChecked={service.enabled}
                              name={`enabled-${service.id}`}
                            />
                            Enabled
                          </label>
                        </div>
                      ) : (
                        <>
                          <FormField
                            label="Type"
                            htmlFor={`service-type-${service.id}`}
                          >
                            <NativeSelect
                              id={`service-type-${service.id}`}
                              name={`serviceType-${service.id}`}
                              defaultValue={service.serviceType}
                            >
                              {serviceTypes.map((type) => (
                                <option key={type} value={type}>
                                  {serviceLabels[type]}
                                </option>
                              ))}
                            </NativeSelect>
                          </FormField>
                          <FormField
                            label="Protocol"
                            htmlFor={`service-protocol-${service.id}`}
                          >
                            <Input
                              id={`service-protocol-${service.id}`}
                              name={`protocol-${service.id}`}
                              defaultValue={service.protocol}
                            />
                          </FormField>
                          <FormField
                            label="Port"
                            htmlFor={`service-port-${service.id}`}
                          >
                            <Input
                              id={`service-port-${service.id}`}
                              name={`port-${service.id}`}
                              type="number"
                              defaultValue={service.port}
                            />
                          </FormField>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              defaultChecked={service.enabled}
                              name={`enabled-${service.id}`}
                            />
                            Enabled
                          </label>
                          {isSsh ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={
                                  service.hasSavedPassword
                                    ? "secondary"
                                    : "outline"
                                }
                              >
                                {service.hasSavedPassword
                                  ? "Saved key"
                                  : "No saved key"}
                              </Badge>
                              {service.enabled ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => {
                                    void launchSession.mutateAsync({
                                      deviceId: device.id,
                                      serviceId: service.id,
                                      connectionMethod: "guacamole",
                                    })
                                  }}
                                  disabled={launchSession.isPending}
                                >
                                  Launch
                                </Button>
                              ) : (
                                <Badge variant="outline">
                                  Enable to launch
                                </Badge>
                              )}
                            </div>
                          ) : null}
                        </>
                      )}

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            const enabled = Boolean(
                              document.querySelector<HTMLInputElement>(
                                `input[name="enabled-${service.id}"]`
                              )?.checked
                            )
                            const nextServiceType = isPasswordService
                              ? serviceType
                              : (String(
                                  document.querySelector<HTMLSelectElement>(
                                    `select[name="serviceType-${service.id}"]`
                                  )?.value ?? service.serviceType
                                ) as (typeof serviceTypes)[number])
                            const nextProtocol =
                              serviceDefaults[nextServiceType].protocol
                            const nextPort =
                              serviceDefaults[nextServiceType].port

                            void updateService.mutateAsync({
                              id: service.id,
                              serviceType: nextServiceType,
                              protocol: nextProtocol,
                              port: nextPort,
                              enabled,
                            })
                          }}
                          disabled={updateService.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void deleteService.mutateAsync({ id: service.id })
                          }}
                          disabled={deleteService.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                      {isPasswordService && service.enabled ? (
                        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap md:col-span-5">
                          <Input
                            name={`password-${service.id}`}
                            type="password"
                            placeholder="Set password"
                            className="w-full sm:min-w-64"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault()
                              }
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="w-full sm:w-auto"
                            onClick={(event) => {
                              const form = event.currentTarget.parentElement
                              const passwordInput = form?.querySelector(
                                `input[name="password-${service.id}"]`
                              ) as HTMLInputElement | null

                              const password = passwordInput?.value ?? ""

                              if (!password) {
                                return
                              }

                              void setCredential.mutateAsync({
                                id: service.id,
                                password,
                              })
                            }}
                            disabled={setCredential.isPending}
                          >
                            Save password
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void clearCredential.mutateAsync({
                                id: service.id,
                              })
                            }}
                            disabled={
                              clearCredential.isPending ||
                              !service.hasSavedPassword
                            }
                          >
                            Clear password
                          </Button>
                        </div>
                      ) : null}
                      {isSsh && service.enabled ? (
                        <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 md:col-span-5">
                          <div className="grid gap-2 md:grid-cols-2">
                            <Input
                              name={`ssh-username-${service.id}`}
                              placeholder="Username"
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault()
                                }
                              }}
                            />
                            <Textarea
                              name={`ssh-private-key-${service.id}`}
                              placeholder="Private key"
                              className="min-h-24 font-mono text-xs"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={(event) => {
                                const container = event.currentTarget.closest(
                                  "div.md\\:col-span-5"
                                )
                                const usernameInput = container?.querySelector(
                                  `input[name="ssh-username-${service.id}"]`
                                ) as HTMLInputElement | null
                                const privateKeyInput =
                                  container?.querySelector(
                                    `textarea[name="ssh-private-key-${service.id}"]`
                                  ) as HTMLTextAreaElement | null
                                const username =
                                  usernameInput?.value.trim() ?? ""
                                const privateKey =
                                  privateKeyInput?.value.trim() ?? ""

                                if (!username || !privateKey) {
                                  return
                                }

                                void setSshCredential.mutateAsync({
                                  id: service.id,
                                  username,
                                  privateKey,
                                })
                              }}
                              disabled={setSshCredential.isPending}
                            >
                              Save key
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                void clearCredential.mutateAsync({
                                  id: service.id,
                                })
                              }}
                              disabled={
                                clearCredential.isPending ||
                                !service.hasSavedPassword
                              }
                            >
                              Clear key
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove device"
        description={
          device
            ? `Remove ${device.displayName} from inventory? Related access entries will be cleared. Uninstall the tunnel on the device first if it is still installed.`
            : "Remove this device from inventory?"
        }
        confirmLabel="Remove device"
        destructive
        pending={deleteDevice.isPending}
        onConfirm={() => {
          if (!device) return
          void deleteDevice.mutateAsync({ id: device.id })
        }}
      />
    </div>
  )
}
