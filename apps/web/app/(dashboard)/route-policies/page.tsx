"use client"

import * as React from "react"
import { toast } from "sonner"
import { GitCompareArrowsIcon, PlusIcon } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/dashboard/data-table"
import { DetailSheet } from "@/components/dashboard/detail-sheet"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import {
  DEVICES_DEFAULT_VIEW,
  DevicesTable,
} from "@/components/devices/devices-table"
import { DefinitionList } from "@/components/devices/detail/definition-list"
import { AllocationMap } from "@/components/route-policies/allocation-map"
import { ComparePoliciesDialog } from "@/components/route-policies/compare-dialog"
import { DeletePolicyDialog } from "@/components/route-policies/delete-policy-dialog"
import {
  PolicyBadge,
  RouteChip,
  RouteChipList,
} from "@/components/route-policies/policy-chip"
import {
  PolicyDialog,
  type RoutePolicyRecord,
} from "@/components/route-policies/policy-dialog"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import type { TableViewState } from "@/lib/table-view-state"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

export default function RoutePoliciesPage() {
  const utils = trpc.useUtils()
  const { can } = usePermissions()
  const canManage = can("organization:admin")

  const organizationsQuery = trpc.organizations.list.useQuery()
  const policiesQuery = trpc.routePolicies.list.useQuery()

  const policies = React.useMemo(
    () => policiesQuery.data ?? [],
    [policiesQuery.data]
  )
  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false)
  const [editorState, setEditorState] = React.useState<{
    open: boolean
    policy: RoutePolicyRecord | null
  }>({ open: false, policy: null })
  const [compareState, setCompareState] = React.useState<{
    open: boolean
    a: string | null
  }>({ open: false, a: null })
  const [deleteTarget, setDeleteTarget] =
    React.useState<RoutePolicyRecord | null>(null)
  const [devicesView, setDevicesView] =
    React.useState<TableViewState>(DEVICES_DEFAULT_VIEW)

  const selected =
    policies.find((policy) => policy.id === selectedId) ??
    (selectedId === null ? policies[0] : undefined) ??
    null

  const setDefaultMutation = trpc.routePolicies.setDefault.useMutation({
    async onSuccess(result) {
      await utils.routePolicies.list.invalidate()
      toast.success(
        result.isDefault ? "Default policy updated" : "Default cleared"
      )
    },
    onError(error) {
      toast.error(error.message || "We couldn't update the default policy.")
    },
  })

  const openPolicy = React.useCallback((id: string) => {
    setSelectedId(id)
    setMobileDetailOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<RoutePolicyRecord>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "Name" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Name" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <PolicyBadge
              name={row.original.name}
              color={row.original.color}
              isDefault={row.original.isDefault}
            />
            {row.original.description ? (
              <span className="line-clamp-1 max-w-xs text-xs text-muted-foreground">
                {row.original.description}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "organizationName",
        accessorFn: (row) => row.organizationName ?? "Shared",
        meta: { label: "Organization" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Organization" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.organizationName ?? "Shared"}
          </span>
        ),
      },
      {
        id: "routes",
        accessorFn: (row) =>
          row.entries
            .map((entry) => `${entry.cidr} ${entry.label ?? ""}`)
            .join(" "),
        enableSorting: false,
        meta: { label: "Routes" },
        header: "Routes",
        cell: ({ row }) => (
          <RouteChipList
            entries={row.original.entries}
            max={3}
            className="max-w-md"
          />
        ),
      },
      {
        accessorKey: "deviceCount",
        meta: { label: "Devices", align: "right" },
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Devices"
            align="right"
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.deviceCount}</span>
        ),
      },
      {
        accessorKey: "tokenCount",
        meta: { label: "Tokens", align: "right" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tokens" align="right" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.tokenCount}</span>
        ),
      },
      {
        accessorKey: "updatedAt",
        meta: { label: "Updated" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Updated" />
        ),
        cell: ({ row }) => (
          <span
            className="text-muted-foreground"
            title={formatDate(row.original.updatedAt)}
          >
            {formatRelativeTime(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12" },
        cell: ({ row }) => (
          <DataTableRowActions
            label={row.original.name}
            actions={[
              {
                label: "View policy",
                onSelect: () => openPolicy(row.original.id),
              },
              {
                label: "Compare with…",
                onSelect: () =>
                  setCompareState({ open: true, a: row.original.id }),
              },
              ...(canManage
                ? [
                    {
                      label: "Edit policy",
                      onSelect: () =>
                        setEditorState({ open: true, policy: row.original }),
                    },
                    {
                      label: row.original.isDefault
                        ? "Clear default"
                        : "Make default",
                      onSelect: () =>
                        setDefaultMutation.mutate({
                          id: row.original.id,
                          isDefault: !row.original.isDefault,
                        }),
                    },
                    {
                      label: "Remove policy",
                      destructive: true,
                      separatorBefore: true,
                      onSelect: () => setDeleteTarget(row.original),
                    },
                  ]
                : []),
            ]}
          />
        ),
      },
    ],
    [canManage, openPolicy, setDefaultMutation]
  )

  const organizationOptions = React.useMemo(() => {
    const names = new Set<string>(
      policies.map((policy) => policy.organizationName ?? "Shared")
    )
    return [...names].sort().map((name) => ({ value: name, label: name }))
  }, [policies])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Route policies"
        title="Allowed routes"
        description="Named sets of networks a device can reach once it joins the tunnel. Assign them to enrollment tokens and devices."
        actions={
          <>
            <Button
              variant="outline"
              disabled={policies.length < 2}
              onClick={() =>
                setCompareState({ open: true, a: selected?.id ?? null })
              }
            >
              <GitCompareArrowsIcon className="size-4" />
              Compare
            </Button>
            {canManage ? (
              <Button
                onClick={() => setEditorState({ open: true, policy: null })}
                disabled={organizations.length === 0}
              >
                <PlusIcon className="size-4" />
                New policy
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Policies</CardTitle>
          <CardDescription>
            Pick a policy to see its routes and the devices using it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={policies}
            isLoading={policiesQuery.isLoading}
            getRowId={(row) => row.id}
            searchPlaceholder="Search policies or routes"
            facets={[
              {
                columnId: "organizationName",
                title: "Organization",
                options: organizationOptions,
              },
            ]}
            initialSorting={[{ id: "name", desc: false }]}
            onRowClick={(row) => openPolicy(row.id)}
            isRowActive={(row) => row.id === selected?.id}
            emptyTitle="No route policies yet"
            emptyDescription={
              canManage
                ? "Create a policy to control what a device can reach."
                : "Policies will appear here once an administrator creates one."
            }
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        {selected ? (
          <DetailSheet
            open={mobileDetailOpen}
            onOpenChange={setMobileDetailOpen}
            title={selected.name}
            description={
              selected.description ??
              "Networks published to devices on this policy."
            }
            contentClassName="gap-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <PolicyBadge
                name={selected.organizationName ?? "Shared"}
                color={selected.color}
              />
              {selected.isDefault ? (
                <Badge variant="secondary">Default</Badge>
              ) : null}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCompareState({ open: true, a: selected.id })
                  }
                  disabled={policies.length < 2}
                >
                  Compare
                </Button>
                {canManage ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDefaultMutation.mutate({
                          id: selected.id,
                          isDefault: !selected.isDefault,
                        })
                      }
                      disabled={setDefaultMutation.isPending}
                    >
                      {selected.isDefault ? "Clear default" : "Make default"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        setEditorState({ open: true, policy: selected })
                      }
                    >
                      Edit
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            <DefinitionList
              columns={3}
              items={[
                {
                  label: "Routes",
                  value: (
                    <span className="tabular-nums">
                      {selected.entries.length}
                    </span>
                  ),
                },
                {
                  label: "Devices",
                  value: (
                    <span className="tabular-nums">{selected.deviceCount}</span>
                  ),
                },
                {
                  label: "Active tokens",
                  value: (
                    <span className="tabular-nums">{selected.tokenCount}</span>
                  ),
                },
              ]}
            />

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Published routes
              </p>
              {selected.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This policy doesn&apos;t publish any routes.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {selected.entries.map((entry) => (
                    <li key={entry.cidr}>
                      <RouteChip entry={entry} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Devices on this policy
              </p>
              <DevicesTable
                key={selected.id}
                variant="compact"
                pageSize={10}
                view={devicesView}
                onViewChange={(patch) =>
                  setDevicesView((current) => ({ ...current, ...patch }))
                }
                fixedFilters={{ routePolicyId: [selected.id] }}
              />
            </div>

            {canManage ? (
              <div className="flex justify-end border-t pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(selected)}
                >
                  Remove policy
                </Button>
              </div>
            ) : null}
          </DetailSheet>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Policy details</CardTitle>
              <CardDescription>
                Select a policy to see its routes and assigned devices.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <SectionCard
          title="Site allocation"
          description="Which policy each site's devices are on."
          collapsibleOnMobile
        >
          <AllocationMap
            policies={policies}
            activePolicyId={selected?.id}
            onSelectPolicy={openPolicy}
          />
        </SectionCard>
      </div>

      <PolicyDialog
        open={editorState.open}
        onOpenChange={(open) =>
          setEditorState((current) => ({ ...current, open }))
        }
        policy={editorState.policy}
        organizations={organizations}
        defaultOrganizationId={
          selected?.organizationId ?? organizations[0]?.id ?? ""
        }
        onSaved={(saved) => setSelectedId(saved.id)}
      />

      <ComparePoliciesDialog
        open={compareState.open}
        onOpenChange={(open) =>
          setCompareState((current) => ({ ...current, open }))
        }
        policies={policies}
        initialA={compareState.a}
      />

      <DeletePolicyDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        policy={deleteTarget}
        policies={policies}
        onDeleted={() => {
          if (deleteTarget?.id === selectedId) setSelectedId(null)
        }}
      />
    </div>
  )
}
