"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { VpnStatusStrip } from "@/components/dashboard/stat-strip"
import {
  formatBytes,
  formatDate,
  statusLabel,
  statusVariant,
} from "@/lib/dashboard"
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
      toast.success("Device updated")
    },
    onError() {
      toast.error("We couldn't update the device.")
    },
  })
  const assignRoutePolicy = trpc.devices.assignRoutePolicy.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.devices.list.invalidate(),
        utils.devices.byId.invalidate(),
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
        utils.devices.list.invalidate(),
        utils.devices.byId.invalidate(),
      ])
      toast.success("VPN access revoked")
    },
    onError() {
      toast.error("We couldn't revoke VPN access.")
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

  const [deviceName, setDeviceName] = React.useState("")
  const [deviceHostname, setDeviceHostname] = React.useState("")
  const [deviceSiteId, setDeviceSiteId] = React.useState("")
  const [deviceRoutePolicyId, setDeviceRoutePolicyId] = React.useState("")
  const [newServiceDeviceId, setNewServiceDeviceId] = React.useState("")
  const [newServiceType, setNewServiceType] =
    React.useState<(typeof serviceTypes)[number]>("ssh")
  const [newServiceProtocol, setNewServiceProtocol] = React.useState("tcp")
  const [newServicePort, setNewServicePort] = React.useState("22")
  const selectedDevice = deviceQuery.data

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Devices"
        title="Inventory"
        description="Review device state, change the assigned site, update the VPN route policy, and manage service entries from one place."
      />

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
                      <TableCell colSpan={2} className="p-0">
                        <EmptyState title="No devices yet" bordered={false} />
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
                            {statusLabel(device.status)}
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
          <CardContent className="flex flex-col gap-6">
            {selectedDevice ? (
              <>
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
                      onChange={(event) =>
                        setDeviceHostname(event.target.value)
                      }
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
                      value: formatDate(
                        selectedDevice.vpnIdentity?.lastHandshakeAt
                      ),
                    },
                    {
                      label: "Endpoint",
                      value: selectedDevice.vpnIdentity?.latestEndpoint ?? "—",
                    },
                    {
                      label: "Traffic",
                      value: `${formatBytes(selectedDevice.vpnIdentity?.rxBytes)} in / ${formatBytes(selectedDevice.vpnIdentity?.txBytes)} out`,
                    },
                  ]}
                />

                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium">Services</p>
                    <p className="text-sm text-muted-foreground">
                      Edit the connection details for this device.
                    </p>
                  </div>

                  {(selectedDevice.services ?? []).length === 0 ? (
                    <EmptyState title="No services yet" bordered />
                  ) : (
                    <div className="flex flex-col gap-3">
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
                          <FormField
                            label="Type"
                            htmlFor={`service-type-${service.id}`}
                          >
                            <NativeSelect
                              id={`service-type-${service.id}`}
                              name="serviceType"
                              defaultValue={service.serviceType}
                            >
                              {serviceTypes.map((type) => (
                                <option key={type} value={type}>
                                  {type}
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
                              name="protocol"
                              defaultValue={service.protocol}
                            />
                          </FormField>
                          <FormField
                            label="Port"
                            htmlFor={`service-port-${service.id}`}
                          >
                            <Input
                              id={`service-port-${service.id}`}
                              name="port"
                              type="number"
                              defaultValue={service.port}
                            />
                          </FormField>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              name="enabled"
                              defaultChecked={service.enabled}
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
                                void deleteService.mutateAsync({
                                  id: service.id,
                                })
                              }}
                              disabled={deleteService.isPending}
                            >
                              Remove
                            </Button>
                          </div>
                        </form>
                      ))}
                    </div>
                  )}

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
                    <FormField label="Type" htmlFor="new-service-type">
                      <NativeSelect
                        id="new-service-type"
                        value={newServiceType}
                        onChange={(event) =>
                          setNewServiceType(
                            event.target.value as (typeof serviceTypes)[number]
                          )
                        }
                      >
                        {serviceTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
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
                        onChange={(event) =>
                          setNewServicePort(event.target.value)
                        }
                      />
                    </FormField>
                    <FormField
                      label="Device"
                      htmlFor="new-service-device"
                      className="md:col-span-2"
                    >
                      <NativeSelect
                        id="new-service-device"
                        value={newServiceDeviceId}
                        onChange={(event) =>
                          setNewServiceDeviceId(event.target.value)
                        }
                      >
                        {deviceIds.map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.displayName}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
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
              <EmptyState
                title="No device selected"
                description="Choose a device from the list to edit it."
                bordered={false}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
