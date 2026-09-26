"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import { ArrowLeftIcon, PrinterIcon } from "lucide-react"

import { assetLabelQrPayload } from "@nms/shared"

import { EmptyState } from "@/components/dashboard/empty-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

function parseIds(raw: string | null) {
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^[0-9a-f-]{36}$/i.test(value))
    ),
  ].slice(0, 50)
}

function AssetLabelCard({
  tag,
  serial,
}: {
  tag: string
  serial: string | null
}) {
  const payload = assetLabelQrPayload({ tag, serial })
  return (
    <div className="asset-label break-inside-avoid rounded-md border border-black bg-white p-4 text-black">
      <div className="flex items-center gap-4">
        <QRCodeSVG value={payload} size={112} level="M" marginSize={0} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs tracking-wide text-neutral-600 uppercase">
            Tracking tag
          </p>
          <p className="font-mono text-xl font-semibold tracking-tight">
            {tag}
          </p>
          {serial ? (
            <>
              <p className="mt-2 text-xs tracking-wide text-neutral-600 uppercase">
                Serial
              </p>
              <p className="font-mono text-sm break-all">{serial}</p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function LabelsBody() {
  const searchParams = useSearchParams()
  const ids = React.useMemo(
    () => parseIds(searchParams.get("ids")),
    [searchParams]
  )
  const { can, isLoading } = usePermissions()
  const canView = can("device:view")

  const pageQuery = trpc.assets.page.useQuery(
    {
      limit: 100,
      filters: ids.length > 0 ? { id: ids } : undefined,
    },
    { enabled: canView && ids.length > 0 }
  )

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />
  }
  if (!canView) {
    return (
      <EmptyState
        title="No access"
        description="You need permission to view assets."
      />
    )
  }
  if (ids.length === 0) {
    return (
      <EmptyState
        title="No assets selected"
        description="Open labels from an asset to print its tracking tag."
        action={
          <Button asChild>
            <Link href="/assets">Back to assets</Link>
          </Button>
        }
      />
    )
  }

  const items = (pageQuery.data?.items ?? []).filter((item) =>
    ids.includes(item.id)
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
            <Link href="/assets">
              <ArrowLeftIcon />
              Assets
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            Asset labels
          </h1>
          <p className="text-sm text-muted-foreground">
            The QR holds the tracking tag
            {items.some((item) => item.serial) ? " and serial" : ""} as plain
            text. The same values are printed beside it.
          </p>
        </div>
        <Button onClick={() => window.print()}>
          <PrinterIcon />
          Print
        </Button>
      </div>

      {pageQuery.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Assets not found"
          description="Those records may have been removed, or you may not have access."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2">
          {items.map((item) => (
            <AssetLabelCard key={item.id} tag={item.tag} serial={item.serial} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function AssetLabelsPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <LabelsBody />
    </React.Suspense>
  )
}
