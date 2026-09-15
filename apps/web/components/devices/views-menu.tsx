"use client"

import * as React from "react"
import {
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/dashboard/form-field"
import {
  viewStatesEqual,
  type SavedView,
  type TableViewState,
} from "@/lib/table-view-state"
import { useSavedViews } from "@/lib/use-table-view"

export function ViewsMenu({
  storageKey,
  builtIns,
  current,
  onApply,
}: {
  storageKey: string
  builtIns: SavedView[]
  current: TableViewState
  onApply: (state: TableViewState) => void
}) {
  const { views, save, remove } = useSavedViews(storageKey, builtIns)
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [name, setName] = React.useState("")

  const active = views.find((view) => viewStatesEqual(view.state, current))
  const custom = views.filter((view) => !view.builtIn)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5">
            <BookmarkIcon className="size-4" />
            <span className="max-w-32 truncate">
              {active ? active.name : "Custom view"}
            </span>
            <ChevronDownIcon className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Views</DropdownMenuLabel>
          {builtIns.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onSelect={() => onApply(view.state)}
              className="justify-between"
            >
              {view.name}
              {active?.id === view.id ? <CheckIcon className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
          {custom.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Saved by you</DropdownMenuLabel>
              {custom.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  onSelect={() => onApply(view.state)}
                  className="group justify-between gap-2"
                >
                  <span className="truncate">{view.name}</span>
                  <span className="flex items-center gap-1">
                    {active?.id === view.id ? (
                      <CheckIcon className="size-4" />
                    ) : null}
                    <button
                      type="button"
                      className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                      aria-label={`Delete view ${view.name}`}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        remove(view.id)
                        toast.success("View deleted")
                      }}
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setName("")
              setSaveOpen(true)
            }}
          >
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              const saved = save(name, current)
              if (saved) {
                toast.success(`Saved view "${saved.name}"`)
                setSaveOpen(false)
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Save this view</DialogTitle>
              <DialogDescription>
                Keeps the current filters, sorting, search, and columns so you
                can come back to them in one click.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Name" htmlFor="view-name">
              <Input
                id="view-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Seattle offline"
                maxLength={60}
                autoFocus
                required
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSaveOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
