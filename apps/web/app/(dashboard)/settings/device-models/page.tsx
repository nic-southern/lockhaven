"use client"

import * as React from "react"
import { toast } from "sonner"
import { PlusIcon } from "lucide-react"

import { retireMonthsToYears, yearsToRetireMonths } from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
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
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type ModelForm = {
  name: string
  manufacturer: string
  model: string
  notes: string
  purchaseCost: string
  replacementCost: string
  defaultPurchaseDate: string
  retireAfterYears: string
}

const emptyForm: ModelForm = {
  name: "",
  manufacturer: "",
  model: "",
  notes: "",
  purchaseCost: "",
  replacementCost: "",
  defaultPurchaseDate: "",
  retireAfterYears: "",
}

function formatCost(value: string | null | undefined) {
  if (!value) return "—"
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

function costPayload(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function yearsPayload(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const years = Number(trimmed)
  if (!Number.isFinite(years) || years <= 0) return null
  return yearsToRetireMonths(years)
}

function formatRetireAfter(months: number | null | undefined) {
  const years = retireMonthsToYears(months)
  if (years == null) return "—"
  return `${years} year${years === 1 ? "" : "s"}`
}

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
  const [form, setForm] = React.useState<ModelForm>(emptyForm)
  const [deleteId, setDeleteId] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editForm, setEditForm] = React.useState<ModelForm>(emptyForm)

  const listQuery = trpc.deviceModels.list.useQuery(
    { organizationId: resolvedOrganizationId },
    { enabled: canView && Boolean(resolvedOrganizationId) }
  )
  const createModel = trpc.deviceModels.create.useMutation({
    async onSuccess() {
      await listQuery.refetch()
      setForm(emptyForm)
      toast.success("Device model added")
    },
    onError(error) {
      toast.error(error.message || "We couldn't add that model.")
    },
  })
  const updateModel = trpc.deviceModels.update.useMutation({
    async onSuccess() {
      await utils.deviceModels.list.invalidate()
      setEditingId(null)
      toast.success("Device model updated")
    },
    onError(error) {
      toast.error(error.message || "We couldn't update that model.")
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
  const editing = items.find((item) => item.id === editingId)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Device models"
        description="Organization catalog used when creating or linking assets. Set costs for expected loss, and purchase date plus retire-after so assigned assets inherit a retirement schedule."
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
          description="Keep names short for lists. Replacement cost is preferred for expected loss."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="device-model-name">
              <Input
                id="device-model-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Gaming PC"
              />
            </FormField>
            <FormField label="Manufacturer" htmlFor="device-model-mfr">
              <Input
                id="device-model-mfr"
                value={form.manufacturer}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    manufacturer: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Model" htmlFor="device-model-code">
              <Input
                id="device-model-code"
                value={form.model}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Notes" htmlFor="device-model-notes">
              <Textarea
                id="device-model-notes"
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                rows={2}
              />
            </FormField>
            <FormField label="Purchase cost" htmlFor="device-model-purchase">
              <Input
                id="device-model-purchase"
                inputMode="decimal"
                value={form.purchaseCost}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    purchaseCost: event.target.value,
                  }))
                }
                placeholder="0.00"
              />
            </FormField>
            <FormField
              label="Replacement cost"
              htmlFor="device-model-replacement"
            >
              <Input
                id="device-model-replacement"
                inputMode="decimal"
                value={form.replacementCost}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    replacementCost: event.target.value,
                  }))
                }
                placeholder="0.00"
              />
            </FormField>
            <FormField
              label="Default purchase date"
              htmlFor="device-model-purchase-date"
            >
              <Input
                id="device-model-purchase-date"
                type="date"
                value={form.defaultPurchaseDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    defaultPurchaseDate: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField
              label="Retire after (years)"
              htmlFor="device-model-retire-years"
            >
              <Input
                id="device-model-retire-years"
                inputMode="decimal"
                value={form.retireAfterYears}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    retireAfterYears: event.target.value,
                  }))
                }
                placeholder="7"
              />
            </FormField>
          </div>
          <Button
            className="mt-4"
            disabled={
              !resolvedOrganizationId ||
              !form.name.trim() ||
              !form.model.trim() ||
              createModel.isPending
            }
            onClick={() =>
              void createModel.mutateAsync({
                organizationId: resolvedOrganizationId,
                name: form.name,
                manufacturer: form.manufacturer || null,
                model: form.model,
                notes: form.notes || null,
                purchaseCost: costPayload(form.purchaseCost),
                replacementCost: costPayload(form.replacementCost),
                defaultPurchaseDate: form.defaultPurchaseDate || null,
                retireAfterMonths: yearsPayload(form.retireAfterYears),
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
                  <p className="mt-1 text-sm text-muted-foreground">
                    Purchase {formatCost(item.purchaseCost)} · Replacement{" "}
                    {formatCost(item.replacementCost)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Purchase date {item.defaultPurchaseDate ?? "—"} · Retire
                    after {formatRetireAfter(item.retireAfterMonths)}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingId(item.id)
                        const years = retireMonthsToYears(
                          item.retireAfterMonths
                        )
                        setEditForm({
                          name: item.name,
                          manufacturer: item.manufacturer ?? "",
                          model: item.model,
                          notes: item.notes ?? "",
                          purchaseCost: item.purchaseCost ?? "",
                          replacementCost: item.replacementCost ?? "",
                          defaultPurchaseDate: item.defaultPurchaseDate ?? "",
                          retireAfterYears: years == null ? "" : String(years),
                        })
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setDeleteId(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog
        open={Boolean(editingId)}
        onOpenChange={(open) => {
          if (!open) setEditingId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit device model</DialogTitle>
            <DialogDescription>
              Update catalog details, costs, and retire-after defaults for
              assigned assets.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="edit-model-name">
              <Input
                id="edit-model-name"
                value={editForm.name}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Manufacturer" htmlFor="edit-model-mfr">
              <Input
                id="edit-model-mfr"
                value={editForm.manufacturer}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    manufacturer: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Model" htmlFor="edit-model-code">
              <Input
                id="edit-model-code"
                value={editForm.model}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Notes" htmlFor="edit-model-notes">
              <Textarea
                id="edit-model-notes"
                value={editForm.notes}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                rows={2}
              />
            </FormField>
            <FormField label="Purchase cost" htmlFor="edit-model-purchase">
              <Input
                id="edit-model-purchase"
                inputMode="decimal"
                value={editForm.purchaseCost}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    purchaseCost: event.target.value,
                  }))
                }
                placeholder="0.00"
              />
            </FormField>
            <FormField
              label="Replacement cost"
              htmlFor="edit-model-replacement"
            >
              <Input
                id="edit-model-replacement"
                inputMode="decimal"
                value={editForm.replacementCost}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    replacementCost: event.target.value,
                  }))
                }
                placeholder="0.00"
              />
            </FormField>
            <FormField
              label="Default purchase date"
              htmlFor="edit-model-purchase-date"
            >
              <Input
                id="edit-model-purchase-date"
                type="date"
                value={editForm.defaultPurchaseDate}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    defaultPurchaseDate: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField
              label="Retire after (years)"
              htmlFor="edit-model-retire-years"
            >
              <Input
                id="edit-model-retire-years"
                inputMode="decimal"
                value={editForm.retireAfterYears}
                onChange={(event) =>
                  setEditForm((current) => ({
                    ...current,
                    retireAfterYears: event.target.value,
                  }))
                }
                placeholder="7"
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                !editing ||
                !editForm.name.trim() ||
                !editForm.model.trim() ||
                updateModel.isPending
              }
              onClick={() => {
                if (!editingId) return
                void updateModel.mutateAsync({
                  id: editingId,
                  name: editForm.name,
                  manufacturer: editForm.manufacturer || null,
                  model: editForm.model,
                  notes: editForm.notes || null,
                  purchaseCost: costPayload(editForm.purchaseCost),
                  replacementCost: costPayload(editForm.replacementCost),
                  defaultPurchaseDate: editForm.defaultPurchaseDate || null,
                  retireAfterMonths: yearsPayload(editForm.retireAfterYears),
                })
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
