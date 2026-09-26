"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"
import { DownloadIcon, PlusIcon, Trash2Icon } from "lucide-react"

import {
  alertKindLabels,
  DEFAULT_ARO_PER_YEAR,
  formatDurationMs,
  formatUptimeRatio,
  likelihoodClasses,
  reportCadenceLabels,
  reportTypeLabels,
  utcDayEnd,
  utcDayStart,
  type ReportCadence,
  type ReportType,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { Badge } from "@/components/ui/badge"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { downloadTextFile } from "@/lib/devices"
import { formatDate } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

type ReportTab = ReportType | "risk" | "value"

const reportTabs = [
  "uptime",
  "sessions",
  "alerts",
  "access",
  "value",
  "risk",
] as const satisfies readonly ReportTab[]

function parseReportTab(value: string | null): ReportTab {
  if (value && (reportTabs as readonly string[]).includes(value)) {
    return value as ReportTab
  }
  return "uptime"
}

function formatMoney(value: string | null | undefined) {
  if (!value) return "—"
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

function dateInputValue(date: Date) {
  return utcDayStart(date).toISOString().slice(0, 10)
}

function fromDateInput(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function defaultRange() {
  const today = utcDayStart(new Date())
  return {
    from: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000),
    to: utcDayEnd(today),
  }
}

function ReportTable({
  columns,
  rows,
  emptyTitle,
  emptyDescription,
}: {
  columns: Array<{
    header: string
    className?: string
    cell: (index: number) => React.ReactNode
  }>
  rows: unknown[]
  emptyTitle: string
  emptyDescription: string
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        bordered={false}
      />
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.header} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((_, index) => (
          <TableRow key={index}>
            {columns.map((column) => (
              <TableCell key={column.header} className={column.className}>
                {column.cell(index)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function ReportsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
          <div className="h-96 w-full animate-pulse rounded-xl bg-muted" />
        </div>
      }
    >
      <ReportsContent />
    </React.Suspense>
  )
}

function ReportsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can, isLoading } = usePermissions()
  const allowed = can("audit:view")
  const canManage = can("organization:admin")
  const utils = trpc.useUtils()

  const initial = React.useMemo(() => defaultRange(), [])
  const [from, setFrom] = React.useState(initial.from)
  const [to, setTo] = React.useState(initial.to)
  const [organizationId, setOrganizationId] = React.useState(
    () => searchParams.get("organizationId") ?? ""
  )
  const [siteId, setSiteId] = React.useState(
    () => searchParams.get("siteId") ?? ""
  )
  const tab = parseReportTab(searchParams.get("tab"))
  const [exporting, setExporting] = React.useState(false)
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [aroPerYear, setAroPerYear] = React.useState(
    String(DEFAULT_ARO_PER_YEAR)
  )
  const [likelihoodClassId, setLikelihoodClassId] =
    React.useState<(typeof likelihoodClasses)[number]["id"]>("org_default")

  const setTab = (next: string) => {
    if (!(reportTabs as readonly string[]).includes(next)) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === "uptime") params.delete("tab")
    else params.set("tab", next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

  const parsedAro = (() => {
    const value = Number(aroPerYear)
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_ARO_PER_YEAR
  })()

  const rangeInput = {
    from,
    to,
    organizationId: organizationId || undefined,
    siteId: siteId || undefined,
  }

  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: allowed,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: allowed })
  const uptimeQuery = trpc.reports.uptime.useQuery(rangeInput, {
    enabled: allowed && tab === "uptime",
  })
  const sessionsQuery = trpc.reports.sessions.useQuery(rangeInput, {
    enabled: allowed && tab === "sessions",
  })
  const alertsQuery = trpc.reports.alerts.useQuery(rangeInput, {
    enabled: allowed && tab === "alerts",
  })
  const accessQuery = trpc.reports.accessLog.useQuery(rangeInput, {
    enabled: allowed && tab === "access",
  })
  const installedValueQuery = trpc.reports.installedValue.useQuery(
    {
      organizationId: organizationId || undefined,
      siteId: siteId || undefined,
    },
    { enabled: allowed && tab === "value" }
  )
  const assetRiskQuery = trpc.reports.assetRisk.useQuery(
    {
      organizationId: organizationId || undefined,
      siteId: siteId || undefined,
      aroPerYear: parsedAro,
    },
    { enabled: allowed && tab === "risk" }
  )
  const schedulesQuery = trpc.reports.schedules.useQuery(
    { organizationId },
    { enabled: canManage && Boolean(organizationId) }
  )
  const channelsQuery = trpc.notifications.channels.useQuery(
    { organizationId },
    { enabled: canManage && Boolean(organizationId) }
  )

  const sites = (sitesQuery.data ?? []).filter((site) =>
    organizationId ? site.organizationId === organizationId : true
  )

  function applyPreset(days: number | "month") {
    const today = utcDayStart(new Date())
    if (days === "month") {
      setFrom(
        new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
      )
      setTo(utcDayEnd(today))
      return
    }
    setFrom(new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000))
    setTo(utcDayEnd(today))
  }

  async function downloadCsv() {
    if (tab === "risk" || tab === "value") {
      toast.error("Download is not available for this report yet.")
      return
    }
    setExporting(true)
    try {
      const result = await utils.reports.export.fetch({
        ...rangeInput,
        type: tab,
      })
      downloadTextFile(result.filename, result.csv)
    } catch {
      toast.error("We couldn't download that report.")
    } finally {
      setExporting(false)
    }
  }

  if (!isLoading && !allowed) {
    return (
      <AccessDenied description="Reports are limited to people who can view activity." />
    )
  }

  const loading =
    (tab === "uptime" && uptimeQuery.isLoading) ||
    (tab === "sessions" && sessionsQuery.isLoading) ||
    (tab === "alerts" && alertsQuery.isLoading) ||
    (tab === "access" && accessQuery.isLoading) ||
    (tab === "value" && installedValueQuery.isLoading) ||
    (tab === "risk" && assetRiskQuery.isLoading)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Reports"
        title="Operations reports"
        description="Uptime, sessions, alerts, access, installed value, and expected loss for linked assets. Download a spreadsheet or email one on a schedule."
        actions={
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => void downloadCsv()}
            disabled={
              !allowed || exporting || tab === "risk" || tab === "value"
            }
          >
            <DownloadIcon />
            Download CSV
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FormField label="Organization" htmlFor="report-org">
          <SelectField
            id="report-org"
            value={organizationId}
            onValueChange={(value) => {
              setOrganizationId(value)
              setSiteId("")
            }}
            options={(organizationsQuery.data ?? []).map((organization) => ({
              value: organization.id,
              label: organization.name,
            }))}
            emptyLabel="All organizations"
            placeholder="All organizations"
          />
        </FormField>
        <FormField label="Site" htmlFor="report-site">
          <SelectField
            id="report-site"
            value={siteId}
            onValueChange={setSiteId}
            options={sites.map((site) => ({
              value: site.id,
              label: site.name,
            }))}
            emptyLabel="All sites"
            placeholder="All sites"
          />
        </FormField>
        {tab === "risk" ? (
          <>
            <FormField label="Likelihood preset" htmlFor="report-likelihood">
              <SelectField
                id="report-likelihood"
                value={likelihoodClassId}
                onValueChange={(value) => {
                  const next = likelihoodClasses.find(
                    (entry) => entry.id === value
                  )
                  if (!next) return
                  setLikelihoodClassId(next.id)
                  setAroPerYear(String(next.aroPerYear))
                }}
                options={likelihoodClasses.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                }))}
                placeholder="Choose a preset"
              />
            </FormField>
            <FormField label="Likelihood per year" htmlFor="report-aro">
              <Input
                id="report-aro"
                inputMode="decimal"
                value={aroPerYear}
                onChange={(event) => setAroPerYear(event.target.value)}
              />
            </FormField>
          </>
        ) : tab === "value" ? null : (
          <>
            <FormField label="From" htmlFor="report-from">
              <Input
                id="report-from"
                type="date"
                value={dateInputValue(from)}
                onChange={(event) => setFrom(fromDateInput(event.target.value))}
              />
            </FormField>
            <FormField label="To" htmlFor="report-to">
              <Input
                id="report-to"
                type="date"
                value={dateInputValue(new Date(to.getTime() - 1))}
                onChange={(event) =>
                  setTo(utcDayEnd(fromDateInput(event.target.value)))
                }
              />
            </FormField>
          </>
        )}
      </div>
      {tab !== "risk" && tab !== "value" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => applyPreset(7)}>
            Last 7 days
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset(30)}>
            Last 30 days
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyPreset("month")}
          >
            This month
          </Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="uptime">Uptime</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="access">Access log</TabsTrigger>
          <TabsTrigger value="value">Installed value</TabsTrigger>
          <TabsTrigger value="risk">Expected loss</TabsTrigger>
        </TabsList>

        <TabsContent value="uptime" className="flex flex-col gap-4 pt-4">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <StatStrip
                items={[
                  {
                    label: "Devices",
                    value: uptimeQuery.data?.devices.length ?? 0,
                  },
                  {
                    label: "Sites",
                    value: uptimeQuery.data?.sites.length ?? 0,
                  },
                  {
                    label: "Period",
                    value: uptimeQuery.data?.rangeLabel ?? "—",
                  },
                ]}
              />
              <SectionCard
                title="By site"
                description="Combined online time for devices at each site."
              >
                <ReportTable
                  rows={uptimeQuery.data?.sites ?? []}
                  emptyTitle="No uptime yet"
                  emptyDescription="Summaries appear after devices have been observed for this period."
                  columns={[
                    {
                      header: "Site",
                      cell: (index) => uptimeQuery.data?.sites[index]?.siteName,
                    },
                    {
                      header: "Organization",
                      cell: (index) =>
                        uptimeQuery.data?.sites[index]?.organizationName,
                    },
                    {
                      header: "Devices",
                      className: "text-right",
                      cell: (index) =>
                        uptimeQuery.data?.sites[index]?.deviceCount,
                    },
                    {
                      header: "Uptime",
                      className: "text-right",
                      cell: (index) =>
                        formatUptimeRatio(
                          uptimeQuery.data?.sites[index]?.uptimeRatio ?? 0
                        ),
                    },
                  ]}
                />
              </SectionCard>
              <SectionCard
                title="By device"
                description="Online time from tunnel samples for each device."
              >
                <ReportTable
                  rows={uptimeQuery.data?.devices ?? []}
                  emptyTitle="No device uptime"
                  emptyDescription="Uptime is calculated from tunnel samples for the selected period."
                  columns={[
                    {
                      header: "Device",
                      cell: (index) => (
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">
                            {uptimeQuery.data?.devices[index]?.deviceName}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {uptimeQuery.data?.devices[index]?.hostname ?? "—"}
                          </span>
                        </div>
                      ),
                    },
                    {
                      header: "Site",
                      cell: (index) =>
                        uptimeQuery.data?.devices[index]?.siteName ??
                        "Unassigned",
                    },
                    {
                      header: "Uptime",
                      className: "text-right",
                      cell: (index) =>
                        formatUptimeRatio(
                          uptimeQuery.data?.devices[index]?.uptimeRatio ?? 0
                        ),
                    },
                    {
                      header: "Online",
                      className: "text-right",
                      cell: (index) =>
                        formatDurationMs(
                          uptimeQuery.data?.devices[index]?.onlineMs
                        ),
                    },
                  ]}
                />
              </SectionCard>
            </>
          )}
        </TabsContent>

        <TabsContent value="sessions" className="flex flex-col gap-4 pt-4">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <StatStrip
                items={[
                  {
                    label: "Sessions",
                    value: sessionsQuery.data?.sessionCount ?? 0,
                  },
                  {
                    label: "Technicians",
                    value: sessionsQuery.data?.technicians.length ?? 0,
                  },
                  {
                    label: "Period",
                    value: sessionsQuery.data?.rangeLabel ?? "—",
                  },
                ]}
              />
              <SectionCard
                title="By technician"
                description="Remote sessions started in this period."
              >
                <ReportTable
                  rows={sessionsQuery.data?.technicians ?? []}
                  emptyTitle="No sessions"
                  emptyDescription="Sessions appear here after someone connects to a device."
                  columns={[
                    {
                      header: "Technician",
                      cell: (index) => {
                        const row = sessionsQuery.data?.technicians[index]
                        return (
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {row?.technicianName ?? row?.technicianEmail}
                            </span>
                            {row?.technicianName ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {row.technicianEmail}
                              </span>
                            ) : null}
                          </div>
                        )
                      },
                    },
                    {
                      header: "Sessions",
                      className: "text-right",
                      cell: (index) =>
                        sessionsQuery.data?.technicians[index]?.sessionCount,
                    },
                    {
                      header: "Devices",
                      className: "text-right",
                      cell: (index) =>
                        sessionsQuery.data?.technicians[index]?.deviceCount,
                    },
                    {
                      header: "Time",
                      className: "text-right",
                      cell: (index) =>
                        formatDurationMs(
                          sessionsQuery.data?.technicians[index]?.durationMs
                        ),
                    },
                  ]}
                />
              </SectionCard>
            </>
          )}
        </TabsContent>

        <TabsContent value="alerts" className="flex flex-col gap-4 pt-4">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <StatStrip
                items={[
                  { label: "Opened", value: alertsQuery.data?.count ?? 0 },
                  {
                    label: "Still open",
                    value: alertsQuery.data?.openCount ?? 0,
                  },
                  {
                    label: "MTTA",
                    value: formatDurationMs(alertsQuery.data?.mttaMs),
                    hint: "Time to acknowledge",
                  },
                  {
                    label: "MTTR",
                    value: formatDurationMs(alertsQuery.data?.mttrMs),
                    hint: "Time to resolve",
                  },
                ]}
              />
              <SectionCard
                title="By kind"
                description="How long alerts stayed open after they were first seen."
              >
                <ReportTable
                  rows={alertsQuery.data?.byKind ?? []}
                  emptyTitle="No alerts"
                  emptyDescription="Alert statistics appear when alerts are opened in this period."
                  columns={[
                    {
                      header: "Kind",
                      cell: (index) => {
                        const kind = alertsQuery.data?.byKind[index]?.kind
                        return kind
                          ? (alertKindLabels[
                              kind as keyof typeof alertKindLabels
                            ] ?? kind)
                          : "—"
                      },
                    },
                    {
                      header: "Opened",
                      className: "text-right",
                      cell: (index) => alertsQuery.data?.byKind[index]?.count,
                    },
                    {
                      header: "MTTA",
                      className: "text-right",
                      cell: (index) =>
                        formatDurationMs(
                          alertsQuery.data?.byKind[index]?.mttaMs
                        ),
                    },
                    {
                      header: "MTTR",
                      className: "text-right",
                      cell: (index) =>
                        formatDurationMs(
                          alertsQuery.data?.byKind[index]?.mttrMs
                        ),
                    },
                  ]}
                />
              </SectionCard>
            </>
          )}
        </TabsContent>

        <TabsContent value="access" className="flex flex-col gap-4 pt-4">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <SectionCard
              title="Access log"
              description="Sign-ins, inventory changes, and remote access for the selected period."
            >
              <ReportTable
                rows={accessQuery.data?.rows ?? []}
                emptyTitle="No activity"
                emptyDescription="Nothing was recorded in this period."
                columns={[
                  {
                    header: "Time",
                    cell: (index) =>
                      formatDate(accessQuery.data?.rows[index]?.createdAt),
                  },
                  {
                    header: "Event",
                    cell: (index) => accessQuery.data?.rows[index]?.eventType,
                  },
                  {
                    header: "Actor",
                    cell: (index) =>
                      accessQuery.data?.rows[index]?.actorName ??
                      accessQuery.data?.rows[index]?.actorEmail ??
                      "—",
                  },
                  {
                    header: "Device",
                    cell: (index) =>
                      accessQuery.data?.rows[index]?.deviceName ?? "—",
                  },
                ]}
              />
            </SectionCard>
          )}
        </TabsContent>

        <TabsContent value="value" className="flex flex-col gap-4 pt-4">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <StatStrip
                items={[
                  {
                    label: "In service (linked)",
                    value: installedValueQuery.data?.inServiceLinkedCount ?? 0,
                  },
                  {
                    label: "Replacement value",
                    value: formatMoney(
                      installedValueQuery.data?.totalInstalledValue
                    ),
                  },
                  {
                    label: "Purchase value",
                    value: formatMoney(
                      installedValueQuery.data?.totalPurchaseValue
                    ),
                  },
                  {
                    label: "No cost set",
                    value: installedValueQuery.data?.noCostCount ?? 0,
                    hint:
                      (installedValueQuery.data?.noCostCount ?? 0) > 0
                        ? "Excluded from dollar totals"
                        : undefined,
                  },
                ]}
              />
              {(installedValueQuery.data?.noCostCount ?? 0) > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {installedValueQuery.data?.noCostCount} linked in-service
                  asset
                  {installedValueQuery.data?.noCostCount === 1 ? "" : "s"}{" "}
                  excluded — no cost set on the device model (or asset purchase
                  cost).
                </p>
              ) : null}
              {!siteId && (installedValueQuery.data?.sites.length ?? 0) > 1 ? (
                <SectionCard
                  title="By site"
                  description="Installed value of linked in-service assets at each site."
                >
                  <ReportTable
                    rows={installedValueQuery.data?.sites ?? []}
                    emptyTitle="No sites yet"
                    emptyDescription="Site totals appear when linked in-service assets have a location."
                    columns={[
                      {
                        header: "Site",
                        cell: (index) =>
                          installedValueQuery.data?.sites[index]?.siteName ??
                          "No site",
                      },
                      {
                        header: "In service",
                        className: "text-right",
                        cell: (index) =>
                          installedValueQuery.data?.sites[index]
                            ?.inServiceLinkedCount,
                      },
                      {
                        header: "Replacement value",
                        className: "text-right",
                        cell: (index) =>
                          formatMoney(
                            installedValueQuery.data?.sites[index]
                              ?.totalInstalledValue
                          ),
                      },
                      {
                        header: "Purchase value",
                        className: "text-right",
                        cell: (index) =>
                          formatMoney(
                            installedValueQuery.data?.sites[index]
                              ?.totalPurchaseValue
                          ),
                      },
                      {
                        header: "No cost set",
                        className: "text-right",
                        cell: (index) =>
                          installedValueQuery.data?.sites[index]?.noCostCount,
                      },
                    ]}
                  />
                </SectionCard>
              ) : null}
              <SectionCard
                title="Linked in-service assets"
                description="Replacement value prefers catalog replacement cost, then purchase cost. Set costs under Settings → Device models."
              >
                <ReportTable
                  rows={installedValueQuery.data?.lines ?? []}
                  emptyTitle="No valued assets yet"
                  emptyDescription="Link in-service assets to devices and set replacement or purchase cost on their device model."
                  columns={[
                    {
                      header: "Tracking tag",
                      cell: (index) =>
                        installedValueQuery.data?.lines[index]?.tag ?? "—",
                    },
                    {
                      header: "Site",
                      cell: (index) =>
                        installedValueQuery.data?.lines[index]?.siteName ?? "—",
                    },
                    {
                      header: "Model",
                      cell: (index) =>
                        installedValueQuery.data?.lines[index]
                          ?.deviceModelName ?? "—",
                    },
                    {
                      header: "Replacement value",
                      className: "text-right",
                      cell: (index) =>
                        formatMoney(
                          installedValueQuery.data?.lines[index]?.installedValue
                        ),
                    },
                    {
                      header: "Purchase value",
                      className: "text-right",
                      cell: (index) =>
                        formatMoney(
                          installedValueQuery.data?.lines[index]?.purchaseValue
                        ),
                    },
                  ]}
                />
              </SectionCard>
            </>
          )}
        </TabsContent>

        <TabsContent value="risk" className="flex flex-col gap-4 pt-4">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <StatStrip
                items={[
                  {
                    label: "In service (linked)",
                    value: assetRiskQuery.data?.inServiceLinkedCount ?? 0,
                  },
                  {
                    label: "Replacement value",
                    value: formatMoney(
                      assetRiskQuery.data?.totalReplacementValue
                    ),
                  },
                  {
                    label: "Expected loss",
                    value: formatMoney(assetRiskQuery.data?.totalExpectedLoss),
                    hint: "Per event at current asset value",
                  },
                  {
                    label: "Annual expected loss",
                    value: formatMoney(
                      assetRiskQuery.data?.totalAnnualExpectedLoss
                    ),
                    hint: `Likelihood ${parsedAro} per year`,
                  },
                ]}
              />
              {(assetRiskQuery.data?.noCostCount ?? 0) > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {assetRiskQuery.data?.noCostCount} linked in-service asset
                  {assetRiskQuery.data?.noCostCount === 1 ? "" : "s"} excluded —
                  no cost set on the device model (or asset purchase cost).
                </p>
              ) : null}
              <SectionCard
                title="Linked in-service assets"
                description="Expected loss uses replacement cost when set, then purchase cost. Set costs under Settings → Device models."
              >
                <ReportTable
                  rows={assetRiskQuery.data?.lines ?? []}
                  emptyTitle="No valued assets yet"
                  emptyDescription="Link in-service assets to devices and set replacement or purchase cost on their device model."
                  columns={[
                    {
                      header: "Tracking tag",
                      cell: (index) =>
                        assetRiskQuery.data?.lines[index]?.tag ?? "—",
                    },
                    {
                      header: "Site",
                      cell: (index) =>
                        assetRiskQuery.data?.lines[index]?.siteName ??
                        "Unassigned",
                    },
                    {
                      header: "Model",
                      cell: (index) =>
                        assetRiskQuery.data?.lines[index]?.deviceModelName ??
                        "—",
                    },
                    {
                      header: "Asset value",
                      className: "text-right",
                      cell: (index) =>
                        formatMoney(assetRiskQuery.data?.lines[index]?.value),
                    },
                    {
                      header: "Expected loss",
                      className: "text-right",
                      cell: (index) =>
                        formatMoney(
                          assetRiskQuery.data?.lines[index]?.expectedLoss
                        ),
                    },
                    {
                      header: "Annual expected loss",
                      className: "text-right",
                      cell: (index) =>
                        formatMoney(
                          assetRiskQuery.data?.lines[index]?.annualExpectedLoss
                        ),
                    },
                  ]}
                />
              </SectionCard>
            </>
          )}
        </TabsContent>
      </Tabs>

      {canManage ? (
        <SectionCard
          title="Email schedules"
          description="Send a report to an email channel every week or month."
          actions={
            <Button
              size="sm"
              onClick={() => setScheduleOpen(true)}
              disabled={!organizationId}
            >
              <PlusIcon />
              Add schedule
            </Button>
          }
        >
          {!organizationId ? (
            <EmptyState
              title="Choose an organization"
              description="Schedules are saved per organization."
              bordered={false}
            />
          ) : (
            <ScheduleList
              organizationId={organizationId}
              rows={schedulesQuery.data ?? []}
              loading={schedulesQuery.isLoading}
            />
          )}
        </SectionCard>
      ) : null}

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        organizationId={organizationId}
        sites={sites}
        channels={(channelsQuery.data ?? []).filter(
          (channel) => channel.type === "email"
        )}
      />
    </div>
  )
}

