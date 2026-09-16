"use client"

import * as React from "react"
import { serviceDefaults, serviceTypes, type ServiceType } from "@nms/shared"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"
import { serviceTypeLabel } from "@/lib/devices"

import type { DeviceService } from "./shared"

export type ServiceFormValues = {
  serviceType: ServiceType
  protocol: string
  port: number
  enabled: boolean
}

export function ServiceDialog({
  open,
  service,
  existingTypes,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean
  /** When present the dialog edits this service; otherwise it creates one. */
  service: DeviceService | null
  existingTypes: string[]
  pending: boolean
  onClose: () => void
  onSubmit: (values: ServiceFormValues) => void
}) {
  const initialType: ServiceType = service
    ? (service.serviceType as ServiceType)
    : ((serviceTypes.find((type) => !existingTypes.includes(type)) ??
        "ssh") as ServiceType)

  const [serviceType, setServiceType] = React.useState<ServiceType>(initialType)
  const [protocol, setProtocol] = React.useState(
    service?.protocol ?? serviceDefaults[initialType].protocol
  )
  const [port, setPort] = React.useState(
    String(service?.port ?? serviceDefaults[initialType].port)
  )
  const [enabled, setEnabled] = React.useState(service?.enabled ?? true)

  const portNumber = Number(port)
  const portValid =
    Number.isInteger(portNumber) && portNumber > 0 && portNumber <= 65535
  const protocolValid = protocol.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{service ? "Edit service" : "Add service"}</DialogTitle>
          <DialogDescription>
            {service
              ? "Change how this service is reached on the device."
              : "Publish a service on this device so it can be reached over the tunnel."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField label="Type" htmlFor="service-type">
            <SelectField
              id="service-type"
              value={serviceType}
              onValueChange={(value) => {
                const next = value as ServiceType
                const defaults = serviceDefaults[next]
                setServiceType(next)
                setProtocol(defaults.protocol)
                setPort(String(defaults.port))
              }}
              options={serviceTypes.map((type) => ({
                value: type,
                label: serviceTypeLabel[type] ?? type,
                description:
                  !service && existingTypes.includes(type)
                    ? "Already published"
                    : undefined,
              }))}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Protocol"
              htmlFor="service-protocol"
              error={protocolValid ? undefined : "Required"}
            >
              <Input
                id="service-protocol"
                value={protocol}
                onChange={(event) => setProtocol(event.target.value)}
              />
            </FormField>
            <FormField
              label="Port"
              htmlFor="service-port"
              error={portValid ? undefined : "Use a port from 1 to 65535"}
            >
              <Input
                id="service-port"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </FormField>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span className="flex flex-col">
              <span className="font-medium">Enabled</span>
              <span className="text-xs text-muted-foreground">
                Disabled services stay configured but can&apos;t be launched.
              </span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || !portValid || !protocolValid}
            onClick={() =>
              onSubmit({
                serviceType,
                protocol: protocol.trim(),
                port: portNumber,
                enabled,
              })
            }
          >
            {pending ? "Saving…" : service ? "Save changes" : "Add service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type CredentialSubmit =
  | { kind: "password"; password: string }
  | { kind: "ssh"; username: string; privateKey: string }

export function CredentialDialog({
  open,
  service,
  pending,
  onClose,
  onSubmit,
  onClear,
}: {
  open: boolean
  service: DeviceService | null
  pending: boolean
  onClose: () => void
  onSubmit: (values: CredentialSubmit) => void
  onClear: () => void
}) {
  const isSsh = service?.serviceType === "ssh"
  const [password, setPassword] = React.useState("")
  const [username, setUsername] = React.useState("")
  const [privateKey, setPrivateKey] = React.useState("")

  const label = service
    ? (serviceTypeLabel[service.serviceType] ?? service.serviceType)
    : ""
  const canSubmit = isSsh
    ? username.trim().length > 0 && privateKey.trim().length > 0
    : password.length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isSsh ? "SSH key" : "Saved password"} · {label}
          </DialogTitle>
          <DialogDescription>
            {isSsh
              ? "Stored encrypted and used to open terminal sessions without prompting."
              : "Stored encrypted and supplied automatically when a session starts."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {isSsh ? (
            <>
              <FormField label="Username" htmlFor="ssh-username">
                <Input
                  id="ssh-username"
                  autoComplete="off"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </FormField>
              <FormField label="Private key" htmlFor="ssh-private-key">
                <Textarea
                  id="ssh-private-key"
                  className="min-h-32 font-mono text-xs"
                  spellCheck={false}
                  value={privateKey}
                  onChange={(event) => setPrivateKey(event.target.value)}
                />
              </FormField>
            </>
          ) : (
            <FormField label="Password" htmlFor="service-password">
              <Input
                id="service-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </FormField>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {service?.hasSavedPassword ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onClear}
              disabled={pending}
            >
              Remove saved {isSsh ? "key" : "password"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || !canSubmit}
              onClick={() =>
                onSubmit(
                  isSsh
                    ? {
                        kind: "ssh",
                        username: username.trim(),
                        privateKey: privateKey.trim(),
                      }
                    : { kind: "password", password }
                )
              }
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
