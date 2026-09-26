"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import {
  ticketPriorities,
  ticketPriorityLabels,
  type TicketPriority,
} from "@nms/shared"

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
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SelectField } from "@/components/dashboard/select-field"
import { TicketsTable } from "@/components/tickets/tickets-table"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

function ticketErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "We couldn't create that ticket. Try again in a moment."
}

export default function TicketsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <TicketsContent />
    </React.Suspense>
  )
}

function TicketsContent() {
  const { can } = usePermissions()
  const canCreate = can("device:update")
  const [createOpen, setCreateOpen] = React.useState(false)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Tickets"
        title="Tickets"
        description="Track work against sites, devices, and alerts without leaving the console."
        actions={
          canCreate ? (
            <Button
              className="w-full sm:w-auto"
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon />
              New ticket
            </Button>
          ) : null
        }
      />
      <TicketsTable />
      <CreateTicketDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function CreateTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: open,
  })
  const organizations = organizationsQuery.data ?? []
  const [organizationId, setOrganizationId] = React.useState("")
  const [siteId, setSiteId] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [priority, setPriority] = React.useState<TicketPriority>("medium")
  const [body, setBody] = React.useState("")
  const createTicket = trpc.tickets.create.useMutation()

  const selectedOrgId =
    organizationId ||
    (organizations.length === 1 ? (organizations[0]?.id ?? "") : "")

  const sitesQuery = trpc.sites.list.useQuery(undefined, {
    enabled: open,
  })
  const sites = (sitesQuery.data ?? []).filter(
    (site) => site.organizationId === selectedOrgId
  )

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTitle("")
      setBody("")
      setPriority("medium")
      setSiteId("")
      setOrganizationId("")
    }
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedOrgId || title.trim().length === 0) return
    try {
      const result = await createTicket.mutateAsync({
        organizationId: selectedOrgId,
        siteId: siteId || null,
        title: title.trim(),
        priority,
        body: body.trim() || null,
      })
      await utils.tickets.page.invalidate()
      toast.success(result.created ? "Ticket created" : "Ticket already open")
      handleOpenChange(false)
      if (result.id) router.push(`/tickets/${result.id}`)
    } catch (error) {
      toast.error(ticketErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>
              Capture work for a site or organization. You can link a device or
              alert later.
            </DialogDescription>
          </DialogHeader>
          {organizations.length > 1 ? (
            <FormField label="Organization" htmlFor="ticket-org">
              <SelectField
                id="ticket-org"
                value={selectedOrgId}
                onValueChange={(value) => {
                  setOrganizationId(value)
                  setSiteId("")
                }}
                placeholder="Choose an organization"
                options={organizations.map((org) => ({
                  value: org.id,
                  label: org.name,
                }))}
              />
            </FormField>
          ) : null}
          <FormField label="Site" htmlFor="ticket-site">
            <SelectField
              id="ticket-site"
              value={siteId}
              onValueChange={setSiteId}
              placeholder="Optional site"
              emptyLabel="No site"
              disabled={!selectedOrgId}
              options={sites.map((site) => ({
                value: site.id,
                label: site.name,
              }))}
            />
          </FormField>
          <FormField label="Summary" htmlFor="ticket-title">
            <Input
              id="ticket-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={240}
            />
          </FormField>
          <FormField label="Priority" htmlFor="ticket-priority">
            <SelectField
              id="ticket-priority"
              value={priority}
              onValueChange={(value) => setPriority(value as TicketPriority)}
              options={ticketPriorities.map((value) => ({
                value,
                label: ticketPriorityLabels[value],
              }))}
            />
          </FormField>
          <FormField label="Notes" htmlFor="ticket-body">
            <Textarea
              id="ticket-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={8000}
              rows={4}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createTicket.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createTicket.isPending ||
                !selectedOrgId ||
                title.trim().length === 0
              }
            >
              {createTicket.isPending ? "Creating…" : "Create ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
