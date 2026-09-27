"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  DEFAULT_TRACKING_TAG_PREFIX,
  normalizeTrackingTagPrefix,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type OrganizationRow = {
  id: string
  name: string
  trackingTagPrefix: string
}

function LabelsOrganizationForm({
  organization,
}: {
  organization: OrganizationRow
}) {
  const utils = trpc.useUtils()
  const [name, setName] = React.useState(organization.name)
  const [prefix, setPrefix] = React.useState(
    organization.trackingTagPrefix || DEFAULT_TRACKING_TAG_PREFIX
  )

  const updateOrganization = trpc.organizations.update.useMutation({
    async onSuccess(record) {
      await utils.organizations.list.invalidate()
      setName(record.name)
      setPrefix(record.trackingTagPrefix || DEFAULT_TRACKING_TAG_PREFIX)
      toast.success("Label settings saved")
    },
    onError(error) {
      toast.error(error.message || "We couldn't save label settings.")
    },
  })

  const exampleTag = `${normalizeTrackingTagPrefix(prefix)}-7K2MPQ`
  const dirty =
    name.trim() !== organization.name ||
    normalizeTrackingTagPrefix(prefix) !==
      normalizeTrackingTagPrefix(organization.trackingTagPrefix)

  return (
    <>
      <FormField label="Company name" htmlFor="labels-company-name">
        <Input
          id="labels-company-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="NewMarketEntertainment"
        />
        <p className="text-xs text-muted-foreground">
          Printed as the third line on tape labels.
        </p>
      </FormField>
      <FormField label="Tracking tag prefix" htmlFor="labels-tag-prefix">
        <Input
          id="labels-tag-prefix"
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
          className="max-w-xs font-mono"
          placeholder={DEFAULT_TRACKING_TAG_PREFIX}
          maxLength={8}
        />
        <p className="text-xs text-muted-foreground">
          1–8 letters or numbers. Suggested tags look like{" "}
          <span className="font-mono">{exampleTag}</span>.
        </p>
      </FormField>
      <Button
        disabled={!dirty || !name.trim() || updateOrganization.isPending}
        onClick={() => {
          void updateOrganization.mutateAsync({
            id: organization.id,
            name: name.trim(),
            trackingTagPrefix: prefix.trim(),
          })
        }}
      >
        Save
      </Button>
    </>
  )
}

export default function LabelsSettingsPage() {
  const { can, isLoading } = usePermissions()
  const canManage = can("organization:admin")
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canManage,
  })
  const organizations = organizationsQuery.data ?? []
  const [organizationId, setOrganizationId] = React.useState("")
  const resolvedOrganizationId = organizationId || organizations[0]?.id || ""
  const selected = organizations.find(
    (organization) => organization.id === resolvedOrganizationId
  )

  if (isLoading || organizationsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (!canManage) {
    return <AccessDenied />
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Labels"
        description="Company name on printed tags and the prefix used when suggesting tracking tags."
      />

      {organizations.length === 0 ? (
        <SectionCard title="No organizations">
          <p className="text-sm text-muted-foreground">
            Create an organization before configuring label settings.
          </p>
        </SectionCard>
      ) : (
        <SectionCard
          title="Organization labels"
          description="These values appear on asset tags and in label exports. Existing tags are not renamed when you change the prefix."
          contentClassName="gap-4"
          actions={
            organizations.length > 1 ? (
              <SelectField
                id="labels-organization"
                value={resolvedOrganizationId}
                onValueChange={setOrganizationId}
                options={organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
              />
            ) : null
          }
        >
          {selected ? (
            <LabelsOrganizationForm
              key={`${selected.id}:${selected.name}:${selected.trackingTagPrefix}`}
              organization={selected}
            />
          ) : null}
        </SectionCard>
      )}
    </div>
  )
}
