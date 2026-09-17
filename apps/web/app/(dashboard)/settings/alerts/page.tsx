"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"

import {
  alertKindLabels,
  alertKinds,
  auditSeverities,
  bytesToGigabytes,
  gigabytesToBytes,
  MAX_AGENT_STALE_MINUTES,
  MAX_DISK_FULL_PERCENT,
  MIN_AGENT_STALE_MINUTES,
  MIN_DISK_FULL_PERCENT,
  type AlertKind,
  type AlertPolicyThresholds,
  type AuditSeverity,
} from "@nms/shared"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

const severityLabels: Record<AuditSeverity, string> = {
  info: "Info",
  notice: "Notice",
  warning: "Warning",
  critical: "Critical",
}

const kindDescriptions: Partial<Record<AlertKind, string>> = {
  disk_full:
    "Opens at any hour. A full drive stops a machine whether or not the location is open.",
  agent_stale:
    "Stays quiet while the location is closed. The clock starts when the location opens.",
}

type EffectiveThresholds = {
  offlineHours: number
  diskUsedPercent: number
  diskFreeBytes: number
  agentStaleMinutes: number
}

function PolicyKindRow({
  kind,
  organizationId,
  siteId,
  enabled,
  severity,
  escalateAfterMinutes,
  thresholds,
  source,
}: {
  kind: AlertKind
  organizationId: string
  siteId: string | null
  enabled: boolean
  severity: AuditSeverity
  escalateAfterMinutes: number | null
  thresholds: EffectiveThresholds
  source: "site" | "org" | "default"
}) {
  const utils = trpc.useUtils()
  const upsert = trpc.alertPolicies.upsert.useMutation()
  const [on, setOn] = React.useState(enabled)
  const [level, setLevel] = React.useState<AuditSeverity>(severity)
  const [escalate, setEscalate] = React.useState(
    escalateAfterMinutes ? String(escalateAfterMinutes) : ""
  )
  const [hours, setHours] = React.useState(String(thresholds.offlineHours))
  const [diskPercent, setDiskPercent] = React.useState(
    String(thresholds.diskUsedPercent)
  )
  const [diskFreeGb, setDiskFreeGb] = React.useState(
    String(bytesToGigabytes(thresholds.diskFreeBytes))
  )
  const [staleMinutes, setStaleMinutes] = React.useState(
    String(thresholds.agentStaleMinutes)
  )

  const { offlineHours, diskUsedPercent, diskFreeBytes, agentStaleMinutes } =
    thresholds

  React.useEffect(() => {
    setOn(enabled)
    setLevel(severity)
    setEscalate(escalateAfterMinutes ? String(escalateAfterMinutes) : "")
    setHours(String(offlineHours))
    setDiskPercent(String(diskUsedPercent))
    setDiskFreeGb(String(bytesToGigabytes(diskFreeBytes)))
    setStaleMinutes(String(agentStaleMinutes))
  }, [
    enabled,
    severity,
    escalateAfterMinutes,
    offlineHours,
    diskUsedPercent,
    diskFreeBytes,
    agentStaleMinutes,
  ])

  function thresholdsForSave(): AlertPolicyThresholds | null {
    if (kind === "device_offline") {
      const offline = Number(hours)
      if (!Number.isInteger(offline) || offline < 1) {
        toast.error("Offline hours must be a whole number.")
        return null
      }
      return { offlineHours: offline }
    }
    if (kind === "disk_full") {
      const percent = Number(diskPercent)
      if (
        !Number.isInteger(percent) ||
        percent < MIN_DISK_FULL_PERCENT ||
        percent > MAX_DISK_FULL_PERCENT
      ) {
        toast.error(
          `Full at must be a whole number between ${MIN_DISK_FULL_PERCENT} and ${MAX_DISK_FULL_PERCENT}.`
        )
        return null
      }
      const freeGb = diskFreeGb.trim() === "" ? 0 : Number(diskFreeGb)
      if (!Number.isFinite(freeGb) || freeGb < 0) {
        toast.error("Free space must be zero or more gigabytes.")
        return null
      }
      return {
        diskUsedPercent: percent,
        diskFreeBytes: gigabytesToBytes(freeGb),
      }
    }
    if (kind === "agent_stale") {
      const minutes = Number(staleMinutes)
      if (
        !Number.isInteger(minutes) ||
        minutes < MIN_AGENT_STALE_MINUTES ||
        minutes > MAX_AGENT_STALE_MINUTES
      ) {
        toast.error(
          `Not seen for must be a whole number of minutes, at least ${MIN_AGENT_STALE_MINUTES}.`
        )
        return null
      }
      return { agentStaleMinutes: minutes }
    }
    return {}
  }

  async function save() {
    const minutes = escalate.trim() ? Number(escalate) : null
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1)) {
      toast.error("Escalate after must be a whole number of minutes.")
      return
    }
    const nextThresholds = thresholdsForSave()
    if (!nextThresholds) return
    try {
      await upsert.mutateAsync({
        organizationId,
        siteId,
        kind,
        enabled: on,
        severity: level,
        escalateAfterMinutes: minutes,
        thresholds: nextThresholds,
      })
      toast.success("Alert policy saved.")
      await utils.alertPolicies.list.invalidate()
    } catch {
      toast.error("We couldn't save that policy.")
    }
  }

  const sourceLabel =
    source === "site"
      ? "Site override"
      : source === "org"
        ? "Organization"
        : "Default"

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium">{alertKindLabels[kind]}</p>
          <p className="text-xs text-muted-foreground">{sourceLabel}</p>
          {kindDescriptions[kind] ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {kindDescriptions[kind]}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Enabled</span>
          <Switch checked={on} onCheckedChange={setOn} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Severity" htmlFor={`severity-${kind}`}>
          <SelectField
            id={`severity-${kind}`}
            value={level}
            onValueChange={(value) => setLevel(value as AuditSeverity)}
            options={auditSeverities.map((entry) => ({
              value: entry,
              label: severityLabels[entry],
            }))}
          />
        </FormField>
        <FormField
          label="Escalate after (minutes)"
          htmlFor={`escalate-${kind}`}
          description="Leave empty to skip escalation."
        >
          <Input
            id={`escalate-${kind}`}
            type="number"
            min={1}
            max={10080}
            inputMode="numeric"
            value={escalate}
            onChange={(event) => setEscalate(event.target.value)}
            placeholder="Off"
          />
        </FormField>
        {kind === "device_offline" ? (
          <FormField label="Offline after (hours)" htmlFor={`offline-${kind}`}>
            <Input
              id={`offline-${kind}`}
              type="number"
              min={1}
              max={168}
              inputMode="numeric"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </FormField>
        ) : null}
        {kind === "disk_full" ? (
          <>
            <FormField
              label="Full at (% used)"
              htmlFor={`disk-percent-${kind}`}
            >
              <Input
                id={`disk-percent-${kind}`}
                type="number"
                min={MIN_DISK_FULL_PERCENT}
                max={MAX_DISK_FULL_PERCENT}
                inputMode="numeric"
                value={diskPercent}
                onChange={(event) => setDiskPercent(event.target.value)}
              />
            </FormField>
            <FormField
              label="Or free space below (GB)"
              htmlFor={`disk-free-${kind}`}
              description="Set to 0 to use the percentage only."
            >
              <Input
                id={`disk-free-${kind}`}
                type="number"
                min={0}
                step="0.5"
                inputMode="decimal"
                value={diskFreeGb}
                onChange={(event) => setDiskFreeGb(event.target.value)}
              />
            </FormField>
          </>
        ) : null}
        {kind === "agent_stale" ? (
          <FormField
            label="Not seen for (minutes)"
            htmlFor={`stale-${kind}`}
            description="Counted while the location is open."
          >
            <Input
              id={`stale-${kind}`}
              type="number"
              min={MIN_AGENT_STALE_MINUTES}
              max={MAX_AGENT_STALE_MINUTES}
              inputMode="numeric"
              value={staleMinutes}
              onChange={(event) => setStaleMinutes(event.target.value)}
            />
          </FormField>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={upsert.isPending}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

export default function AlertPoliciesPage() {
  const { can, isLoading: accessLoading } = usePermissions()
  const canManage = can("organization:admin")
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canManage,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: canManage })
  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const [organizationId, setOrganizationId] = React.useState("")
  const [siteId, setSiteId] = React.useState("")

  React.useEffect(() => {
    if (!organizationId && organizations[0]?.id) {
      setOrganizationId(organizations[0].id)
    }
  }, [organizationId, organizations])

  const selectedOrganizationId = organizationId || organizations[0]?.id || ""
  const policiesQuery = trpc.alertPolicies.list.useQuery(
    {
      organizationId: selectedOrganizationId,
      siteId: siteId || null,
    },
    { enabled: canManage && Boolean(selectedOrganizationId) }
  )
  const orgSites = (sitesQuery.data ?? []).filter(
    (site) => site.organizationId === selectedOrganizationId
  )
  const kinds = policiesQuery.data?.kinds ?? []

  if (accessLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          badge="Settings"
          title="Alert policies"
          description="Choose when alerts open, how severe they are, and when they escalate."
        />
        <EmptyState
          title="You don't have access"
          description="Ask an organization admin if you need to change alert policies."
        />
      </div>
    )
  }

  if (organizationsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (organizations.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          badge="Settings"
          title="Alert policies"
          description="Choose when alerts open, how severe they are, and when they escalate."
        />
        <EmptyState
          title="No organization yet"
          description="Create an organization before changing alert policies."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Settings"
        title="Alert policies"
        description="Set defaults for this organization. A site override replaces the organization values for that site."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {organizations.length > 1 ? (
          <FormField label="Organization" htmlFor="policy-org">
            <SelectField
              id="policy-org"
              value={selectedOrganizationId}
              onValueChange={(value) => {
                setOrganizationId(value)
                setSiteId("")
              }}
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              }))}
            />
          </FormField>
        ) : null}
        <FormField
          label="Site override"
          htmlFor="policy-site"
          description="Optional. Saved values apply only to the selected site."
        >
          <SelectField
            id="policy-site"
            value={siteId}
            onValueChange={setSiteId}
            emptyLabel="Organization defaults"
            options={orgSites.map((site) => ({
              value: site.id,
              label: site.name,
            }))}
          />
        </FormField>
      </div>
      <SectionCard
        title="Alert types"
        description="Turn a type off to stop new alerts. Escalation sends a follow-up after the alert has stayed open."
        collapsibleOnMobile
        defaultOpenOnMobile
      >
        {policiesQuery.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {alertKinds.map((kind) => {
              const row = kinds.find((entry) => entry.kind === kind)
              const effective = row?.effective
              return (
                <PolicyKindRow
                  key={`${kind}-${selectedOrganizationId}-${siteId}`}
                  kind={kind}
                  organizationId={selectedOrganizationId}
                  siteId={siteId || null}
                  enabled={effective?.enabled ?? true}
                  severity={effective?.severity ?? "warning"}
                  escalateAfterMinutes={effective?.escalateAfterMinutes ?? null}
                  thresholds={{
                    offlineHours: effective?.offlineHours ?? 24,
                    diskUsedPercent: effective?.diskUsedPercent ?? 95,
                    diskFreeBytes:
                      effective?.diskFreeBytes ?? gigabytesToBytes(2),
                    agentStaleMinutes: effective?.agentStaleMinutes ?? 15,
                  }}
                  source={effective?.source ?? "default"}
                />
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
