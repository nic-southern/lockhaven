"use client"

import * as React from "react"
import { toast } from "sonner"
import { PlusIcon } from "lucide-react"

import {
  customFieldAppliesTo,
  customFieldAppliesToLabels,
  customFieldTypeLabels,
  customFieldTypes,
  type CustomFieldAppliesTo,
  type CustomFieldType,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

export default function CustomFieldsPage() {
  const { can, isLoading } = usePermissions()
  const canView = can("device:view")
  const canManage = can("organization:admin")
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canView,
  })
  const organizations = organizationsQuery.data ?? []
  const [organizationId, setOrganizationId] = React.useState("")
  const resolvedOrganizationId = organizationId || organizations[0]?.id || ""
  const [key, setKey] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [fieldType, setFieldType] = React.useState<CustomFieldType>("text")
  const [appliesTo, setAppliesTo] = React.useState<CustomFieldAppliesTo>("both")
  const [required, setRequired] = React.useState(false)
  const [options, setOptions] = React.useState("")
  const [deleteId, setDeleteId] = React.useState<string | null>(null)

  const listQuery = trpc.customFields.list.useQuery(
    { organizationId: resolvedOrganizationId },
    { enabled: canView && Boolean(resolvedOrganizationId) }
  )
  const createField = trpc.customFields.create.useMutation({
    async onSuccess() {
      await listQuery.refetch()
      setKey("")
      setLabel("")
      setOptions("")
      toast.success("Field added")
    },
    onError(error) {
      toast.error(error.message || "We couldn't add that field.")
    },
  })
  const deleteField = trpc.customFields.delete.useMutation({
    async onSuccess() {
      await utils.customFields.list.invalidate()
      setDeleteId(null)
      toast.success("Field removed")
    },
    onError() {
      toast.error("We couldn't remove that field.")
    },
  })

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />
  }
  if (!canView) {
    return <AccessDenied />
  }

  const fields = listQuery.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Settings"
        title="Custom fields"
        description="Add organization fields for devices and assets."
      />

      <FormField label="Organization" htmlFor="fields-org" className="max-w-sm">
        <SelectField
          id="fields-org"
          value={resolvedOrganizationId}
          onValueChange={setOrganizationId}
          placeholder="Choose an organization"
          options={organizations.map((organization) => ({
            value: organization.id,
            label: organization.name,
          }))}
        />
      </FormField>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {canManage ? (
          <SectionCard
            title="New field"
            description="Keys stay stable so existing values keep matching."
            collapsibleOnMobile
            contentClassName="flex flex-col gap-4"
          >
            <FormField label="Key" htmlFor="field-key">
              <Input
                id="field-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="asset_owner"
              />
            </FormField>
            <FormField label="Label" htmlFor="field-label">
              <Input
                id="field-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Owner"
              />
            </FormField>
            <FormField label="Type" htmlFor="field-type">
              <SelectField
                id="field-type"
                value={fieldType}
                onValueChange={(value) =>
                  setFieldType(value as CustomFieldType)
                }
                options={customFieldTypes.map((type) => ({
                  value: type,
                  label: customFieldTypeLabels[type],
                }))}
              />
            </FormField>
            <FormField label="Applies to" htmlFor="field-applies">
              <SelectField
                id="field-applies"
                value={appliesTo}
                onValueChange={(value) =>
                  setAppliesTo(value as CustomFieldAppliesTo)
                }
                options={customFieldAppliesTo.map((value) => ({
                  value,
                  label: customFieldAppliesToLabels[value],
                }))}
              />
            </FormField>
            {fieldType === "select" ? (
              <FormField label="Options" htmlFor="field-options">
                <Input
                  id="field-options"
                  value={options}
                  onChange={(event) => setOptions(event.target.value)}
                  placeholder="One, two, three"
                />
              </FormField>
            ) : null}
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
              <div>
                <p className="text-sm font-medium">Required</p>
                <p className="text-xs text-muted-foreground">
                  People must fill this in when they save.
                </p>
              </div>
              <Switch checked={required} onCheckedChange={setRequired} />
            </div>
            <Button
              disabled={
                !resolvedOrganizationId ||
                !key ||
                !label ||
                createField.isPending
              }
              onClick={() =>
                void createField.mutateAsync({
                  organizationId: resolvedOrganizationId,
                  key,
                  label,
                  fieldType,
                  appliesTo,
                  required,
                  options: options
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                })
              }
            >
              <PlusIcon />
              Add field
            </Button>
          </SectionCard>
        ) : null}

        <SectionCard title="Fields" description="Shown on devices and assets.">
          {fields.length === 0 ? (
            <EmptyState
              title="No custom fields yet"
              description="Add a field when you need extra details on inventory."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {fields.map((field) => (
                <li
                  key={field.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{field.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {field.key} · {customFieldTypeLabels[field.fieldType]} ·{" "}
                      {customFieldAppliesToLabels[field.appliesTo]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {field.required ? (
                      <Badge variant="secondary">Required</Badge>
                    ) : null}
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeleteId(field.id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        title="Remove this field?"
        description="Existing values stay on records until someone edits them."
        confirmLabel="Remove field"
        destructive
        pending={deleteField.isPending}
        onConfirm={() => {
          if (deleteId) void deleteField.mutateAsync({ id: deleteId })
        }}
      />
    </div>
  )
}
