"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  DEFAULT_TRACKING_TAG_PREFIX,
  normalizeTrackingTagPrefix,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
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
          <span className="font-mono">{exampleTag}</span>. Applies to new tags
          only until you update existing ones below.
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

function RetargetExistingTags({
  organization,
}: {
  organization: OrganizationRow
}) {
  const utils = trpc.useUtils()
  const currentPrefix = normalizeTrackingTagPrefix(
    organization.trackingTagPrefix
  )
  const [fromPrefix, setFromPrefix] = React.useState(
    DEFAULT_TRACKING_TAG_PREFIX
  )
  const [toPrefix, setToPrefix] = React.useState(currentPrefix)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  React.useEffect(() => {
    setToPrefix(currentPrefix)
  }, [currentPrefix])

  const fromNormalized = normalizeTrackingTagPrefix(fromPrefix)
  const toNormalized = normalizeTrackingTagPrefix(toPrefix)
  const canPreview =
    /^[A-Za-z0-9]{1,8}$/.test(fromPrefix.trim()) &&
    /^[A-Za-z0-9]{1,8}$/.test(toPrefix.trim()) &&
    fromNormalized !== toNormalized

  const previewQuery = trpc.organizations.previewTrackingTagRetarget.useQuery(
    {
      organizationId: organization.id,
      fromPrefix: fromPrefix.trim(),
      toPrefix: toPrefix.trim(),
    },
    {
      enabled: canPreview,
    }
  )

  const retarget = trpc.organizations.retargetTrackingTags.useMutation({
    async onSuccess(result) {
      await Promise.all([
        utils.organizations.previewTrackingTagRetarget.invalidate(),
        utils.assets.page.invalidate(),
        utils.assets.list.invalidate(),
      ])
      setConfirmOpen(false)
      if (result.updated === 0) {
        toast.message("No tracking tags needed updating.")
        return
      }
      const conflictNote =
        result.conflicts.length > 0
          ? ` ${result.conflicts.length} skipped because the new tag is already in use.`
          : ""
      toast.success(
        `Updated ${result.updated} tracking tag${result.updated === 1 ? "" : "s"}.${conflictNote} Reprint physical labels so scans stay in sync.`
      )
    },
    onError(error) {
      toast.error(error.message || "We couldn't update tracking tags.")
    },
  })

  const preview = previewQuery.data
  const exampleFrom = `${fromNormalized}-7K2MPQ`
  const exampleTo = `${toNormalized}-7K2MPQ`

  return (
    <>
      <FormField label="Current prefix on tags" htmlFor="labels-from-prefix">
        <Input
          id="labels-from-prefix"
          value={fromPrefix}
          onChange={(event) => setFromPrefix(event.target.value)}
          className="max-w-xs font-mono"
          placeholder={DEFAULT_TRACKING_TAG_PREFIX}
          maxLength={8}
        />
        <p className="text-xs text-muted-foreground">
          Only tags that start with this prefix and a hyphen are changed (for
          example <span className="font-mono">{exampleFrom}</span>). Custom tags
          without that prefix are left alone.
        </p>
      </FormField>
      <FormField label="New prefix" htmlFor="labels-to-prefix">
        <Input
          id="labels-to-prefix"
          value={toPrefix}
          onChange={(event) => setToPrefix(event.target.value)}
          className="max-w-xs font-mono"
          placeholder={currentPrefix}
          maxLength={8}
        />
        <p className="text-xs text-muted-foreground">
          Matching tags become <span className="font-mono">{exampleTo}</span>.
          Defaults to the organization prefix above.
        </p>
      </FormField>

      {canPreview && previewQuery.isFetching ? (
        <p className="text-sm text-muted-foreground">Checking existing tags…</p>
      ) : null}

      {canPreview && preview ? (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <p>
            {preview.updateCount === 0
              ? "No tags match this change."
              : `${preview.updateCount} tag${preview.updateCount === 1 ? "" : "s"} will update from ${preview.fromPrefix}-… to ${preview.toPrefix}-….`}
          </p>
          {preview.conflictCount > 0 ? (
            <p className="mt-1 text-muted-foreground">
              {preview.conflictCount} cannot update because the new tag is
              already in use
              {preview.sampleConflicts[0]
                ? ` (for example ${preview.sampleConflicts[0].fromTag} → ${preview.sampleConflicts[0].toTag})`
                : ""}
              .
            </p>
          ) : null}
          {preview.sampleUpdates[0] ? (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {preview.sampleUpdates[0].fromTag} →{" "}
              {preview.sampleUpdates[0].toTag}
              {preview.updateCount > 1 ? " …" : ""}
            </p>
          ) : null}
          {preview.updateCount > 0 ? (
            <p className="mt-1 text-muted-foreground">
              After updating, reprint physical labels so scanners and Assets
              search stay aligned.
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        variant="secondary"
        disabled={
          !canPreview ||
          !preview ||
          preview.updateCount === 0 ||
          retarget.isPending
        }
        onClick={() => setConfirmOpen(true)}
      >
        Update existing tags
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Update existing tracking tags?"
        description={
          preview
            ? `This renames ${preview.updateCount} asset tag${preview.updateCount === 1 ? "" : "s"} from ${preview.fromPrefix}-… to ${preview.toPrefix}-…. Printed labels will need to be reprinted so scans match Assets search.`
            : "This renames matching asset tags. Printed labels will need to be reprinted."
        }
        confirmLabel="Update tags"
        pending={retarget.isPending}
        onConfirm={() => {
          void retarget.mutateAsync({
            organizationId: organization.id,
            fromPrefix: fromPrefix.trim(),
            toPrefix: toPrefix.trim(),
          })
        }}
      />
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
        <>
          <SectionCard
            title="Organization labels"
            description="These values appear on asset tags and in label exports. New suggested tags use the prefix you save here."
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

          {selected ? (
            <SectionCard
              title="Update existing tags"
              description="Rewrite the leading prefix on assets that already use the old scheme. Custom tags without that prefix are not changed."
              contentClassName="gap-4"
            >
              <RetargetExistingTags
                key={`${selected.id}:retarget:${selected.trackingTagPrefix}`}
                organization={selected}
              />
            </SectionCard>
          ) : null}
        </>
      )}
    </div>
  )
}
