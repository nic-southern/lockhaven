"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PrinterIcon } from "lucide-react"

import {
  assetStatusLabels,
  suggestAssetTrackingTag,
  type AssetStatus,
} from "@nms/shared"

import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

import { DefinitionList } from "./definition-list"
import { type DeviceDetail, useInvalidateDevice } from "./shared"

export function AssetsTab({ device }: { device: DeviceDetail }) {
  const { can } = usePermissions()
  const canUpdate = can("device:update")
  const invalidate = useInvalidateDevice(device.id)
  const utils = trpc.useUtils()

  const assetQuery = trpc.assets.byId.useQuery(
    { id: device.assetId! },
    { enabled: Boolean(device.assetId) }
  )
  const modelsQuery = trpc.deviceModels.list.useQuery(
    { organizationId: device.organizationId },
    { enabled: canUpdate || Boolean(device.assetId) }
  )

  const [creating, setCreating] = React.useState(false)
  const [tag, setTag] = React.useState(() =>
    suggestAssetTrackingTag({
      deviceId: device.id,
      hostname: device.hostname,
      serialNumber: device.serialNumber,
    })
  )
  const [deviceModelId, setDeviceModelId] = React.useState("")
  const [serial, setSerial] = React.useState(device.serialNumber ?? "")
  const [hostname, setHostname] = React.useState(device.hostname ?? "")

  React.useEffect(() => {
    if (!device.assetId) {
      setTag(
        suggestAssetTrackingTag({
          deviceId: device.id,
          hostname: device.hostname,
          serialNumber: device.serialNumber,
        })
      )
      setSerial(device.serialNumber ?? "")
      setHostname(device.hostname ?? "")
    }
  }, [device.assetId, device.id, device.hostname, device.serialNumber])

  const createAsset = trpc.assets.create.useMutation()
  const linkDevice = trpc.assets.linkDevice.useMutation()
  const updateAsset = trpc.assets.update.useMutation({
    async onSuccess() {
      await Promise.all([
        invalidate(),
        utils.assets.byId.invalidate({ id: device.assetId! }),
        utils.assets.page.invalidate(),
      ])
      toast.success("Asset updated")
    },
    onError(error) {
      toast.error(error.message || "We couldn't update the asset.")
    },
  })

  async function handleCreate() {
    setCreating(true)
    try {
      const created = await createAsset.mutateAsync({
        organizationId: device.organizationId,
        siteId: device.siteId,
        deviceModelId: deviceModelId || null,
        tag: tag.trim(),
        serial: serial.trim() || null,
        hostname: hostname.trim() || null,
        status: "in_service" satisfies AssetStatus,
      })
      await linkDevice.mutateAsync({ id: created.id, deviceId: device.id })
      await Promise.all([
        invalidate(),
        utils.assets.page.invalidate(),
        utils.assets.byId.invalidate({ id: created.id }),
      ])
      toast.success("Asset created and linked")
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "We couldn't create the asset."
      toast.error(message)
    } finally {
      setCreating(false)
    }
  }

  if (device.assetId && assetQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  const asset = assetQuery.data
  if (device.assetId && asset) {
    return (
      <div className="flex flex-col gap-6">
        <SectionCard
          title="Linked asset"
          description="Tracking tag and identity for this device."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href={`/assets/labels?ids=${asset.id}`}>
                  <PrinterIcon />
                  Print label
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/assets?id=${asset.id}`}>Open in Assets</Link>
              </Button>
            </div>
          }
        >
          <DefinitionList
            items={[
              {
                label: "Tracking tag",
                value: <span className="font-mono text-sm">{asset.tag}</span>,
              },
              {
                label: "Status",
                value: (
                  <Badge variant="secondary">
                    {assetStatusLabels[asset.status]}
                  </Badge>
                ),
              },
              {
                label: "Device model",
                value: asset.deviceModelName
                  ? asset.deviceModelManufacturer
                    ? `${asset.deviceModelName} · ${asset.deviceModelManufacturer} ${asset.deviceModelCode}`
                    : `${asset.deviceModelName} · ${asset.deviceModelCode}`
                  : "Not assigned",
              },
              {
                label: "Serial",
                value: asset.serial,
                mono: true,
              },
              {
                label: "Host name",
                value: asset.hostname,
                mono: true,
              },
            ]}
          />
        </SectionCard>

        {canUpdate ? (
          <SectionCard
            title="Assign device model"
            description="Pick a catalog model for this asset."
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <FormField
                label="Device model"
                htmlFor="device-asset-model"
                className="min-w-0 flex-1"
              >
                <SelectField
                  id="device-asset-model"
                  value={asset.deviceModelId ?? ""}
                  onValueChange={(value) =>
                    void updateAsset.mutateAsync({
                      id: asset.id,
                      deviceModelId: value || null,
                    })
                  }
                  placeholder="Choose a model"
                  emptyLabel="Not assigned"
                  options={(modelsQuery.data ?? []).map((model) => ({
                    value: model.id,
                    label: model.label,
                  }))}
                />
              </FormField>
              <Button variant="outline" asChild>
                <Link href="/settings/device-models">Manage models</Link>
              </Button>
            </div>
          </SectionCard>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <EmptyState
        title="No asset linked"
        description="Create an asset now, or wait for the next check-in to fill one from this device."
        bordered={false}
      />
      {canUpdate ? (
        <SectionCard
          title="Create asset"
          description="Uses a short tracking tag for labels. Serial is optional."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Tracking tag" htmlFor="create-asset-tag">
              <Input
                id="create-asset-tag"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                className="font-mono"
              />
            </FormField>
            <FormField label="Device model" htmlFor="create-asset-model">
              <SelectField
                id="create-asset-model"
                value={deviceModelId}
                onValueChange={setDeviceModelId}
                placeholder="Choose a model"
                emptyLabel="Not assigned"
                options={(modelsQuery.data ?? []).map((model) => ({
                  value: model.id,
                  label: model.label,
                }))}
              />
            </FormField>
            <FormField label="Serial" htmlFor="create-asset-serial">
              <Input
                id="create-asset-serial"
                value={serial}
                onChange={(event) => setSerial(event.target.value)}
                className="font-mono"
              />
            </FormField>
            <FormField label="Host name" htmlFor="create-asset-hostname">
              <Input
                id="create-asset-hostname"
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
              />
            </FormField>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={!tag.trim() || creating || createAsset.isPending}
              onClick={() => void handleCreate()}
            >
              Create and link
            </Button>
            <Button variant="outline" asChild>
              <Link href="/settings/device-models">Manage models</Link>
            </Button>
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}
