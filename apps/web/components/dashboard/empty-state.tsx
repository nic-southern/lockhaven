import { InboxIcon } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"

export function EmptyState({
  title,
  description,
  action,
  className,
  bordered = true,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  bordered?: boolean
}) {
  return (
    <Empty
      className={cn(
        "min-h-40 py-10",
        bordered && "border border-dashed",
        className
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
