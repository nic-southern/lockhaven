"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"

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
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import {
  getClientProductName,
  getClientSocBaseUrl,
  getClientVpnBaseUrl,
} from "@/lib/product-name"
import { getApiBaseUrl, trpc } from "@/lib/trpc"
import {
  buildLinuxInstallCommand,
  buildSocWindowsInstallCommand,
  buildVpnAndSocWindowsInstallCommand,
  buildWindowsInstallCommand,
} from "@/lib/enrollment-commands"

type HealthResponse = {
  ok: boolean
  postgres: "ok" | "degraded"
  redis: "ok" | "degraded"
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  service_online: "default",
  vpn_online: "secondary",
  degraded: "destructive",
  offline: "outline",
  enrolled: "secondary",
  pending: "outline",
  revoked: "destructive",
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

const ENROLLMENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getEnrollmentTokenExpiration() {
  return new Date(Date.now() + ENROLLMENT_TOKEN_TTL_MS)
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
  const [socBaseUrl, setSocBaseUrl] = React.useState(getClientSocBaseUrl)
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
        status: keyof typeof statusVariant
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
  })

  const launchSshSession = trpc.sessions.create.useMutation({
    onSuccess(result) {
      if (!result) {
        return
      }

      window.open(result.url, "_blank", "noopener,noreferrer")
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
    setSocBaseUrl(getClientSocBaseUrl())
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
    } catch {
      setEnrollmentError("We couldn't create an enrollment token.")
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
  const selectedSiteName = selectedSiteId
    ? (siteNameById.get(selectedSiteId) ?? "")
    : ""
  const showSocCommands = Boolean(socBaseUrl)
  const socWindowsInstallCommand =
    socBaseUrl && selectedSiteName
      ? buildSocWindowsInstallCommand({
          baseUrl: socBaseUrl,
          siteName: selectedSiteName,
        })
      : ""
  const windowsVpnAndSocInstallCommand =
    enrollmentToken && socBaseUrl && selectedSiteName
      ? buildVpnAndSocWindowsInstallCommand({
          vpnToken: enrollmentToken,
          vpnBaseUrl: installBaseUrl,
          socBaseUrl,
          siteName: selectedSiteName,
        })
      : ""

  return (
    <DashboardShell>
      <div className="flex w-full flex-col gap-6">
        <section className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <Badge variant="outline" className="w-fit">
              Management dashboard
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight">
              Device inventory and private management
            </h1>
            <p className="text-sm text-muted-foreground">
              Track enrolled devices, review VPN and service state, and start
              remote sessions without exposing management services directly.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setEnrollmentOpen((open) => !open)}>
              New enrollment token
            </Button>
            <Button variant="outline" asChild>
              <Link href="/enrollment-tokens">Manage enrollment tokens</Link>
            </Button>
          </div>
        </section>

        {enrollmentOpen ? (
          <Card>
            <CardHeader>
              <CardTitle>Enroll a Device</CardTitle>
              <CardDescription>
                Choose where the device belongs, then run the installer.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="grid gap-2 text-sm">
                  <label htmlFor="site" className="font-medium">
                    Site
                  </label>
                  <select
                    id="site"
                    className="h-10 rounded-md border bg-background px-3"
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
                  </select>
                </div>
                <div className="grid gap-2 text-sm">
                  <label htmlFor="routePolicy" className="font-medium">
                    Route policy
                  </label>
                  <select
                    id="routePolicy"
                    className="h-10 rounded-md border bg-background px-3"
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
                  </select>
                </div>
                <Button
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
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                    <p className="mb-2 font-medium">Enrollment token</p>
                    <code className="break-all">{enrollmentToken}</code>
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                <div>
                  <p className="font-medium">Run the installer</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create a token, then run one command on the device.
                  </p>
                </div>
                {enrollmentToken ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                      <p className="mb-2 font-medium">VPN Windows</p>
                      <pre className="overflow-auto rounded-md bg-background p-3 text-xs whitespace-pre-wrap">
                        {windowsInstallCommand}
                      </pre>
                    </div>
                    {showSocCommands ? (
                      <>
                        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                          <p className="mb-2 font-medium">
                            VPN + Lockhaven SOC Host
                          </p>
                          {windowsVpnAndSocInstallCommand ? (
                            <pre className="overflow-auto rounded-md bg-background p-3 text-xs whitespace-pre-wrap">
                              {windowsVpnAndSocInstallCommand}
                            </pre>
                          ) : (
                            <p className="text-muted-foreground">
                              Choose a site to create this command.
                            </p>
                          )}
                        </div>
                        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                          <p className="mb-2 font-medium">SOC only Windows</p>
                          {socWindowsInstallCommand ? (
                            <pre className="overflow-auto rounded-md bg-background p-3 text-xs whitespace-pre-wrap">
                              {socWindowsInstallCommand}
                            </pre>
                          ) : (
                            <p className="text-muted-foreground">
                              Choose a site to create this command.
                            </p>
                          )}
                        </div>
                      </>
                    ) : null}
                    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                      <p className="mb-2 font-medium">Linux</p>
                      <pre className="overflow-auto rounded-md bg-background p-3 text-xs whitespace-pre-wrap">
                        {linuxInstallCommand}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                    Installer commands appear after you create a token.
                  </div>
                )}
                {enrollmentError ? (
                  <p className="text-sm text-destructive">{enrollmentError}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Devices</CardDescription>
              <CardTitle className="text-3xl">
                {devicesQuery.isLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  devices.length
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Devices currently known to the system.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Organizations</CardDescription>
              <CardTitle className="text-3xl">
                {organizationsQuery.isLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  organizations.length
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Top-level groups in your workspace.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Sites</CardDescription>
              <CardTitle className="text-3xl">
                {sitesQuery.isLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  sites.length
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Locations attached to enrolled devices.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Connectivity</CardDescription>
              <CardTitle className="text-3xl">
                {healthQuery.isLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : healthQuery.data?.ok ? (
                  "OK"
                ) : (
                  "Degraded"
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>Records</span>
                <Badge
                  variant={
                    healthQuery.data?.postgres === "ok"
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {healthQuery.isLoading
                    ? "Checking"
                    : (healthQuery.data?.postgres ?? "Down")}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Jobs</span>
                <Badge
                  variant={
                    healthQuery.data?.redis === "ok"
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {healthQuery.isLoading
                    ? "Checking"
                    : (healthQuery.data?.redis ?? "Down")}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              Live inventory and status from enrolled devices
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
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
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Loading devices...
                      </TableCell>
                    </TableRow>
                  ) : devices.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No devices yet
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
                                <span className="text-xs text-muted-foreground">
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
                              {device.status.replaceAll("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span>{device.vpnIpv4 ?? "—"}</span>
                              <Badge
                                variant={statusVariant[vpnStatus] ?? "outline"}
                              >
                                {vpnStatus.replaceAll("_", " ")}
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
                              {firstEnabledVncServiceByDeviceId.get(
                                device.id
                              ) ? (
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
                              {firstEnabledSshServiceByDeviceId.get(
                                device.id
                              ) ? (
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
                              {!firstEnabledVncServiceByDeviceId.get(
                                device.id
                              ) &&
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
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  )
}