function ScheduleList({
  organizationId,
  rows,
  loading,
}: {
  organizationId: string
  rows: Array<{
    id: string
    name: string
    type: ReportType
    cadence: ReportCadence
    channelName: string
    siteName: string | null
    enabled: boolean
    lastSentAt: Date | string | null
  }>
  loading: boolean
}) {
  const [deleteId, setDeleteId] = React.useState<string | null>(null)
  const utils = trpc.useUtils()
  const updateSchedule = trpc.reports.updateSchedule.useMutation({
    onError() {
      toast.error("We couldn't update that schedule.")
    },
    async onSuccess() {
      await utils.reports.schedules.invalidate({ organizationId })
    },
  })
  const deleteSchedule = trpc.reports.deleteSchedule.useMutation({
    onError() {
      toast.error("We couldn't remove that schedule.")
    },
    async onSuccess() {
      toast.success("Schedule removed")
      setDeleteId(null)
      await utils.reports.schedules.invalidate({ organizationId })
    },
  })

  if (loading) return <Skeleton className="h-24 w-full" />
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No schedules yet"
        description="Add a schedule to email a report at the end of each week or month."
        bordered={false}
      />
    )
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-3 rounded-xl border border-border/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{row.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {reportTypeLabels[row.type]} ·{" "}
                {reportCadenceLabels[row.cadence]} · {row.channelName}
                {row.siteName ? ` · ${row.siteName}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {row.lastSentAt
                  ? `Last sent ${formatDate(row.lastSentAt)}`
                  : "Not sent yet"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={row.enabled ? "secondary" : "outline"}>
                {row.enabled ? "On" : "Off"}
              </Badge>
              <Switch
                checked={row.enabled}
                onCheckedChange={(enabled) =>
                  updateSchedule.mutate({ id: row.id, enabled })
                }
                aria-label={
                  row.enabled ? "Turn schedule off" : "Turn schedule on"
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove schedule"
                onClick={() => setDeleteId(row.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        title="Remove schedule?"
        description="This report will no longer be emailed."
        confirmLabel="Remove"
        destructive
        pending={deleteSchedule.isPending}
        onConfirm={() => {
          if (deleteId) void deleteSchedule.mutateAsync({ id: deleteId })
        }}
      />
    </>
  )
}

function ScheduleDialog({
  open,
  onOpenChange,
  organizationId,
  sites,
  channels,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  sites: Array<{ id: string; name: string }>
  channels: Array<{ id: string; name: string }>
}) {
  const utils = trpc.useUtils()
  const createSchedule = trpc.reports.createSchedule.useMutation()
  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<ReportType>("uptime")
  const [cadence, setCadence] = React.useState<ReportCadence>("weekly")
  const [channelId, setChannelId] = React.useState("")
  const [siteId, setSiteId] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setName("")
    setType("uptime")
    setCadence("weekly")
    setChannelId(channels[0]?.id ?? "")
    setSiteId("")
  }, [open, channels])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      await createSchedule.mutateAsync({
        organizationId,
        name:
          name.trim() ||
          `${reportCadenceLabels[cadence]} ${reportTypeLabels[type]}`,
        type,
        cadence,
        channelId,
        siteId: siteId || null,
      })
      toast.success("Schedule added")
      await utils.reports.schedules.invalidate({ organizationId })
      onOpenChange(false)
    } catch {
      toast.error("We couldn't save that schedule.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Add schedule</DialogTitle>
            <DialogDescription>
              Email a report to a notification channel after each week or month.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Name" htmlFor="schedule-name">
            <Input
              id="schedule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`${reportCadenceLabels[cadence]} ${reportTypeLabels[type]}`}
            />
          </FormField>
          <FormField label="Report" htmlFor="schedule-type">
            <SelectField
              id="schedule-type"
              value={type}
              onValueChange={(value) => setType(value as ReportType)}
              options={Object.entries(reportTypeLabels).map(
                ([value, label]) => ({
                  value,
                  label,
                })
              )}
            />
          </FormField>
          <FormField label="Cadence" htmlFor="schedule-cadence">
            <SelectField
              id="schedule-cadence"
              value={cadence}
              onValueChange={(value) => setCadence(value as ReportCadence)}
              options={Object.entries(reportCadenceLabels).map(
                ([value, label]) => ({ value, label })
              )}
            />
          </FormField>
          <FormField label="Email channel" htmlFor="schedule-channel">
            <SelectField
              id="schedule-channel"
              value={channelId}
              onValueChange={setChannelId}
              options={channels.map((channel) => ({
                value: channel.id,
                label: channel.name,
              }))}
              placeholder="Choose a channel"
            />
          </FormField>
          <FormField label="Site" htmlFor="schedule-site">
            <SelectField
              id="schedule-site"
              value={siteId}
              onValueChange={setSiteId}
              options={sites.map((site) => ({
                value: site.id,
                label: site.name,
              }))}
              emptyLabel="All sites"
              placeholder="All sites"
            />
          </FormField>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!channelId || createSchedule.isPending}
            >
              Save schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
