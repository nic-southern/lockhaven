import * as React from "react"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

export function FormField({
  label,
  htmlFor,
  description,
  error,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  description?: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Field
      data-invalid={error ? true : undefined}
      className={cn("gap-2", className)}
    >
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export function NativeSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}
