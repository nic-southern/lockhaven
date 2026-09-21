"use client"

/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import Link from "next/link"
import {
  KeyRoundIcon,
  MonitorIcon,
  ScreenShareIcon,
  TerminalIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  BROWSER_CONNECTION_METHOD,
  serviceDefaults,
  type Permission,
  type RemoteConnectionMethod,
  type ServiceType,
} from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { SelectField } from "@/components/dashboard/select-field"
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { serviceTypeLabel } from "@/lib/devices"
import { preferredConnectionMethod } from "@/lib/remote-launch"
import { trpc } from "@/lib/trpc"
import { useAdminVpnConnected } from "@/lib/use-admin-vpn-connected"
import { usePermissions } from "@/lib/use-permissions"
import { useRemoteLaunch } from "@/lib/use-remote-launch"
import { AccessReasonDialog } from "@/components/sessions/access-reason-dialog"

import {
  type DeviceDetail,
  type DeviceService,
  type DeviceTab,
  useInvalidateDevice,
} from "./shared"

const quickServices: Array<{
  type: ServiceType
  description: string
  permission: Permission
  icon: React.ComponentType<{ className?: string }>
  supportsNative: boolean
}> = [
  {
    type: "vnc",
    description: "View and control the screen",
    permission: "device:start_vnc",
    icon: ScreenShareIcon,
    supportsNative: true,
  },
  {
    type: "rdp",
    description: "Open a remote desktop session",
    permission: "device:start_rdp",
    icon: MonitorIcon,
    supportsNative: false,
  },
  {
    type: "ssh",
    description: "Open a terminal on the device",
    permission: "device:start_ssh",
    icon: TerminalIcon,
    supportsNative: true,
  },
]

function healthTone(status: string) {
  if (status === "online") return "online" as const
  if (status === "offline") return "offline" as const
  return "neutral" as const
}

