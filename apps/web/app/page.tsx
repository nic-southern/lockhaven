"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { signOut, useSession } from "@/lib/auth-client"
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
import { getClientProductName, getProductInitials } from "@/lib/product-name"
import { getApiBaseUrl, trpc } from "@/lib/trpc"

type HealthResponse = {
  ok: boolean
  postgres: "ok" | "degraded"
  redis: "ok" | "degraded"
}

type EnrollmentResponse = {
  device_id: string
  vpn_ipv4: string
  wireguard: {
    server_public_key: string
    endpoint: string
    allowed_ips: string[]
    persistent_keepalive: number
  }
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

function buildWireGuardConfig(args: {
  privateKey: string
  address: string
  serverPublicKey: string
  endpoint: string
  allowedIps: string[]
  persistentKeepalive: number
}) {
  return [
    "[Interface]",
    `Address = ${args.address}`,
    `PrivateKey = ${args.privateKey}`,
    "",
    "[Peer]",
    `PublicKey = ${args.serverPublicKey}`,
    `Endpoint = ${args.endpoint}`,
    `AllowedIPs = ${args.allowedIps.join(", ")}`,
    `PersistentKeepalive = ${args.persistentKeepalive}`,
  ].join("\n")
}

function downloadTextFile(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function Page() {
  const { data: session, isPending: sessionPending } = useSession()
  const utils = trpc.useUtils()
  const productName = getClientProductName()
  const [enrollmentOpen, setEnrollmentOpen] = React.useState(false)
  const [organizationName, setOrganizationName] = React.useState(productName)
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("")
  const [selectedSiteId, setSelectedSiteId] = React.useState("")
  const [selectedRoutePolicyId, setSelectedRoutePolicyId] = React.useState("")
  const [enrollmentToken, setEnrollmentToken] = React.useState("")
  const [hostname, setHostname] = React.useState("proxmox-test-vm")
  const [osFamily, setOsFamily] = React.useState("linux")
  const [osVersion, setOsVersion] = React.useState("debian")
  const [architecture, setArchitecture] = React.useState("amd64")
  const [serialNumber, setSerialNumber] = React.useState("local-test")
  const [wireguardPrivateKey, setWireguardPrivateKey] = React.useState("")
  const [wireguardPublicKey, setWireguardPublicKey] = React.useState("")
  const [generatedConfig, setGeneratedConfig] = React.useState("")
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

  const enrollmentOrganizationId =
    selectedOrganizationId || organizations[0]?.id || ""
  const enrollmentSites = React.useMemo(
    () =>
      sites.filter((site) => site.organizationId === enrollmentOrganizationId),
    [enrollmentOrganizationId, sites]
  )

  React.useEffect(() => {
    if (
      selectedSiteId &&
      !enrollmentSites.some((site) => site.id === selectedSiteId)
    ) {
      setSelectedSiteId("")
    }
  }, [enrollmentSites, selectedSiteId])

  async function handleCreateEnrollmentToken() {
    setEnrollmentError(null)
    setGeneratedConfig("")

    try {
      let organizationId = selectedOrganizationId || organizations[0]?.id

      if (!organizationId) {
        const organization = await createOrganization.mutateAsync({
          name: organizationName,
        })
        organizationId = organization.id
        setSelectedOrganizationId(organization.id)
      }

      const result = await createEnrollmentToken.mutateAsync({
        organizationId,
        siteId: selectedSiteId || null,
        routePolicyId: selectedRoutePolicyId || null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        maxUses: 1,
      })

      setEnrollmentToken(result.token)
    } catch {
      setEnrollmentError("We couldn't create an enrollment token.")
    }
  }

  async function handleEnrollTestDevice() {
    setEnrollmentError(null)

    if (!enrollmentToken || !wireguardPrivateKey || !wireguardPublicKey) {
      setEnrollmentError("Add an enrollment token and keypair first.")
      return
    }

    try {
      const response = await fetch("/api/enroll", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: enrollmentToken,
          hostname,
          os_family: osFamily,
          os_version: osVersion,
          architecture,
          serial_number: serialNumber,
          wireguard_public_key: wireguardPublicKey,
          services: [
            {
              type: "ssh",
              protocol: "tcp",
              port: 22,
            },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error("Enrollment failed")
      }

      const result = (await response.json()) as EnrollmentResponse
      const config = buildWireGuardConfig({
        privateKey: wireguardPrivateKey,
        address: result.vpn_ipv4,
        serverPublicKey: result.wireguard.server_public_key,
        endpoint: result.wireguard.endpoint,
        allowedIps: result.wireguard.allowed_ips,
        persistentKeepalive: result.wireguard.persistent_keepalive,
      })

      setGeneratedConfig(config)
      downloadTextFile(`${hostname}.conf`, `${config}\n`)
      void utils.devices.list.invalidate()
    } catch {
      setEnrollmentError("We couldn't enroll this device.")
    }
  }

  return (
    <DashboardShell hideHeader>
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
              {getProductInitials(productName)}
            </div>
            <div>
              <p className="text-sm leading-none font-semibold">
                {productName}
              </p>
              <p className="text-xs text-muted-foreground">
                Management console
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm sm:block">
              <p className="font-medium">
                {session?.user?.name ?? session?.user?.email ?? "Signed in"}
              </p>
              <p className="text-xs text-muted-foreground">
                {sessionPending ? "Checking session" : "Admin access"}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                void signOut({
                  fetchOptions: {
                    onSuccess() {
                      window.location.assign("/sign-in")
                    },
                  },
                })
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <section className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <Badge variant="outline" className="w-fit">
              Management dashboard
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight">
              Device inventory and private management
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
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
                Create a one-time token, submit a device keypair, and download a
                VPN profile.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="grid gap-2 text-sm">
                  <label htmlFor="organization" className="font-medium">
                    Organization
                  </label>
                  {organizations.length > 0 ? (
                    <select
                      id="organization"
                      className="h-10 rounded-md border bg-background px-3"
                      value={enrollmentOrganizationId}
                      onChange={(event) => {
                        setSelectedOrganizationId(event.target.value)
                        setSelectedSiteId("")
                      }}
                    >
                      {organizations.map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="organization"
                      className="h-10 rounded-md border bg-background px-3"
                      value={organizationName}
                      onChange={(event) =>
                        setOrganizationName(event.target.value)
                      }
                    />
                  )}
                </div>
                <div className="grid gap-2 text-sm">
                  <label htmlFor="site" className="font-medium">
                    Site
                  </label>
                  <select
                    id="site"
                    className="h-10 rounded-md border bg-background px-3"
                    value={selectedSiteId}
                    onChange={(event) => setSelectedSiteId(event.target.value)}
                    disabled={enrollmentSites.length === 0}
                  >
                    <option value="">No site</option>
                    {enrollmentSites.map((site) => (
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
                <p className="text-sm text-muted-foreground">
                  Generate a keypair locally before enrolling:{" "}
                  <code>wg genkey | tee privatekey | wg pubkey</code>
                </p>
              </div>

              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Hostname</span>
                    <input
                      className="h-10 rounded-md border bg-background px-3"
                      value={hostname}
                      onChange={(event) => setHostname(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">System</span>
                    <input
                      className="h-10 rounded-md border bg-background px-3"
                      value={osFamily}
                      onChange={(event) => setOsFamily(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Version</span>
                    <input
                      className="h-10 rounded-md border bg-background px-3"
                      value={osVersion}
                      onChange={(event) => setOsVersion(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium">Architecture</span>
                    <input
                      className="h-10 rounded-md border bg-background px-3"
                      value={architecture}
                      onChange={(event) => setArchitecture(event.target.value)}
                    />
                  </label>
                </div>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Serial number</span>
                  <input
                    className="h-10 rounded-md border bg-background px-3"
                    value={serialNumber}
                    onChange={(event) => setSerialNumber(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Private key</span>
                  <textarea
                    className="min-h-20 rounded-md border bg-background px-3 py-2 font-mono text-xs"
                    value={wireguardPrivateKey}
                    onChange={(event) =>
                      setWireguardPrivateKey(event.target.value.trim())
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Public key</span>
                  <textarea
                    className="min-h-20 rounded-md border bg-background px-3 py-2 font-mono text-xs"
                    value={wireguardPublicKey}
                    onChange={(event) =>
                      setWireguardPublicKey(event.target.value.trim())
                    }
                  />
                </label>
                <Button
                  onClick={() => {
                    void handleEnrollTestDevice()
                  }}
                  disabled={
                    !enrollmentToken ||
                    !wireguardPrivateKey ||
                    !wireguardPublicKey
                  }
                >
                  Enroll and download config
                </Button>
                {enrollmentError ? (
                  <p className="text-sm text-destructive">{enrollmentError}</p>
                ) : null}
              </div>

              {generatedConfig ? (
                <div className="lg:col-span-2">
                  <p className="mb-2 text-sm font-medium">
                    Generated VPN profile
                  </p>
                  <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">
                    {generatedConfig}
                  </pre>
                </div>
              ) : null}
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
