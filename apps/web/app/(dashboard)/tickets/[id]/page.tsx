"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"
import { toast } from "sonner"

import {
  ticketPriorities,
  ticketPriorityLabels,
  ticketStatuses,
  ticketStatusLabels,
  type TicketPriority,
  type TicketStatus,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SelectField } from "@/components/dashboard/select-field"
import {
  TicketPriorityBadge,
  TicketStatusBadge,
} from "@/components/tickets/tickets-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type TicketDetail = RouterOutputs["tickets"]["byId"]

function ticketErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "We couldn't update that ticket. Try again in a moment."
}

export default function TicketDetailPage() {
  return (
    <React.Suspense fallback={<TicketDetailSkeleton />}>
      <TicketDetail />
    </React.Suspense>
  )
}

function TicketDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function TicketDetail() {
  const params = useParams<{ id: string }>()
  const { can, isLoading: permissionsLoading } = usePermissions()
  const canView = can("device:view")
  const canAct = can("device:update")
  const ticketId = params.id

  const ticketQuery = trpc.tickets.byId.useQuery(
    { id: ticketId },
    { enabled: canView && Boolean(ticketId), refetchInterval: 30_000 }
  )

  if (permissionsLoading) {
    return <TicketDetailSkeleton />
  }
  if (!canView) {
    return <AccessDenied />
  }
  if (ticketQuery.isLoading) {
    return <TicketDetailSkeleton />
  }
  if (ticketQuery.isError || !ticketQuery.data) {
    return (
      <EmptyState
        title="Ticket not found"
        description="It may have been removed, or you may not have access."
        action={
          <Button variant="outline" asChild>
            <Link href="/tickets">Back to tickets</Link>
          </Button>
        }
      />
    )
  }

  return (
    <TicketEditor
      key={ticketQuery.data.id}
      ticket={ticketQuery.data}
      canAct={canAct}
    />
  )
}

function TicketEditor({
  ticket,
  canAct,
}: {
  ticket: TicketDetail
  canAct: boolean
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const updateTicket = trpc.tickets.update.useMutation()
  const addComment = trpc.tickets.addComment.useMutation()

  const [title, setTitle] = React.useState(ticket.title)
  const [status, setStatus] = React.useState(ticket.status as TicketStatus)
  const [priority, setPriority] = React.useState(
    ticket.priority as TicketPriority
  )
  const [body, setBody] = React.useState(ticket.body ?? "")
  const [comment, setComment] = React.useState("")

  async function save() {
    try {
      await updateTicket.mutateAsync({
        id: ticket.id,
        title: title.trim(),
        status,
        priority,
        body: body.trim() || null,
      })
      await utils.tickets.byId.invalidate({ id: ticket.id })
      await utils.tickets.page.invalidate()
      toast.success("Ticket updated")
    } catch (error) {
      toast.error(ticketErrorMessage(error))
    }
  }

  async function submitComment(event: React.FormEvent) {
    event.preventDefault()
    if (!comment.trim()) return
    try {
      await addComment.mutateAsync({
        ticketId: ticket.id,
        body: comment.trim(),
      })
      setComment("")
      await utils.tickets.byId.invalidate({ id: ticket.id })
      toast.success("Comment added")
    } catch (error) {
      toast.error(ticketErrorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Tickets"
        title={ticket.title}
        description={[
          ticket.organizationName,
          ticket.siteName,
          ticket.deviceName,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Button variant="outline" className="w-full sm:w-auto" asChild>
            <Link href="/tickets">
              <ArrowLeftIcon />
              All tickets
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <section className="flex flex-col gap-5 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
            {ticket.alertId ? (
              <Badge variant="outline">Linked alert</Badge>
            ) : null}
          </div>

          {canAct ? (
            <>
              <FormField label="Summary" htmlFor="ticket-detail-title">
                <Input
                  id="ticket-detail-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={240}
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Status" htmlFor="ticket-detail-status">
                  <SelectField
                    id="ticket-detail-status"
                    value={status}
                    onValueChange={(value) => setStatus(value as TicketStatus)}
                    options={ticketStatuses.map((value) => ({
                      value,
                      label: ticketStatusLabels[value],
                    }))}
                  />
                </FormField>
                <FormField label="Priority" htmlFor="ticket-detail-priority">
                  <SelectField
                    id="ticket-detail-priority"
                    value={priority}
                    onValueChange={(value) =>
                      setPriority(value as TicketPriority)
                    }
                    options={ticketPriorities.map((value) => ({
                      value,
                      label: ticketPriorityLabels[value],
                    }))}
                  />
                </FormField>
              </div>
              <FormField label="Notes" htmlFor="ticket-detail-body">
                <Textarea
                  id="ticket-detail-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={5}
                  maxLength={8000}
                />
              </FormField>
              <div className="flex justify-end">
                <Button
                  onClick={() => void save()}
                  disabled={updateTicket.isPending || title.trim().length === 0}
                >
                  {updateTicket.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap text-muted-foreground">
                {ticket.body || "No notes yet."}
              </p>
            </div>
          )}

          <div className="border-t pt-5">
            <h2 className="mb-3 text-sm font-medium">Activity</h2>
            {canAct ? (
              <form
                className="mb-4 flex flex-col gap-3"
                onSubmit={submitComment}
              >
                <Textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Add a comment"
                  rows={3}
                  maxLength={8000}
                />
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={
                      addComment.isPending || comment.trim().length === 0
                    }
                  >
                    {addComment.isPending ? "Adding…" : "Add comment"}
                  </Button>
                </div>
              </form>
            ) : null}
            {ticket.comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {ticket.comments.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-lg border bg-background/60 p-3 text-sm"
                  >
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {entry.authorName || entry.authorEmail || "Someone"}
                      </span>
                      <span>{formatRelativeTime(entry.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{entry.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-sm">
          <h2 className="text-sm font-medium">Links</h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Organization</dt>
            <dd>{ticket.organizationName}</dd>
            <dt className="text-muted-foreground">Site</dt>
            <dd>
              {ticket.siteId ? (
                <Link
                  href={`/sites?f.id=${ticket.siteId}`}
                  className="hover:underline"
                >
                  {ticket.siteName || "Site"}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-muted-foreground">Device</dt>
            <dd>
              {ticket.deviceId ? (
                <Link
                  href={`/devices/${ticket.deviceId}`}
                  className="hover:underline"
                >
                  {ticket.deviceName || "Device"}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-muted-foreground">Alert</dt>
            <dd>
              {ticket.alertId ? (
                <Link
                  href={`/alerts?f.id=${ticket.alertId}`}
                  className="hover:underline"
                >
                  {ticket.alertTitle || "Linked alert"}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDate(ticket.createdAt)}</dd>
            <dt className="text-muted-foreground">Updated</dt>
            <dd>{formatRelativeTime(ticket.updatedAt)}</dd>
            {ticket.resolvedAt ? (
              <>
                <dt className="text-muted-foreground">Done</dt>
                <dd>{formatDate(ticket.resolvedAt)}</dd>
              </>
            ) : null}
          </dl>
          {ticket.status !== "done" && canAct ? (
            <Button
              variant="outline"
              onClick={() => {
                setStatus("done")
                void updateTicket
                  .mutateAsync({ id: ticket.id, status: "done" })
                  .then(async () => {
                    await utils.tickets.byId.invalidate({ id: ticket.id })
                    await utils.tickets.page.invalidate()
                    toast.success("Ticket marked done")
                    router.refresh()
                  })
                  .catch((error) => toast.error(ticketErrorMessage(error)))
              }}
              disabled={updateTicket.isPending}
            >
              Mark done
            </Button>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