export function ConnectTab({
  device,
  onNavigate,
}: {
  device: DeviceDetail
  onNavigate: (tab: DeviceTab) => void
}) {
  const { can, uiScope, isPlatformAdmin } = usePermissions()
  const { connected: adminVpnConnected } = useAdminVpnConnected()
  const invalidate = useInvalidateDevice(device.id)
  const canUpdate = can("device:update")
  const utils = trpc.useUtils()

  const [launchingId, setLaunchingId] = React.useState<string | null>(null)
  const launch = useRemoteLaunch({
    onSettled: () => {
      setLaunchingId(null)
      void utils.accessRequests.mine.invalidate()
    },
  })
  const [methodOverrides, setMethodOverrides] = React.useState<
    Record<string, RemoteConnectionMethod>
  >({})
  const [reasonPrompt, setReasonPrompt] = React.useState<{
    serviceId: string
    method: RemoteConnectionMethod
  } | null>(null)
  const [accessMinutes, setAccessMinutes] = React.useState("30")
  const [accessReason, setAccessReason] = React.useState("")

  const requirementsQuery = trpc.sessions.launchRequirements.useQuery(
    { deviceId: device.id },
    { refetchInterval: device.infrastructure ? 15_000 : false }
  )
  const mineQuery = trpc.accessRequests.mine.useQuery(
    { deviceId: device.id },
    { refetchInterval: 8_000 }
  )

  const launchedRequestIds = React.useRef(new Set<string>())
  const requirements = requirementsQuery.data
  const mineRequests = mineQuery.data
  const pendingByService = React.useMemo(() => {
    const map = new Map<string, NonNullable<typeof mineRequests>[number]>()
    for (const request of mineRequests ?? []) {
      if (request.status === "pending" || request.status === "approved") {
        map.set(request.serviceId, request)
      }
    }
    return map
  }, [mineRequests])

  React.useEffect(() => {
    if (device.infrastructure) return
    const approved = (mineQuery.data ?? []).filter(
      (request) => request.status === "approved"
    )
    for (const request of approved) {
      if (launchedRequestIds.current.has(request.id)) continue
      if (launch.isPending || launchingId) continue
      launchedRequestIds.current.add(request.id)
      setLaunchingId(request.serviceId)
      launch.mutate(
        {
          deviceId: device.id,
          serviceId: request.serviceId,
          connectionMethod:
            (request.connectionMethod as RemoteConnectionMethod) ??
            BROWSER_CONNECTION_METHOD,
          accessRequestId: request.id,
          reason: request.reason ?? undefined,
        },
        {
          onError: () => {
            launchedRequestIds.current.delete(request.id)
          },
        }
      )
    }
  }, [mineQuery.data, launch, launchingId, device.id, device.infrastructure])

  const accessExpiresAt = requirements?.infrastructureAccessExpiresAt ?? null
  const infrastructureClosed =
    device.infrastructure && (requirementsQuery.isLoading || !accessExpiresAt)

  const requestAccess = trpc.devices.requestInfrastructureAccess.useMutation({
    async onSuccess() {
      setAccessReason("")
      await requirementsQuery.refetch()
      toast.success("Access granted")
    },
    onError() {
      toast.error("We couldn't open access.")
    },
  })
  const endAccess = trpc.devices.revokeInfrastructureAccess.useMutation({
    async onSuccess() {
      await requirementsQuery.refetch()
      toast.success("Access ended")
    },
    onError() {
      toast.error("We couldn't end access.")
    },
  })

  function startLaunch(serviceId: string, method: RemoteConnectionMethod) {
    if (infrastructureClosed) {
      toast.message("Request access before connecting")
      return
    }
    const requireReason = Boolean(requirements?.requireAccessReason)
    const requireApproval = Boolean(requirements?.requireApproval)
    const outstanding = pendingByService.get(serviceId)
    if (outstanding?.status === "pending") {
      toast.message("Waiting for approval")
      return
    }
    if (outstanding?.status === "approved") {
      setLaunchingId(serviceId)
      launch.mutate({
        deviceId: device.id,
        serviceId,
        connectionMethod: method,
        accessRequestId: outstanding.id,
        reason: outstanding.reason ?? undefined,
      })
      return
    }
    if (requireReason || requireApproval) {
      setReasonPrompt({ serviceId, method })
      return
    }
    setLaunchingId(serviceId)
    launch.mutate({
      deviceId: device.id,
      serviceId,
      connectionMethod: method,
    })
  }

  const createService = trpc.managementServices.create.useMutation({
    async onSuccess() {
      await invalidate()
      toast.success("Service enabled")
    },
    onError() {
      toast.error("We couldn't enable the service.")
    },
  })
  const updateService = trpc.managementServices.update.useMutation({
    async onSuccess() {
      await invalidate()
      toast.success("Service enabled")
    },
    onError() {
      toast.error("We couldn't enable the service.")
    },
  })

  const serviceByType = React.useMemo(() => {
    const map = new Map<string, DeviceService>()
    for (const service of device.services) {
      // Prefer an enabled service when a type has several entries.
      const existing = map.get(service.serviceType)
      if (!existing || (!existing.enabled && service.enabled)) {
        map.set(service.serviceType, service)
      }
    }
    return map
  }, [device.services])

  const offline = device.connectivity !== "online"
  const revoked = device.connectivity === "revoked"

  const anyLaunchable = quickServices.some(
    (entry) => can(entry.permission) && serviceByType.get(entry.type)?.enabled
  )

  return (
    <div className="flex flex-col gap-6">
      {device.infrastructure ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            {requirementsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Checking access</p>
            ) : accessExpiresAt ? (
              <>
                <p className="font-medium">
                  Access expires {formatDate(accessExpiresAt)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Connections close when this access expires. Request access
                  again after that.
                </p>
                {isPlatformAdmin ? (
                  <Button
                    variant="outline"
                    className="w-fit"
                    disabled={endAccess.isPending}
                    onClick={() => endAccess.mutate({ deviceId: device.id })}
                  >
                    {endAccess.isPending ? "Ending…" : "End access"}
                  </Button>
                ) : null}
              </>
            ) : isPlatformAdmin ? (
              <>
                <p className="font-medium">Access is closed</p>
                <p className="text-sm text-muted-foreground">
                  Request access to connect. It expires on its own.
                </p>
                <SelectField
                  aria-label="How long access lasts"
                  value={accessMinutes}
                  onValueChange={setAccessMinutes}
                  options={[
                    { value: "15", label: "15 minutes" },
                    { value: "30", label: "30 minutes" },
                    { value: "60", label: "1 hour" },
                    { value: "120", label: "2 hours" },
                  ]}
                />
                <Textarea
                  value={accessReason}
                  onChange={(event) => setAccessReason(event.target.value)}
                  maxLength={500}
                  placeholder="Why do you need access?"
                  aria-label="Why do you need access?"
                />
                <Button
                  className="w-fit"
                  disabled={requestAccess.isPending}
                  onClick={() =>
                    requestAccess.mutate({
                      deviceId: device.id,
                      minutes: Number(accessMinutes),
                      reason: accessReason.trim() || undefined,
                    })
                  }
                >
                  {requestAccess.isPending ? "Requesting…" : "Request access"}
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">Access is closed</p>
                <p className="text-sm text-muted-foreground">
                  Only a platform administrator can request access to this
                  device.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
      {revoked ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            <span>
              Tunnel access for this device has been revoked. Sessions
              can&apos;t be started until it is re-enrolled.
            </span>
          </CardContent>
        </Card>
      ) : offline ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            <span>
              This device hasn&apos;t checked in recently. Sessions may not
              connect until it comes back online.
            </span>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {quickServices.map((entry) => {
          const service = serviceByType.get(entry.type)
          const allowed = can(entry.permission)
          const enabled = Boolean(service?.enabled)
          const defaults = serviceDefaults[entry.type]
          const Icon = entry.icon
          const preferred = preferredConnectionMethod({
            vpnConnected: adminVpnConnected,
            serviceType: entry.type,
          })
          const method: RemoteConnectionMethod = service
            ? (methodOverrides[service.id] ?? preferred)
            : preferred
          const nativeAvailable = entry.supportsNative && adminVpnConnected
          const needsCredential =
            (entry.type === "vnc" || entry.type === "rdp") &&
            service &&
            !service.hasSavedPassword

          return (
            <Card key={entry.type} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg border bg-muted/40">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <p className="font-medium">
                        {serviceTypeLabel[entry.type] ?? entry.type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.description}
                      </p>
                    </div>
                  </div>
                  {service ? (
                    enabled ? (
                      <StatusIndicator
                        tone={healthTone(service.healthStatus)}
                        label={statusLabel(service.healthStatus)}
                        pulse={service.healthStatus === "online"}
                        className="text-xs"
                      />
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    )
                  ) : (
                    <Badge variant="outline">Not set up</Badge>
                  )}
                </div>

                <p className="font-mono text-xs text-muted-foreground">
                  {service
                    ? `${service.protocol}/${service.port}`
                    : `${defaults.protocol}/${defaults.port} by default`}
                </p>

                {needsCredential ? (
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left text-xs text-amber-700 hover:underline dark:text-amber-400"
                    onClick={() => onNavigate("services")}
                  >
                    <KeyRoundIcon className="size-3.5" />
                    No saved password. You&apos;ll be prompted when connecting.
                  </button>
                ) : null}

                <div className="mt-auto flex flex-col gap-2">
                  {service && enabled ? (
                    allowed ? (
                      <>
                        {entry.supportsNative ? (
                          <SelectField
                            aria-label={`${serviceTypeLabel[entry.type]} connection method`}
                            size="sm"
                            value={method}
                            onValueChange={(value) =>
                              setMethodOverrides((current) => ({
                                ...current,
                                [service.id]: value as RemoteConnectionMethod,
                              }))
                            }
                            options={[
                              {
                                value: BROWSER_CONNECTION_METHOD,
                                label: "In this browser",
                              },
                              {
                                value: "native",
                                label: "Native app",
                                description: nativeAvailable
                                  ? undefined
                                  : "Requires the admin tunnel",
                                disabled: !nativeAvailable,
                              },
                            ]}
                          />
                        ) : null}
                        <Button
                          disabled={
                            infrastructureClosed ||
                            revoked ||
                            launch.isPending ||
                            launchingId === service.id
                          }
                          onClick={() => startLaunch(service.id, method)}
                        >
                          {pendingByService.get(service.id)?.status ===
                          "pending"
                            ? "Waiting for approval"
                            : launchingId === service.id
                              ? "Starting…"
                              : `Connect with ${serviceTypeLabel[entry.type]}`}
                        </Button>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        You don&apos;t have access to start this session type.
                      </p>
                    )
                  ) : canUpdate ? (
                    <Button
                      variant="outline"
                      disabled={
                        createService.isPending || updateService.isPending
                      }
                      onClick={() => {
                        if (service) {
                          updateService.mutate({
                            id: service.id,
                            serviceType: service.serviceType as ServiceType,
                            protocol: service.protocol,
                            port: service.port,
                            enabled: true,
                          })
                          return
                        }
                        createService.mutate({
                          deviceId: device.id,
                          serviceType: entry.type,
                          protocol: defaults.protocol,
                          port: defaults.port,
                          enabled: true,
                        })
                      }}
                    >
                      {service ? "Enable" : "Set up"}{" "}
                      {serviceTypeLabel[entry.type]}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Not available on this device.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {!anyLaunchable && !canUpdate ? (
        <EmptyState
          title="Nothing to connect to yet"
          description="An administrator needs to publish a service on this device first."
        />
      ) : null}

      <OpenDeviceSessions deviceId={device.id} />

      <p className="text-xs text-muted-foreground">
        Browser sessions work from anywhere.
        {uiScope === "admin" ? (
          <>
            {" "}
            Native apps open directly over your{" "}
            <Link href="/admin-vpn" className="underline underline-offset-2">
              admin tunnel
            </Link>
            {adminVpnConnected ? " (connected)." : " (not connected)."}
          </>
        ) : null}
      </p>
      <AccessReasonDialog
        open={reasonPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setReasonPrompt(null)
        }}
        requireReason={Boolean(requirements?.requireAccessReason)}
        requireApproval={Boolean(requirements?.requireApproval)}
        pending={launch.isPending}
        onConfirm={(reason) => {
          if (!reasonPrompt) return
          setLaunchingId(reasonPrompt.serviceId)
          launch.mutate(
            {
              deviceId: device.id,
              serviceId: reasonPrompt.serviceId,
              connectionMethod: reasonPrompt.method,
              reason: reason || undefined,
            },
            {
              onSettled: () => {
                setReasonPrompt(null)
                void utils.accessRequests.mine.invalidate()
              },
            }
          )
        }}
      />
    </div>
  )
}

function OpenDeviceSessions({ deviceId }: { deviceId: string }) {
  const { can, isPlatformAdmin } = usePermissions()
  const utils = trpc.useUtils()
  const canEnd =
    isPlatformAdmin ||
    can("device:update") ||
    can("device:start_vnc") ||
    can("device:start_rdp") ||
    can("device:start_ssh")
  const [endingId, setEndingId] = React.useState<string | null>(null)

  const openQuery = trpc.sessions.page.useQuery(
    {
      limit: 20,
      filters: { deviceId: [deviceId], state: ["active"] },
    },
    { refetchInterval: 15_000 }
  )

  const terminate = trpc.sessions.terminate.useMutation({
    async onSuccess() {
      toast.success("Session ended")
      setEndingId(null)
      await Promise.all([
        utils.sessions.page.invalidate(),
        utils.dashboard.summary.invalidate(),
      ])
    },
    onError() {
      toast.error("We couldn't end that session.")
    },
  })

  const items = openQuery.data?.items ?? []
  if (!canEnd || (items.length === 0 && !openQuery.isLoading)) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">Open sessions</h2>
        <p className="text-xs text-muted-foreground">
          End a session if it should no longer stay connected.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">
                {session.serviceType
                  ? (serviceTypeLabel[session.serviceType] ??
                    session.serviceType)
                  : "Session"}
              </span>
              <span className="text-xs text-muted-foreground">
                {session.actorName ?? session.actorEmail ?? "Unknown"} ·{" "}
                {formatRelativeTime(session.startedAt)}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={terminate.isPending}
              onClick={() => setEndingId(session.id)}
            >
              End session
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={endingId !== null}
        onOpenChange={(open) => {
          if (!open) setEndingId(null)
        }}
        title="End this session?"
        description="This disconnects the open session on this device."
        confirmLabel="End session"
        destructive
        pending={terminate.isPending}
        onConfirm={() => {
          if (endingId) terminate.mutate({ sessionId: endingId })
        }}
      />
    </div>
  )
}
