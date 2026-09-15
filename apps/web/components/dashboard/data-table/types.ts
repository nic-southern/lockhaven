import type { RowData } from "@tanstack/react-table"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Human label used by the column visibility menu. */
    label?: string
    /** Extra classes applied to both the header and body cells. */
    className?: string
    /** Right-align numeric columns. */
    align?: "left" | "right"
  }
}

export type DataTableFacet = {
  columnId: string
  title: string
  options: {
    label: string
    value: string
    count?: number
    icon?: React.ComponentType<{ className?: string }>
  }[]
}
