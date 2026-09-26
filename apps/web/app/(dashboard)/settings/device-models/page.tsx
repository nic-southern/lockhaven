"use client"

import * as React from "react"
import { toast } from "sonner"
import { PlusIcon } from "lucide-react"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

export default function DeviceModelsPage() {
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
  const [name, setName] = React.useState("")
  const [manufacturer, setManufacturer] = React.useState("")
  const [model, setModel] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [deleteId, setDeleteId] = React.useState<string | null>(null)

  const listQuery = trpc.deviceModels.list.useQuery(
    { organizationId: resolvedOrganizationId },
    { enabled: canView && Boolean(resolvedOrganizationId) }
  )
  const createModel = trpc.deviceModels.create.useMutation({
    async onSuccess() {
      await listQuery.refetch()
      setName("")
      setManufacturer("")
      setModel("")
      setNotes("")
      toast.success("Device model added")
    },
    onError(error) {
      toast.error(error.message || "We couldn't add that model.")
    },
  })
  const deleteModel = trpc.deviceModels.delete.useMutation({
    async onSuccess() {
      await utils.deviceModels.list.invalidate()
      setDeleteId(null)
      toast.success("Device model removed")
    },
    onError() {
      toast.error("We couldn't remove that model.")
    },
  })

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />
  }
  if (!canView) {
    return <AccessDenied />
  }

  const items = listQuery.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Device models"
        description="Organization catalog used when creating or linking assets."
      />

      <FormField label="Organization" htmlFor="device-model-org">
        <SelectField
          id="device-model-org"
          value={resolvedOrganizationId}
          onValueChange={setOrganizationId}
          placeholder="Choose an organization"
          options={organizations.map((organization) => ({
            value: organization.id,
            label: organization.name,
          }))}
        />
      </FormField>

      {canManage ? (
        <SectionCard
          title="Add model"
          description="Keep names short for lists."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="device-model-name">
              <Input
                id="device-model-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Gaming PC"
              />
            </FormField>
            <FormField label="Manufacturer" htmlFor="device-model-mfr">
              <Input
                id="device-model-mfr"
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
              />
            </FormField>
            <FormField label="Model" htmlFor="device-model-code">
              <Input
                id="device-model-code"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </FormField>
            <FormField label="Notes" htmlFor="device-model-notes">
              <Textarea
                id="device-model-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
              />
            </FormField>
          </div>
          <Button
            className="mt-4"
            disabled={
              !resolvedOrganizationId ||
              !name.trim() ||
              !model.trim() ||
              createModel.isPending
            }
            onClick={() =>
              void createModel.mutateAsync({
                organizationId: resolvedOrganizationId,
                name,
                manufacturer: manufacturer || null,
                model,
                notes: notes || null,
              })
            }
          >
            <PlusIcon />
            Add model
          </Button>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Catalog"
        description={
          items.length === 0
            ? "No models yet."
            : `${items.length} model${items.length === 1 ? "" : "s"}`
        }
      >
        {listQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No device models"
            description="Add the hardware types you deploy so assets can pick from a list."
            bordered={false}
          />
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[item.manufacturer, item.model]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canManage ? (
                  <Button variant="ghost" onClick={() => setDeleteId(item.id)}>
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        title="Remove device model?"
        description="Assets keep their tracking tags. The model assignment is cleared."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleteId) void deleteModel.mutateAsync({ id: deleteId })
        }}
      />
    </div>
  )
}
