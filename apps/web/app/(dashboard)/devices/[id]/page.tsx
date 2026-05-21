"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes, formatDate, statusVariant } from "@/lib/dashboard"
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
  const deviceId = params.id
  const utils = trpc.useUtils()

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
    },
  })
  const assignRoutePolicy = trpc.devices.assignRoutePolicy.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.devices.list.invalidate(),
      ])
    },
  })
  const revokeVpn = trpc.devices.revokeVpn.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.devices.list.invalidate(),
      ])
    },
  })
  const createService = trpc.managementServices.create.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
    },
  })
  const updateService = trpc.managementServices.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
    },
  })
  const deleteService = trpc.managementServices.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
    },
  })
  const setCredential = trpc.managementServices.setCredential.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
    },
  })
  const setSshCredential = trpc.managementServices.setSshCredential.useMutation(
    {
      async onSuccess() {
        await Promise.all([
          utils.devices.byId.invalidate(),
          utils.managementServices.list.invalidate(),
        ])
      },
    }
  )
  const clearCredential = trpc.managementServices.clearCredential.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.byId.invalidate(),
        utils.managementServices.list.invalidate(),
      ])
    },
  })
  const launchSession = trpc.sessions.create.useMutation({
    onSuccess(result) {
      if (!result) {
        return
      }

      window.open(result.url, "_blank", "noopener,noreferrer")
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

  React.useEffect(() => {
    if (deviceQuery.data) {
      setDeviceName(deviceQuery.data.displayName)
      setDeviceHostname(deviceQuery.data.hostname ?? "")
      setDeviceSiteId(deviceQuery.data.siteId ?? "")
      setDeviceRoutePolicyId(deviceQuery.data.vpnIdentity?.routePolicyId ?? "")
    }
  }, [deviceQuery.data])

  const device = deviceQuery.data
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
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Device config</Badge>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/devices">Back</Link>
            </Button>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {device ? device.displayName : "Device details"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Edit the device, adjust service entries, and launch remote access
            from one place.
          </p>
        </div>
      </section>

      {deviceQuery.isLoading ? (
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-6 w-48" />
          </CardContent>
        </Card>
      ) : !device ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            We couldn&apos;t find that device.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Device details</CardTitle>
              <CardDescription>
                Update the selected device and its connection state.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Display name</span>
                  <input
                    className="h-10 rounded-md border bg-background px-3"
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Host name</span>
                  <input
                    className="h-10 rounded-md border bg-background px-3"
                    value={deviceHostname}
                    onChange={(event) => setDeviceHostname(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Site</span>
                  <select
                    className="h-10 rounded-md border bg-background px-3"
                    value={deviceSiteId}
                    onChange={(event) => setDeviceSiteId(event.target.value)}
                  >
                    <option value="">No site</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Route policy</span>
                  <select
                    className="h-10 rounded-md border bg-background px-3"
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
                  </select>
                </label>
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

              <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm md:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">VPN</p>
                  <Badge variant={statusVariant[vpnStatus] ?? "outline"}>
                    {vpnStatus.replaceAll("_", " ")}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Last connected</p>
                  <p className="font-medium">
                    {formatDate(device.vpnIdentity?.lastHandshakeAt)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Endpoint</p>
                  <p className="font-medium">
                    {device.vpnIdentity?.latestEndpoint ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Traffic</p>
                  <p className="font-medium">
                    {formatBytes(device.vpnIdentity?.rxBytes)} in /{" "}
                    {formatBytes(device.vpnIdentity?.txBytes)} out
                  </p>
                </div>
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
            <CardContent className="space-y-3">
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
                      <div className="space-y-2">
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
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Type</span>
                  <select
                    value={newServiceType}
                    onChange={(event) => {
                      const serviceType = event.target
                        .value as (typeof serviceTypes)[number]
                      const defaults = serviceDefaults[serviceType]

                      setNewServiceType(serviceType)
                      setNewServiceProtocol(defaults.protocol)
                      setNewServicePort(String(defaults.port))
                    }}
                    className="h-10 rounded-md border bg-background px-3"
                  >
                    {serviceTypes.map((type) => (
                      <option key={type} value={type}>
                        {serviceLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Protocol</span>
                  <input
                    value={newServiceProtocol}
                    onChange={(event) =>
                      setNewServiceProtocol(event.target.value)
                    }
                    className="h-10 rounded-md border bg-background px-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Port</span>
                  <input
                    type="number"
                    value={newServicePort}
                    onChange={(event) => setNewServicePort(event.target.value)}
                    className="h-10 rounded-md border bg-background px-3"
                  />
                </label>
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
                <p className="text-sm text-muted-foreground">
                  No services yet.
                </p>
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
                            <input
                              defaultChecked={service.enabled}
                              type="checkbox"
                              className="size-4 rounded border"
                              name={`enabled-${service.id}`}
                            />
                            Enabled
                          </label>
                        </div>
                      ) : (
                        <>
                          <label className="grid gap-2 text-sm">
                            <span className="font-medium">Type</span>
                            <select
                              name={`serviceType-${service.id}`}
                              defaultValue={service.serviceType}
                              className="h-10 rounded-md border bg-background px-3"
                            >
                              {serviceTypes.map((type) => (
                                <option key={type} value={type}>
                                  {serviceLabels[type]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm">
                            <span className="font-medium">Protocol</span>
                            <input
                              name={`protocol-${service.id}`}
                              defaultValue={service.protocol}
                              className="h-10 rounded-md border bg-background px-3"
                            />
                          </label>
                          <label className="grid gap-2 text-sm">
                            <span className="font-medium">Port</span>
                            <input
                              name={`port-${service.id}`}
                              type="number"
                              defaultValue={service.port}
                              className="h-10 rounded-md border bg-background px-3"
                            />
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              defaultChecked={service.enabled}
                              type="checkbox"
                              className="size-4 rounded border"
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
                        <div className="flex flex-wrap gap-2 md:col-span-5">
                          <input
                            name={`password-${service.id}`}
                            type="password"
                            placeholder="Set password"
                            className="h-10 min-w-64 rounded-md border bg-background px-3"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault()
                              }
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
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
                            <input
                              name={`ssh-username-${service.id}`}
                              placeholder="Username"
                              className="h-10 rounded-md border bg-background px-3"
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault()
                                }
                              }}
                            />
                            <textarea
                              name={`ssh-private-key-${service.id}`}
                              placeholder="Private key"
                              className="min-h-24 rounded-md border bg-background px-3 py-2 font-mono text-xs"
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
    </div>
  )
}
