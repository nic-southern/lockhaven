"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const EMPTY_VALUE = "__empty__"

export type SelectOption = {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

/**
 * Single-select control backed by the shared Select primitive. Supports an
 * optional empty choice because the primitive itself rejects empty values.
 */
export function SelectField({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Choose an option",
  emptyLabel,
  disabled,
  className,
  size = "default",
  "aria-label": ariaLabel,
}: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  /** When provided, renders a selectable option that maps to "". */
  emptyLabel?: string
  disabled?: boolean
  className?: string
  size?: "sm" | "default"
  "aria-label"?: string
}) {
  const hasEmpty = typeof emptyLabel === "string"
  const resolvedValue = value === "" ? (hasEmpty ? EMPTY_VALUE : "") : value

  return (
    <Select
      value={resolvedValue}
      onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={cn("w-full bg-card/80", className)}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {hasEmpty ? (
          <SelectItem value={EMPTY_VALUE}>{emptyLabel}</SelectItem>
        ) : null}
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
