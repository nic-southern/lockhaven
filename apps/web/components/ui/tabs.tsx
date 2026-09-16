"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** Tracks which edges of a horizontal scroller still have content beyond them. */
function useScrollEdges(ref: React.RefObject<HTMLElement | null>) {
  const [edges, setEdges] = React.useState({ start: false, end: false })

  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => {
      const start = node.scrollLeft > 1
      const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
      setEdges((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end }
      )
    }
    update()
    node.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(node)
    for (const child of node.children) observer.observe(child)
    return () => {
      node.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [ref])

  return edges
}

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollerRef)

  return (
    // Long tab strips swipe horizontally instead of widening the page. The
    // bottom padding/negative margin pair keeps the line variant's underline,
    // which hangs below the list, out of the clipped region.
    <div
      ref={scrollerRef}
      data-slot="tabs-list-scroller"
      data-scroll-start={edges.start || undefined}
      data-scroll-end={edges.end || undefined}
      className={cn(
        "-mb-1.5 scrollbar-none max-w-full overflow-x-auto overflow-y-hidden pb-1.5 group-data-vertical/tabs:overflow-visible",
        "data-[scroll-end]:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]",
        "data-[scroll-start]:[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]",
        "data-[scroll-start]:data-[scroll-end]:[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]"
      )}
    >
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </div>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
