"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"

import {
  alertKindLabels,
  alertKinds,
  auditSeverities,
  type AlertKind,
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

function PolicyKindRow({
  kind,
  organizationId,
  siteId,
  enabled,
  severity,
  escalateAfterMinutes,
  offlineHours,
  source,
}: {
  kind: AlertKind
  organizationId: string
  siteId: string | null
  enabled: boolean
  severity: AuditSeverity
  escalateAfterMinutes: number | null
  offlineHours: number
  source: "site" | "org" | "default"
}) {
  const utils = trpc.useUtils()
  const upsert = trpc.alertPolicies.upsert.useMutation()
  const [on, setOn] = React.useState(enabled)
  const [level, setLevel] = React.useState<AuditSeverity>(severity)
  const [escalate, setEscalate] = React.useState(
    escalateAfterMinutes ? String(escalateAfterMinutes) : ""
  )
  const [hours, setHours] = React.useState(String(offlineHours))

  React.useEffect(() => {
    setOn(enabled)
    setLevel(severity)
    setEscalate(escalateAfterMinutes ? String(escalateAfterMinutes) : "")
    setHours(String(offlineHours))
  }, [enabled, severity, escalateAfterMinutes, offlineHours])

  async function save() {
    const minutes = escalate.trim() ? Number(escalate) : null
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1)) {
      toast.error("Escalate after must be a whole number of minutes.")
      return
    }
    const offline = Number(hours)
    if (
      kind === "device_offline" &&
      (!Number.isInteger(offline) || offline < 1)
    ) {
      toast.error("Offline hours must be a whole number.")
      return
    }
    try {
      await upsert.mutateAsync({
        organizationId,
        siteId,
        kind,
        enabled: on,
        severity: level,
        escalateAfterMinutes: minutes,
        thresholds: kind === "device_offline" ? { offlineHours: offline } : {},
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
                  offlineHours={effective?.offlineHours ?? 24}
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
