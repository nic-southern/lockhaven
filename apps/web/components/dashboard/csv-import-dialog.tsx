"use client"

import * as React from "react"
import { toast } from "sonner"
import { UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"
import { downloadTextFile } from "@/lib/devices"

export type CsvImportResult = {
  created: number
  updated: number
  skipped: number
  errors: Array<{ row: number; message: string }>
}

export function CsvImportDialog({
  open,
  onOpenChange,
  title,
  description,
  templateName,
  templateCsv,
  organizations,
  organizationId,
  onOrganizationIdChange,
  onImport,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  templateName: string
  templateCsv: string
  organizations?: Array<{ id: string; name: string }>
  organizationId?: string
  onOrganizationIdChange?: (value: string) => void
  onImport: (csv: string) => Promise<CsvImportResult>
  pending?: boolean
}) {
  const [csv, setCsv] = React.useState("")

  async function submit() {
    if (!csv.trim()) {
      toast.error("Paste a spreadsheet or choose a file first.")
      return
    }
    try {
      const result = await onImport(csv)
      const parts = [
        result.created ? `${result.created} added` : null,
        result.updated ? `${result.updated} updated` : null,
        result.skipped ? `${result.skipped} skipped` : null,
      ].filter(Boolean)
      if (result.errors[0]) {
        toast.message(parts.join(" · ") || "Import finished", {
          description: `Row ${result.errors[0].row}: ${result.errors[0].message}`,
        })
      } else {
        toast.success(parts.join(" · ") || "Import finished")
      }
      setCsv("")
      onOpenChange(false)
    } catch {
      toast.error("We couldn't import that file.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {organizations && onOrganizationIdChange ? (
            <FormField label="Organization" htmlFor="csv-import-org">
              <SelectField
                id="csv-import-org"
                value={organizationId ?? ""}
                onValueChange={onOrganizationIdChange}
                placeholder="Choose an organization"
                options={organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
              />
            </FormField>
          ) : null}
          <FormField label="Rows" htmlFor="csv-import-body">
            <Textarea
              id="csv-import-body"
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              className="min-h-40 font-mono text-xs"
              placeholder="Paste rows here"
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadTextFile(templateName, templateCsv)}
            >
              Download template
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <UploadIcon className="size-3.5" />
                Choose file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => {
                      setCsv(String(reader.result ?? ""))
                    }
                    reader.readAsText(file)
                    event.target.value = ""
                  }}
                />
              </label>
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={pending || !csv.trim()}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
