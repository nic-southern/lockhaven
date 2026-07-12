"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CodeBlock } from "@/components/dashboard/code-block"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { formatDate, statusLabel, statusVariant } from "@/lib/dashboard"
import {
  buildLinuxInstallCommand,
  buildWindowsInstallCommand,
} from "@/lib/enrollment-commands"
import { getClientProductName, getClientVpnBaseUrl } from "@/lib/product-name"
import { getApiBaseUrl, trpc } from "@/lib/trpc"

type HealthResponse = {
  ok: boolean
  postgres: "ok" | "degraded"
  redis: "ok" | "degraded"
}

const ENROLLMENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getEnrollmentTokenExpiration() {
  return new Date(Date.now() + ENROLLMENT_TOKEN_TTL_MS)
}

function healthLabel(value: string | undefined, loading: boolean) {
  if (loading) {
    return "Checking"
  }

  return statusLabel(value ?? "Down")
}

export default function Page() {
  const utils = trpc.useUtils()
  const productName = getClientProductName()
  const [enrollmentOpen, setEnrollmentOpen] = React.useState(false)
  const [selectedSiteId, setSelectedSiteId] = React.useState("")
  const [selectedRoutePolicyId, setSelectedRoutePolicyId] = React.useState("")
  const [enrollmentToken, setEnrollmentToken] = React.useState("")
  const [installBaseUrl, setInstallBaseUrl] =
    React.useState(getClientVpnBaseUrl)
  const [enrollmentError, setEnrollmentError] = React.useState<string | null>(
    null
  )
  const healthQuery = useQuery<HealthResponse>({
    queryKey: ["api-health"],
    queryFn: async () => {
      const response = await fetch(`${getApiBaseUrl()}/api/health`, {
        credentials: "include",
      })

      return (await response.json()) as HealthResponse
    },
    refetchInterval: 10_000,
  })

  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const managementServicesQuery = trpc.managementServices.list.useQuery()
  const router = useRouter()
  const createOrganization = trpc.organizations.create.useMutation({
    onSuccess() {
      void utils.organizations.list.invalidate()
    },
  })
  const createEnrollmentToken = trpc.enrollmentTokens.create.useMutation()

  const organizations = React.useMemo(
    () =>
      (organizationsQuery.data ?? []) as Array<{
        id: string
        name: string
      }>,
    [organizationsQuery.data]
  )
  const sites = React.useMemo(
    () =>
      (sitesQuery.data ?? []) as Array<{
        id: string
        name: string
        organizationId: string
      }>,
    [sitesQuery.data]
  )
  const routePolicies = React.useMemo(
    () =>
      (routePoliciesQuery.data ?? []) as Array<{
        id: string
        name: string
      }>,
    [routePoliciesQuery.data]
  )
  const routePolicyNameById = React.useMemo(
    () =>
      new Map(
        routePolicies.map((routePolicy) => [routePolicy.id, routePolicy.name])
      ),
    [routePolicies]
  )
  const devices = React.useMemo(
    () =>
      (devicesQuery.data ?? []) as Array<{
        id: string
        organizationId: string
        siteId: string | null
        siteName: string | null
        hostname: string | null
        displayName: string
        status: string
        lastSeenAt: string | Date | null
        vpnIpv4: string | null
        vpnRoutePolicyId: string | null
        vpnLastHandshakeAt: string | Date | null
        vpnLatestEndpoint: string | null
        vpnRxBytes: number | null
        vpnTxBytes: number | null
        vpnRevokedAt: string | Date | null
      }>,
    [devicesQuery.data]
  )

  const firstEnabledVncServiceByDeviceId = React.useMemo(() => {
    const services = managementServicesQuery.data ?? []
    const map = new Map<string, (typeof services)[number]>()

    for (const service of services) {
      if (
        service.serviceType !== "vnc" ||
        !service.enabled ||
        map.has(service.deviceId)
      ) {
        continue
      }

      map.set(service.deviceId, service)
    }

    return map
  }, [managementServicesQuery.data])

  const firstEnabledSshServiceByDeviceId = React.useMemo(() => {
    const services = managementServicesQuery.data ?? []
    const map = new Map<string, (typeof services)[number]>()

    for (const service of services) {
      if (
        service.serviceType !== "ssh" ||
        !service.enabled ||
        map.has(service.deviceId)
      ) {
        continue
      }

      map.set(service.deviceId, service)
    }

    return map
  }, [managementServicesQuery.data])

  const launchVncSession = trpc.sessions.create.useMutation({
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

  const launchSshSession = trpc.sessions.create.useMutation({
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

  const siteNameById = React.useMemo(() => {
    return new Map<string, string>(sites.map((site) => [site.id, site.name]))
  }, [sites])

  const selectedSite = React.useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [selectedSiteId, sites]
  )

  React.useEffect(() => {
    setInstallBaseUrl(getClientVpnBaseUrl())
  }, [])

  React.useEffect(() => {
    if (selectedSiteId && !sites.some((site) => site.id === selectedSiteId)) {
      setSelectedSiteId("")
    }
  }, [selectedSiteId, sites])

  async function handleCreateEnrollmentToken() {
    setEnrollmentError(null)

    try {
      let organizationId = selectedSite?.organizationId ?? organizations[0]?.id

      if (!organizationId) {
        const organization = await createOrganization.mutateAsync({
          name: productName,
        })
        organizationId = organization.id
      }

      const result = await createEnrollmentToken.mutateAsync({
        organizationId,
        siteId: selectedSiteId || null,
        routePolicyId: selectedRoutePolicyId || null,
        expiresAt: getEnrollmentTokenExpiration(),
        maxUses: 1,
      })

      setEnrollmentToken(result.token)
      toast.success("Enrollment token created")
    } catch {
      setEnrollmentError("We couldn't create an enrollment token.")
      toast.error("We couldn't create an enrollment token.")
    }
  }

  const windowsInstallCommand = enrollmentToken
    ? buildWindowsInstallCommand({
        token: enrollmentToken,
        baseUrl: installBaseUrl,
      })
    : ""
  const linuxInstallCommand = enrollmentToken
    ? buildLinuxInstallCommand({
        token: enrollmentToken,
        baseUrl: installBaseUrl,
      })
    : ""

  return (
    <DashboardShell>
      <div className="flex w-full flex-col gap-8">
        <PageHeader
          badge="Overview"
          title="Device inventory and private access"
          description="Track enrolled devices, review connectivity, and start remote sessions without exposing management services."
          actions={
            <>
              <Button onClick={() => setEnrollmentOpen((open) => !open)}>
                {enrollmentOpen ? "Hide enrollment" : "New enrollment token"}
              </Button>
              <Button variant="outline" asChild>
                <Link href="/enrollment-tokens">Manage tokens</Link>
              </Button>
            </>
          }
        />

        {enrollmentOpen ? (
          <Card className="border-border/80 shadow-none">
            <CardHeader>
              <CardTitle>Enroll a device</CardTitle>
              <CardDescription>
                Choose where the device belongs, then run the installer.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <FormField label="Site" htmlFor="site">
                  <NativeSelect
                    id="site"
                    value={selectedSiteId}
                    onChange={(event) => setSelectedSiteId(event.target.value)}
                    disabled={sites.length === 0}
                  >
                    <option value="">No site</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Route policy" htmlFor="routePolicy">
                  <NativeSelect
                    id="routePolicy"
                    value={selectedRoutePolicyId}
                    onChange={(event) =>
                      setSelectedRoutePolicyId(event.target.value)
                    }
                  >
                    <option value="">No policy</option>
                    {routePolicies.map((routePolicy) => (
                      <option key={routePolicy.id} value={routePolicy.id}>
                        {routePolicy.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <Button
                  className="w-fit"
                  onClick={() => {
                    void handleCreateEnrollmentToken()
                  }}
                  disabled={
                    createOrganization.isPending ||
                    createEnrollmentToken.isPending
                  }
                >
                  Create token
                </Button>
                {enrollmentToken ? (
                  <CodeBlock label="Enrollment token" value={enrollmentToken} />
                ) : null}
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <p className="font-medium">Run the installer</p>
                  <p className="text-sm text-muted-foreground">
                    Create a token, then run one command on the device.
                  </p>
                </div>
                {enrollmentToken ? (
                  <div className="flex flex-col gap-3">
                    <CodeBlock label="Windows" value={windowsInstallCommand} />
                    <CodeBlock label="Linux" value={linuxInstallCommand} />
                  </div>
                ) : (
                  <EmptyState
                    title="No token yet"
                    description="Installer commands appear after you create a token."
                    bordered
                  />
                )}
                {enrollmentError ? (
                  <p className="text-sm text-destructive">{enrollmentError}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <StatStrip
          items={[
            {
              label: "Devices",
              value: devicesQuery.isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                devices.length
              ),
            },
            {
              label: "Organizations",
              value: organizationsQuery.isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                organizations.length
              ),
            },
            {
              label: "Sites",
              value: sitesQuery.isLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                sites.length
              ),
            },
            {
              label: "Connectivity",
              value: healthQuery.isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : healthQuery.data?.ok ? (
                "Healthy"
              ) : (
                "Degraded"
              ),
            },
          ]}
        />

        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-2">
            <span>Records</span>
            <Badge
              variant={
                healthQuery.data?.postgres === "ok"
                  ? "secondary"
                  : "destructive"
              }
            >
              {healthLabel(healthQuery.data?.postgres, healthQuery.isLoading)}
            </Badge>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-2">
            <span>Jobs</span>
            <Badge
              variant={
                healthQuery.data?.redis === "ok" ? "secondary" : "destructive"
              }
            >
              {healthLabel(healthQuery.data?.redis, healthQuery.isLoading)}
            </Badge>
          </div>
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Devices</h2>
            <p className="text-sm text-muted-foreground">
              Live inventory and status from enrolled devices.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>VPN</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Remote</TableHead>
                  <TableHead>Last connected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devicesQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10">
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-4/5" />
                        <Skeleton className="h-4 w-3/5" />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : devices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      <EmptyState
                        title="No devices yet"
                        description="Create an enrollment token to add the first device."
                        bordered={false}
                        action={
                          <Button onClick={() => setEnrollmentOpen(true)}>
                            New enrollment token
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  devices.map((device) => {
                    const siteName =
                      device.siteName ??
                      (device.siteId
                        ? (siteNameById.get(device.siteId) ?? "—")
                        : "—")
                    const vpnStatus = device.vpnRevokedAt
                      ? "revoked"
                      : device.vpnLastHandshakeAt
                        ? "vpn_online"
                        : "pending"

                    return (
                      <TableRow
                        key={device.id}
                        className="cursor-pointer"
                        onClick={() => {
                          router.push(`/devices/${device.id}`)
                        }}
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-col gap-1">
                            <span>{device.displayName}</span>
                            {device.hostname ? (
                              <span className="font-mono text-xs text-muted-foreground">
                                {device.hostname}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{siteName}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              statusVariant[device.status] ?? "secondary"
                            }
                          >
                            {statusLabel(device.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs">
                              {device.vpnIpv4 ?? "—"}
                            </span>
                            <Badge
                              variant={statusVariant[vpnStatus] ?? "outline"}
                            >
                              {statusLabel(vpnStatus)}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          {device.vpnRoutePolicyId
                            ? (routePolicyNameById.get(
                                device.vpnRoutePolicyId
                              ) ?? "—")
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {firstEnabledVncServiceByDeviceId.get(device.id) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void launchVncSession.mutateAsync({
                                    deviceId: device.id,
                                    serviceId:
                                      firstEnabledVncServiceByDeviceId.get(
                                        device.id
                                      )!.id,
                                    connectionMethod: "guacamole",
                                  })
                                }}
                                disabled={launchVncSession.isPending}
                              >
                                VNC
                              </Button>
                            ) : null}
                            {firstEnabledSshServiceByDeviceId.get(device.id) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void launchSshSession.mutateAsync({
                                    deviceId: device.id,
                                    serviceId:
                                      firstEnabledSshServiceByDeviceId.get(
                                        device.id
                                      )!.id,
                                    connectionMethod: "guacamole",
                                  })
                                }}
                                disabled={launchSshSession.isPending}
                              >
                                SSH
                              </Button>
                            ) : null}
                            {!firstEnabledVncServiceByDeviceId.get(device.id) &&
                            !firstEnabledSshServiceByDeviceId.get(device.id)
                              ? "—"
                              : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          {formatDate(
                            device.vpnLastHandshakeAt ?? device.lastSeenAt
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </DashboardShell>
  )
}
