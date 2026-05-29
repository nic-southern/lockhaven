"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { buildSocWindowsInstallCommand } from "@/lib/enrollment-commands"
import { formatBytes, formatDate, statusVariant } from "@/lib/dashboard"
import {
  getClientSocEnrollmentPassword,
  getClientSocBaseUrl,
} from "@/lib/product-name"
import { trpc } from "@/lib/trpc"

const serviceTypes = ["vnc", "rdp", "ssh", "winrm_https"] as const

export default function DevicesPage() {
  const utils = trpc.useUtils()
  const devicesQuery = trpc.devices.list.useQuery()
  const deviceIds = React.useMemo(
    () => devicesQuery.data ?? [],
    [devicesQuery.data]
  )
  const [selectedDeviceId, setSelectedDeviceId] = React.useState("")
  const sitesQuery = trpc.sites.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()

  const deviceQuery = trpc.devices.byId.useQuery(
    { id: selectedDeviceId },
    { enabled: Boolean(selectedDeviceId) }
  )

  const updateDevice = trpc.devices.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.list.invalidate(),
        utils.devices.byId.invalidate(),
      ])
    },
  })
  const assignRoutePolicy = trpc.devices.assignRoutePolicy.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.list.invalidate(),
        utils.devices.byId.invalidate(),
      ])
    },
  })
  const revokeVpn = trpc.devices.revokeVpn.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.list.invalidate(),
        utils.devices.byId.invalidate(),
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

  const [deviceName, setDeviceName] = React.useState("")
  const [deviceHostname, setDeviceHostname] = React.useState("")
  const [deviceSiteId, setDeviceSiteId] = React.useState("")
  const [deviceRoutePolicyId, setDeviceRoutePolicyId] = React.useState("")
  const [newServiceDeviceId, setNewServiceDeviceId] = React.useState("")
  const [newServiceType, setNewServiceType] =
    React.useState<(typeof serviceTypes)[number]>("ssh")
  const [newServiceProtocol, setNewServiceProtocol] = React.useState("tcp")
  const [newServicePort, setNewServicePort] = React.useState("22")
  const [socBaseUrl, setSocBaseUrl] = React.useState(getClientSocBaseUrl)
  const [socEnrollmentPassword, setSocEnrollmentPassword] = React.useState(
    getClientSocEnrollmentPassword
  )
  const selectedDevice = deviceQuery.data

  React.useEffect(() => {
    setSocBaseUrl(getClientSocBaseUrl())
    setSocEnrollmentPassword(getClientSocEnrollmentPassword())
  }, [])

  React.useEffect(() => {
    if (deviceIds.length === 0) {
      setSelectedDeviceId("")
      return
    }

    if (!deviceIds.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(deviceIds[0].id)
    }
  }, [deviceIds, selectedDeviceId])

  React.useEffect(() => {
    if (selectedDevice) {
      setDeviceName(selectedDevice.displayName)
      setDeviceHostname(selectedDevice.hostname ?? "")
      setDeviceSiteId(selectedDevice.siteId ?? "")
      setDeviceRoutePolicyId(selectedDevice.vpnIdentity?.routePolicyId ?? "")
      setNewServiceDeviceId(selectedDevice.id)
    }
  }, [selectedDevice])

  const sites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const routePolicies = React.useMemo(
    () => routePoliciesQuery.data ?? [],
    [routePoliciesQuery.data]
  )

  const vpnStatus = selectedDevice
    ? selectedDevice.vpnIdentity?.revokedAt
      ? "revoked"
      : selectedDevice.vpnIdentity?.lastHandshakeAt
        ? "vpn_online"
        : "pending"
    : "pending"
  const selectedDeviceSiteName = selectedDevice?.siteId
    ? (sites.find((site) => site.id === selectedDevice.siteId)?.name ?? "")
    : ""
  const selectedDeviceSocCommand =
    socBaseUrl && socEnrollmentPassword && selectedDeviceSiteName
      ? buildSocWindowsInstallCommand({
          baseUrl: socBaseUrl,
          siteName: selectedDeviceSiteName,
          enrollmentPassword: socEnrollmentPassword,
        })
      : ""
  const selectedDeviceSocFallback = !selectedDeviceSiteName
    ? "Assign a site to create this command."
    : "Add an enrollment password to create this command."

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          Devices
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Review device state, change the assigned site, update the VPN route
          policy, and manage service entries from one place.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              Pick a device to edit its details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devicesQuery.isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="py-8 text-center text-muted-foreground"
                      >
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : deviceIds.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No devices yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    deviceIds.map((device) => (
                      <TableRow
                        key={device.id}
                        className={
                          selectedDeviceId === device.id
                            ? "bg-muted/60"
                            : undefined
                        }
                        onClick={() => setSelectedDeviceId(device.id)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-col gap-1">
                            <span>{device.displayName}</span>
                            <span className="text-xs text-muted-foreground">
                              {device.siteName ?? "No site"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              statusVariant[device.status] ?? "secondary"
                            }
                          >
                            {device.status.replaceAll("_", " ")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Device details</CardTitle>
            <CardDescription>
              Edit the selected device and the services attached to it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedDevice ? (
              <>
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
                      onChange={(event) =>
                        setDeviceHostname(event.target.value)
                      }
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
                        id: selectedDevice.id,
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
                        id: selectedDevice.id,
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
                      void revokeVpn.mutateAsync({ id: selectedDevice.id })
                    }}
                    disabled={
                      revokeVpn.isPending ||
                      Boolean(selectedDevice.vpnIdentity?.revokedAt)
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
                      {formatDate(selectedDevice.vpnIdentity?.lastHandshakeAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Endpoint</p>
                    <p className="font-medium">
                      {selectedDevice.vpnIdentity?.latestEndpoint ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Traffic</p>
                    <p className="font-medium">
                      {formatBytes(selectedDevice.vpnIdentity?.rxBytes)} in /{" "}
                      {formatBytes(selectedDevice.vpnIdentity?.txBytes)} out
                    </p>
                  </div>
                </div>

                {socBaseUrl ? (
                  <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                    <div className="mb-3">
                      <p className="font-medium">Lockhaven SOC Host</p>
                      <p className="text-muted-foreground">
                        Run this command to add monitoring for this device.
                      </p>
                    </div>
                    {selectedDeviceSocCommand ? (
                      <pre className="overflow-auto rounded-md bg-background p-3 text-xs whitespace-pre-wrap">
                        {selectedDeviceSocCommand}
                      </pre>
                    ) : (
                      <p className="text-muted-foreground">
                        {selectedDeviceSocFallback}
                      </p>
                    )}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Services</p>
                      <p className="text-sm text-muted-foreground">
                        Edit the connection details for this device.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {(selectedDevice.services ?? []).map((service) => (
                      <form
                        key={service.id}
                        className="grid gap-3 rounded-lg border p-3 md:grid-cols-5 md:items-end"
                        onSubmit={(event) => {
                          event.preventDefault()
                          const form = new FormData(event.currentTarget)

                          void updateService.mutateAsync({
                            id: service.id,
                            serviceType: String(
                              form.get("serviceType")
                            ) as (typeof serviceTypes)[number],
                            protocol: String(form.get("protocol")),
                            port: Number(form.get("port")),
                            enabled: form.get("enabled") === "on",
                          })
                        }}
                      >
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Type</span>
                          <select
                            name="serviceType"
                            defaultValue={service.serviceType}
                            className="h-10 rounded-md border bg-background px-3"
                          >
                            {serviceTypes.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Protocol</span>
                          <input
                            name="protocol"
                            defaultValue={service.protocol}
                            className="h-10 rounded-md border bg-background px-3"
                          />
                        </label>
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Port</span>
                          <input
                            name="port"
                            type="number"
                            defaultValue={service.port}
                            className="h-10 rounded-md border bg-background px-3"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            name="enabled"
                            type="checkbox"
                            defaultChecked={service.enabled}
                            className="size-4 rounded border"
                          />
                          Enabled
                        </label>
                        <div className="flex gap-2 md:justify-end">
                          <Button
                            type="submit"
                            size="sm"
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
                      </form>
                    ))}
                  </div>

                  <form
                    className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-5 md:items-end"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void createService.mutateAsync({
                        deviceId: newServiceDeviceId,
                        serviceType: newServiceType,
                        protocol: newServiceProtocol,
                        port: Number(newServicePort),
                        enabled: true,
                      })
                    }}
                  >
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Type</span>
                      <select
                        value={newServiceType}
                        onChange={(event) =>
                          setNewServiceType(
                            event.target.value as (typeof serviceTypes)[number]
                          )
                        }
                        className="h-10 rounded-md border bg-background px-3"
                      >
                        {serviceTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
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
                        onChange={(event) =>
                          setNewServicePort(event.target.value)
                        }
                        className="h-10 rounded-md border bg-background px-3"
                      />
                    </label>
                    <label className="grid gap-2 text-sm md:col-span-2">
                      <span className="font-medium">Device</span>
                      <select
                        value={newServiceDeviceId}
                        onChange={(event) =>
                          setNewServiceDeviceId(event.target.value)
                        }
                        className="h-10 rounded-md border bg-background px-3"
                      >
                        {deviceIds.map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="md:col-span-5">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={
                          createService.isPending || !newServiceDeviceId
                        }
                      >
                        Add service
                      </Button>
                    </div>
                  </form>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a device to edit it.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
