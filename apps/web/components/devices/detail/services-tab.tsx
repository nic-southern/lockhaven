"use client"

import * as React from "react"
import { KeyRoundIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import type { ServiceType } from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { DataTableRowActions } from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { serviceTypeLabel } from "@/lib/devices"
import { preferredConnectionMethod } from "@/lib/remote-launch"
import { trpc } from "@/lib/trpc"
import { useAdminVpnConnected } from "@/lib/use-admin-vpn-connected"
import { usePermissions } from "@/lib/use-permissions"
import { useRemoteLaunch } from "@/lib/use-remote-launch"

import {
  CredentialDialog,
  ServiceDialog,
  type CredentialSubmit,
  type ServiceFormValues,
} from "./service-dialogs"
import {
  type DeviceDetail,
  type DeviceService,
  useInvalidateDevice,
} from "./shared"

function healthTone(status: string) {
  if (status === "online") return "online" as const
  if (status === "offline") return "offline" as const
  return "neutral" as const
}

function launchPermission(serviceType: string) {
  switch (serviceType) {
    case "vnc":
      return "device:start_vnc" as const
    case "rdp":
      return "device:start_rdp" as const
    case "ssh":
      return "device:start_ssh" as const
    default:
      return null
  }
}

export function ServicesTab({ device }: { device: DeviceDetail }) {
  const { can } = usePermissions()
  const canUpdate = can("device:update")
  const { connected: adminVpnConnected } = useAdminVpnConnected()
  const invalidate = useInvalidateDevice(device.id)

  const [dialog, setDialog] = React.useState<
    | { kind: "create" }
    | { kind: "edit"; service: DeviceService }
    | { kind: "credential"; service: DeviceService }
    | { kind: "delete"; service: DeviceService }
    | null
  >(null)
  const [dialogKey, setDialogKey] = React.useState(0)
  const openDialog = (next: NonNullable<typeof dialog>) => {
    setDialogKey((value) => value + 1)
    setDialog(next)
  }
  const closeDialog = () => setDialog(null)

  const onError = (message: string) => () => toast.error(message)
  const createService = trpc.managementServices.create.useMutation({
    async onSuccess() {
      await invalidate()
      closeDialog()
      toast.success("Service added")
    },
    onError: onError("We couldn't add the service."),
  })
  const updateService = trpc.managementServices.update.useMutation({
    async onSuccess() {
      await invalidate()
      closeDialog()
      toast.success("Service updated")
    },
    onError: onError("We couldn't update the service."),
  })
  const deleteService = trpc.managementServices.delete.useMutation({
    async onSuccess() {
      await invalidate()
      closeDialog()
      toast.success("Service removed")
    },
    onError: onError("We couldn't remove the service."),
  })
  const setCredential = trpc.managementServices.setCredential.useMutation({
    async onSuccess() {
      await invalidate()
      closeDialog()
      toast.success("Password saved")
    },
    onError: onError("We couldn't save the password."),
  })
  const setSshCredential = trpc.managementServices.setSshCredential.useMutation(
    {
      async onSuccess() {
        await invalidate()
        closeDialog()
        toast.success("SSH key saved")
      },
      onError: onError("We couldn't save the SSH key."),
    }
  )
  const clearCredential = trpc.managementServices.clearCredential.useMutation({
    async onSuccess() {
      await invalidate()
      closeDialog()
      toast.success("Credential removed")
    },
    onError: onError("We couldn't remove the credential."),
  })
  const launch = useRemoteLaunch()

  const pending =
    createService.isPending ||
    updateService.isPending ||
    deleteService.isPending ||
    setCredential.isPending ||
    setSshCredential.isPending ||
    clearCredential.isPending

  const toggleEnabled = (service: DeviceService, enabled: boolean) => {
    updateService.mutate({
      id: service.id,
      serviceType: service.serviceType as ServiceType,
      protocol: service.protocol,
      port: service.port,
      enabled,
    })
  }

  const submitService = (values: ServiceFormValues) => {
    if (dialog?.kind === "edit") {
      updateService.mutate({ id: dialog.service.id, ...values })
      return
    }
    createService.mutate({ deviceId: device.id, ...values })
  }

  const submitCredential = (values: CredentialSubmit) => {
    if (dialog?.kind !== "credential") return
    if (values.kind === "ssh") {
      setSshCredential.mutate({
        id: dialog.service.id,
        username: values.username,
        privateKey: values.privateKey,
      })
      return
    }
    setCredential.mutate({ id: dialog.service.id, password: values.password })
  }

  const services = device.services
  const supportsCredential = (type: string) =>
    type === "vnc" || type === "rdp" || type === "ssh"

  return (
    <>
      <SectionCard
        title="Services"
        description="Endpoints published on this device and how they're reached."
        contentClassName="p-0"
        actions={
          canUpdate ? (
            <Button size="sm" onClick={() => openDialog({ kind: "create" })}>
              <PlusIcon />
              Add service
            </Button>
          ) : null
        }
      >
        {services.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No services yet"
              description={
                canUpdate
                  ? "Publish VNC, RDP, SSH, or WinRM so this device can be reached."
                  : "Nothing has been published on this device."
              }
              bordered={false}
              action={
                canUpdate ? (
                  <Button onClick={() => openDialog({ kind: "create" })}>
                    <PlusIcon />
                    Add service
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Service</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service) => {
                const permission = launchPermission(service.serviceType)
                const canLaunch =
                  permission !== null &&
                  can(permission) &&
                  service.enabled &&
                  device.connectivity !== "revoked"
                const label =
                  serviceTypeLabel[service.serviceType] ?? service.serviceType

                return (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">{label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {service.protocol}/{service.port}
                    </TableCell>
                    <TableCell>
                      {service.enabled ? (
                        <div className="flex flex-col">
                          <StatusIndicator
                            tone={healthTone(service.healthStatus)}
                            label={statusLabel(service.healthStatus)}
                            pulse={service.healthStatus === "online"}
                          />
                          {service.lastCheckedAt ? (
                            <span
                              className="pl-4 text-xs text-muted-foreground"
                              title={formatDate(service.lastCheckedAt)}
                            >
                              Checked{" "}
                              {formatRelativeTime(service.lastCheckedAt)}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {supportsCredential(service.serviceType) ? (
                        <Badge
                          variant={
                            service.hasSavedPassword ? "secondary" : "outline"
                          }
                        >
                          {service.hasSavedPassword
                            ? service.serviceType === "ssh"
                              ? "Key saved"
                              : "Password saved"
                            : "Prompt on connect"}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={service.enabled}
                        disabled={!canUpdate || updateService.isPending}
                        aria-label={`${label} enabled`}
                        onCheckedChange={(checked) =>
                          toggleEnabled(service, checked)
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <DataTableRowActions
                        label={`Actions for ${label}`}
                        actions={[
                          ...(canLaunch
                            ? [
                                {
                                  label: "Connect",
                                  onSelect: () =>
                                    launch.mutate({
                                      deviceId: device.id,
                                      serviceId: service.id,
                                      connectionMethod:
                                        preferredConnectionMethod({
                                          vpnConnected: adminVpnConnected,
                                          serviceType: service.serviceType,
                                        }),
                                    }),
                                },
                              ]
                            : []),
                          ...(canUpdate
                            ? [
                                {
                                  label: "Edit…",
                                  icon: PencilIcon,
                                  separatorBefore: canLaunch,
                                  onSelect: () =>
                                    openDialog({ kind: "edit", service }),
                                },
                                ...(supportsCredential(service.serviceType)
                                  ? [
                                      {
                                        label: service.hasSavedPassword
                                          ? "Replace credential…"
                                          : "Save credential…",
                                        icon: KeyRoundIcon,
                                        onSelect: () =>
                                          openDialog({
                                            kind: "credential",
                                            service,
                                          }),
                                      },
                                    ]
                                  : []),
                                {
                                  label: "Remove",
                                  icon: Trash2Icon,
                                  destructive: true,
                                  separatorBefore: true,
                                  onSelect: () =>
                                    openDialog({ kind: "delete", service }),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <ServiceDialog
          key={dialogKey}
          open
          service={dialog.kind === "edit" ? dialog.service : null}
          existingTypes={services.map((service) => service.serviceType)}
          pending={pending}
          onClose={closeDialog}
          onSubmit={submitService}
        />
      ) : null}

      {dialog?.kind === "credential" ? (
        <CredentialDialog
          key={dialogKey}
          open
          service={dialog.service}
          pending={pending}
          onClose={closeDialog}
          onSubmit={submitCredential}
          onClear={() => clearCredential.mutate({ id: dialog.service.id })}
        />
      ) : null}

      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => (!open ? closeDialog() : null)}
        title="Remove service"
        description={
          dialog?.kind === "delete"
            ? `Remove ${serviceTypeLabel[dialog.service.serviceType] ?? dialog.service.serviceType} on port ${dialog.service.port}? Any saved credential is deleted with it.`
            : ""
        }
        confirmLabel="Remove service"
        destructive
        pending={deleteService.isPending}
        onConfirm={() => {
          if (dialog?.kind === "delete") {
            deleteService.mutate({ id: dialog.service.id })
          }
        }}
      />
    </>
  )
}
