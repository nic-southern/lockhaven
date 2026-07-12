"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatDate, statusLabel } from "@/lib/dashboard"
import {
  openRemoteLaunchResult,
  preferredConnectionMethod,
} from "@/lib/remote-launch"
import { useAdminVpnConnected } from "@/lib/use-admin-vpn-connected"
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

export default function ConnectionsPage() {
  const utils = trpc.useUtils()
  const { connected: adminVpnConnected } = useAdminVpnConnected()
  const servicesQuery = trpc.managementServices.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const [createDeviceId, setCreateDeviceId] = React.useState("")
  const [createServiceType, setCreateServiceType] =
    React.useState<(typeof serviceTypes)[number]>("ssh")
  const [createProtocol, setCreateProtocol] = React.useState<string>(
    serviceDefaults.ssh.protocol
  )
  const [createPort, setCreatePort] = React.useState(
    String(serviceDefaults.ssh.port)
  )

  const createService = trpc.managementServices.create.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.managementServices.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Service created")
    },
    onError() {
      toast.error("We couldn't create the service.")
    },
  })
  const updateService = trpc.managementServices.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.managementServices.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Service updated")
    },
    onError() {
      toast.error("We couldn't update the service.")
    },
  })
  const setCredential = trpc.managementServices.setCredential.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.managementServices.list.invalidate(),
        utils.devices.list.invalidate(),
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
          utils.managementServices.list.invalidate(),
          utils.devices.list.invalidate(),
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
        utils.managementServices.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Credential cleared")
    },
    onError() {
      toast.error("We couldn't clear the credential.")
    },
  })
  const deleteService = trpc.managementServices.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.managementServices.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Service removed")
    },
    onError() {
      toast.error("We couldn't remove the service.")
    },
  })
  const launchSession = trpc.sessions.create.useMutation({
    onSuccess(result) {
      openRemoteLaunchResult(result)
    },
    onError() {
      toast.error("Couldn't start the session.")
    },
  })

  const services = React.useMemo(
    () => servicesQuery.data ?? [],
    [servicesQuery.data]
  )
  const devices = React.useMemo(
    () => devicesQuery.data ?? [],
    [devicesQuery.data]
  )

  React.useEffect(() => {
    if (devices.length === 0) {
      setCreateDeviceId("")
      return
    }

    if (!devices.some((device) => device.id === createDeviceId)) {
      setCreateDeviceId(devices[0].id)
    }
  }, [createDeviceId, devices])

  const deviceNameById = React.useMemo(
    () => new Map(devices.map((device) => [device.id, device.displayName])),
    [devices]
  )
  const serviceByDeviceAndType = React.useMemo(
    () =>
      new Map(
        services.map((service) => [
          `${service.deviceId}:${service.serviceType}` as const,
          service,
        ])
      ),
    [services]
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Connections"
        title="Service entries"
        description="Edit the service entries that the dashboard can launch sessions against."
      />

      <Card>
        <CardHeader>
          <CardTitle>Quick enable</CardTitle>
          <CardDescription>
            Create the common remote access services with the known defaults.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FormField
            label="Device"
            htmlFor="connections-quick-device"
            className="md:max-w-sm"
          >
            <NativeSelect
              id="connections-quick-device"
              value={createDeviceId}
              onChange={(event) => setCreateDeviceId(event.target.value)}
            >
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.displayName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="grid gap-3 md:grid-cols-3">
            {quickServiceTypes.map((serviceType) => {
              const defaults = serviceDefaults[serviceType]
              const isActive = Boolean(
                serviceByDeviceAndType.get(`${createDeviceId}:${serviceType}`)
              )

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
                      <Badge variant={isActive ? "secondary" : "outline"}>
                        {isActive ? "Enabled" : "Off"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {defaults.protocol} · {defaults.port}
                    </p>
                  </div>
                  <Button
                    className="mt-4 w-fit"
                    size="sm"
                    onClick={() => {
                      void createService.mutateAsync({
                        deviceId: createDeviceId,
                        serviceType,
                        protocol: defaults.protocol,
                        port: defaults.port,
                        enabled: true,
                      })
                    }}
                    disabled={
                      !createDeviceId || createService.isPending || isActive
                    }
                  >
                    {isActive
                      ? "Enabled"
                      : `Enable ${serviceLabels[serviceType]}`}
                  </Button>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom service</CardTitle>
          <CardDescription>
            Create a service entry with custom settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5 md:items-end">
          <FormField label="Type" htmlFor="connections-custom-type">
            <NativeSelect
              id="connections-custom-type"
              value={createServiceType}
              onChange={(event) => {
                const serviceType = event.target
                  .value as (typeof serviceTypes)[number]
                const defaults = serviceDefaults[serviceType]

                setCreateServiceType(serviceType)
                setCreateProtocol(defaults.protocol)
                setCreatePort(String(defaults.port))
              }}
            >
              {serviceTypes.map((type) => (
                <option key={type} value={type}>
                  {serviceLabels[type]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Protocol" htmlFor="connections-custom-protocol">
            <Input
              id="connections-custom-protocol"
              value={createProtocol}
              onChange={(event) => setCreateProtocol(event.target.value)}
            />
          </FormField>
          <FormField label="Port" htmlFor="connections-custom-port">
            <Input
              id="connections-custom-port"
              type="number"
              value={createPort}
              onChange={(event) => setCreatePort(event.target.value)}
            />
          </FormField>
          <div>
            <Button
              onClick={() => {
                void createService.mutateAsync({
                  deviceId: createDeviceId,
                  serviceType: createServiceType,
                  protocol: createProtocol,
                  port: Number(createPort),
                  enabled: true,
                })
              }}
              disabled={!createDeviceId || createService.isPending}
            >
              Add service
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current services</CardTitle>
          <CardDescription>Edit or remove existing entries.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {servicesQuery.isLoading ? (
            <div className="grid gap-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : services.length === 0 ? (
            <EmptyState
              title="No services yet"
              description="Enable a service above to make it available for sessions."
            />
          ) : (
            services.map((service) => {
              const serviceType = service.serviceType as ServiceType
              const isVnc = serviceType === "vnc"
              const isRdp = serviceType === "rdp"
              const isSsh = serviceType === "ssh"
              const isPasswordService = isVnc || isRdp

              return (
                <form
                  key={service.id}
                  className="grid gap-3 rounded-lg border p-4 md:grid-cols-5 md:items-end"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const form = new FormData(event.currentTarget)
                    const nextServiceType = String(
                      form.get("serviceType")
                    ) as (typeof serviceTypes)[number]
                    const nextProtocol =
                      serviceDefaults[nextServiceType].protocol
                    const nextPort = serviceDefaults[nextServiceType].port

                    void updateService.mutateAsync({
                      id: service.id,
                      serviceType: nextServiceType,
                      protocol: nextProtocol,
                      port: nextPort,
                      enabled: form.get("enabled") === "on",
                    })
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-5">
                    <div>
                      <p className="font-medium">
                        {deviceNameById.get(service.deviceId) ??
                          "Unknown device"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {serviceLabels[serviceType]} ·{" "}
                        {statusLabel(service.healthStatus)} · last checked{" "}
                        {formatDate(service.lastCheckedAt)}
                      </p>
                    </div>
                    <Badge variant={service.enabled ? "secondary" : "outline"}>
                      {service.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>

                  {isPasswordService ? (
                    <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 text-sm md:col-span-5">
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
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              service.hasSavedPassword ? "secondary" : "outline"
                            }
                          >
                            {service.hasSavedPassword
                              ? "Saved password"
                              : "No saved password"}
                          </Badge>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              void launchSession.mutateAsync({
                                deviceId: service.deviceId,
                                serviceId: service.id,
                                connectionMethod: preferredConnectionMethod({
                                  vpnConnected: adminVpnConnected,
                                  serviceType: service.serviceType,
                                }),
                              })
                            }}
                            disabled={launchSession.isPending}
                          >
                            Launch
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <FormField
                        label="Type"
                        htmlFor={`connections-type-${service.id}`}
                      >
                        <NativeSelect
                          id={`connections-type-${service.id}`}
                          name="serviceType"
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
                        htmlFor={`connections-protocol-${service.id}`}
                      >
                        <Input
                          id={`connections-protocol-${service.id}`}
                          name="protocol"
                          defaultValue={service.protocol}
                        />
                      </FormField>
                      <FormField
                        label="Port"
                        htmlFor={`connections-port-${service.id}`}
                      >
                        <Input
                          id={`connections-port-${service.id}`}
                          name="port"
                          type="number"
                          defaultValue={service.port}
                        />
                      </FormField>
                      {isSsh ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              service.hasSavedPassword ? "secondary" : "outline"
                            }
                          >
                            {service.hasSavedPassword
                              ? "Saved key"
                              : "No saved key"}
                          </Badge>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              void launchSession.mutateAsync({
                                deviceId: service.deviceId,
                                serviceId: service.id,
                                connectionMethod: preferredConnectionMethod({
                                  vpnConnected: adminVpnConnected,
                                  serviceType: service.serviceType,
                                }),
                              })
                            }}
                            disabled={launchSession.isPending}
                          >
                            Launch
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`connections-enabled-${service.id}`}
                      name="enabled"
                      defaultChecked={service.enabled}
                    />
                    <Label
                      htmlFor={`connections-enabled-${service.id}`}
                      className="text-sm font-normal"
                    >
                      Enabled
                    </Label>
                  </div>
                  <div className="flex gap-2">
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
                  {isVnc ? (
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
                          void clearCredential.mutateAsync({ id: service.id })
                        }}
                        disabled={
                          clearCredential.isPending || !service.hasSavedPassword
                        }
                      >
                        Clear password
                      </Button>
                    </div>
                  ) : null}
                  {isSsh ? (
                    <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 md:col-span-5">
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
                            const privateKeyInput = container?.querySelector(
                              `textarea[name="ssh-private-key-${service.id}"]`
                            ) as HTMLTextAreaElement | null
                            const username = usernameInput?.value.trim() ?? ""
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
                            void clearCredential.mutateAsync({ id: service.id })
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
                </form>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
