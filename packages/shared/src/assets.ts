import { z } from "zod"

import { hostnamesMatch, normalizeHostname } from "./domain"
import { MS_PER_DAY, utcDayStart } from "./reporting"

export const assetStatuses = [
  "stock",
  "in_service",
  "maintenance",
  "retired",
  "disposed",
] as const

export type AssetStatus = (typeof assetStatuses)[number]
export const assetStatusSchema = z.enum(assetStatuses)

export const assetStatusLabels: Record<AssetStatus, string> = {
  stock: "Stock",
  in_service: "In service",
  maintenance: "Maintenance",
  retired: "Retired",
  disposed: "Disposed",
}

export const customFieldTypes = [
  "text",
  "number",
  "date",
  "select",
  "boolean",
] as const
export type CustomFieldType = (typeof customFieldTypes)[number]
export const customFieldTypeSchema = z.enum(customFieldTypes)

export const customFieldTypeLabels: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "List",
  boolean: "Yes / no",
}

export const customFieldAppliesTo = ["device", "asset", "both"] as const
export type CustomFieldAppliesTo = (typeof customFieldAppliesTo)[number]
export const customFieldAppliesToSchema = z.enum(customFieldAppliesTo)

export const customFieldAppliesToLabels: Record<CustomFieldAppliesTo, string> =
  {
    device: "Devices",
    asset: "Assets",
    both: "Devices and assets",
  }

export const WARRANTY_EXPIRING_DAYS = 90

export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date.")

export const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time.")

export const siteContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(80).optional().nullable(),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .nullable()
    .or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
})

export type SiteContact = z.infer<typeof siteContactSchema>

const hoursWindowSchema = z.object({
  open: timeOfDaySchema,
  close: timeOfDaySchema,
})

export const siteHolidaySchema = z
  .object({
    date: isoDateSchema,
    name: z.string().trim().max(80).optional().nullable(),
    closed: z.boolean().optional(),
    open: timeOfDaySchema.optional(),
    close: timeOfDaySchema.optional(),
  })
  .refine(
    (holiday) =>
      Boolean(holiday.closed) ||
      Boolean(holiday.open && holiday.close) ||
      (!holiday.open && !holiday.close),
    { message: "Set closed all day or both open and close times." }
  )

export type SiteHoliday = z.infer<typeof siteHolidaySchema>

export const siteBusinessHoursSchema = z.object({
  weekdays: hoursWindowSchema.nullable().optional(),
  saturday: hoursWindowSchema.nullable().optional(),
  sunday: hoursWindowSchema.nullable().optional(),
  holidays: z.array(siteHolidaySchema).max(100).optional(),
})

export type SiteBusinessHours = z.infer<typeof siteBusinessHoursSchema>

export const customFieldKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "Use a short lowercase key.")

export const customFieldValuesSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .default({})

export type CustomFieldValues = z.infer<typeof customFieldValuesSchema>

export const customFieldDefinitionInputSchema = z.object({
  organizationId: z.string().uuid(),
  key: customFieldKeySchema,
  label: z.string().trim().min(1).max(80),
  fieldType: customFieldTypeSchema.default("text"),
  appliesTo: customFieldAppliesToSchema.default("both"),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
})

export type WarrantyState = "none" | "current" | "expiring" | "expired"

export type AssetMatchReason = "serial" | "hostname"

export type AssetMatchCandidate = {
  id: string
  serial: string | null
  hostname: string | null
  tag: string | null
}

export type CsvImportError = { row: number; message: string }

export type ParsedDeviceCsvRow = {
  row: number
  id: string | null
  serial: string | null
  hostname: string | null
  displayName: string | null
  tags: string[]
  site: string | null
  notes: string | null
  assetTag: string | null
}

export type ParsedSiteCsvRow = {
  row: number
  organization: string
  name: string
  timezone: string | null
  address: string | null
  notes: string | null
  contact: SiteContact | null
}

export type ParsedAssetCsvRow = {
  row: number
  tag: string
  vendor: string | null
  model: string | null
  serial: string | null
  hostname: string | null
  site: string | null
  status: AssetStatus
  purchaseDate: string | null
  purchaseCost: string | null
  warrantyExpiresOn: string | null
  notes: string | null
}

const DEVICE_CSV_ID_KEYS = ["id", "device_id"]
const DEVICE_CSV_SERIAL_KEYS = ["serial", "serial_number"]
const DEVICE_CSV_HOSTNAME_KEYS = ["hostname", "host_name", "host"]
const DEVICE_CSV_NAME_KEYS = ["display_name", "name"]
const DEVICE_CSV_TAGS_KEYS = ["tags"]
const DEVICE_CSV_SITE_KEYS = ["site", "site_name", "site_id"]
const DEVICE_CSV_NOTES_KEYS = ["notes"]
const DEVICE_CSV_ASSET_KEYS = ["asset_tag", "asset"]

/** Strip punctuation and case so serials from labels still match. */
export function normalizeSerial(value: string | null | undefined) {
  if (!value) return null
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "")
  return normalized.length > 0 ? normalized : null
}

/** Soft identity compare for manufacturer / model catalog matching. */
export function normalizeHardwareIdentity(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ")
  return normalized.length > 0 ? normalized : null
}

function blankToNull(value: string | null | undefined) {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isBlank(value: string | null | undefined) {
  return blankToNull(value) === null
}

/**
 * Short org-unique tracking tag for tape labels. Crockford base32, no
 * ambiguous characters. Prefer this over SMBIOS serials on handheld printers.
 */
const TRACKING_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function generateTrackingTag(seed: string, length = 6): string {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  let value = hash >>> 0
  let body = ""
  for (let index = 0; index < length; index += 1) {
    body += TRACKING_ALPHABET[value % TRACKING_ALPHABET.length]
    value = Math.floor(value / TRACKING_ALPHABET.length)
    if (value === 0) value = hash >>> (index + 1) || 1
  }
  return `LH-${body}`
}

export function suggestAssetTrackingTag(input: {
  deviceId: string
  hostname?: string | null
  serialNumber?: string | null
  attempt?: number
}) {
  const attempt = input.attempt ?? 0
  const seed = [
    input.deviceId,
    input.hostname ?? "",
    input.serialNumber ?? "",
    String(attempt),
  ].join("|")
  return generateTrackingTag(seed, 6)
}

export type AgentReportedAssetIdentity = {
  serialNumber: string | null
  hostname: string | null
  manufacturer: string | null
  model: string | null
}

export type AssetIdentityFields = {
  serial: string | null
  hostname: string | null
  vendor: string | null
  model: string | null
  deviceModelId: string | null
}

export type DeviceModelMatchCandidate = {
  id: string
  manufacturer: string | null
  model: string
  name: string
}

/**
 * Prefer manufacturer+model together; fall back to a unique model string match.
 */
export function matchDeviceModel(
  reported: { manufacturer: string | null; model: string | null },
  catalog: readonly DeviceModelMatchCandidate[]
): string | null {
  const model = normalizeHardwareIdentity(reported.model)
  if (!model) return null
  const manufacturer = normalizeHardwareIdentity(reported.manufacturer)

  if (manufacturer) {
    const both = catalog.find(
      (entry) =>
        normalizeHardwareIdentity(entry.model) === model &&
        normalizeHardwareIdentity(entry.manufacturer) === manufacturer
    )
    if (both) return both.id
  }

  const byModel = catalog.filter(
    (entry) => normalizeHardwareIdentity(entry.model) === model
  )
  return byModel.length === 1 ? byModel[0].id : null
}

/**
 * Fill empty identity fields only. Never overwrite a non-empty value, and
 * never write blank agent data over anything. Catalog link is set only when
 * the asset has no model yet and a catalog match exists.
 */
export function fillEmptyAssetIdentity(
  existing: AssetIdentityFields,
  reported: AgentReportedAssetIdentity,
  catalogModelId: string | null,
  catalogEntry?: { manufacturer: string | null; model: string } | null
): Partial<AssetIdentityFields> {
  const patch: Partial<AssetIdentityFields> = {}
  const serial = blankToNull(reported.serialNumber)
  const hostname = blankToNull(reported.hostname)
  const manufacturer = blankToNull(reported.manufacturer)
  const model = blankToNull(reported.model)

  if (isBlank(existing.serial) && serial) patch.serial = serial.slice(0, 120)
  if (isBlank(existing.hostname) && hostname) {
    patch.hostname = hostname.slice(0, 253)
  }

  if (isBlank(existing.deviceModelId) && catalogModelId) {
    patch.deviceModelId = catalogModelId
    if (catalogEntry) {
      if (isBlank(existing.vendor) && catalogEntry.manufacturer) {
        patch.vendor = catalogEntry.manufacturer.slice(0, 120)
      }
      if (isBlank(existing.model) && catalogEntry.model) {
        patch.model = catalogEntry.model.slice(0, 120)
      }
    }
  } else if (isBlank(existing.deviceModelId)) {
    if (isBlank(existing.vendor) && manufacturer) {
      patch.vendor = manufacturer.slice(0, 120)
    }
    if (isBlank(existing.model) && model) {
      patch.model = model.slice(0, 120)
    }
  }

  return patch
}

export function initialAssetIdentityFromAgent(
  reported: AgentReportedAssetIdentity,
  catalogModelId: string | null,
  catalogEntry?: { manufacturer: string | null; model: string } | null
): Omit<AssetIdentityFields, "deviceModelId"> & {
  deviceModelId: string | null
} {
  const serial = blankToNull(reported.serialNumber)?.slice(0, 120) ?? null
  const hostname = blankToNull(reported.hostname)?.slice(0, 253) ?? null
  if (catalogModelId && catalogEntry) {
    return {
      serial,
      hostname,
      vendor: blankToNull(catalogEntry.manufacturer)?.slice(0, 120) ?? null,
      model: blankToNull(catalogEntry.model)?.slice(0, 120) ?? null,
      deviceModelId: catalogModelId,
    }
  }
  return {
    serial,
    hostname,
    vendor: blankToNull(reported.manufacturer)?.slice(0, 120) ?? null,
    model: blankToNull(reported.model)?.slice(0, 120) ?? null,
    deviceModelId: null,
  }
}

/**
 * Plain-text QR payload for physical labels. Tracking tag first; append serial
 * when present. Never a Console URL — scanners and humans share the same values.
 */
export function assetLabelQrPayload(input: {
  tag: string
  serial?: string | null
}) {
  const tag = blankToNull(input.tag)
  if (!tag) return ""
  const serial = blankToNull(input.serial)
  return serial ? `${tag}\n${serial}` : tag
}

export const deviceModelInputSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(4000).nullable().optional(),
  purchaseCost: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,2})?$/, "Cost must be a number.")
    .nullable()
    .optional(),
  replacementCost: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,2})?$/, "Cost must be a number.")
    .nullable()
    .optional(),
})

export function parseIsoDate(value: string | null | undefined) {
  if (!value) return null
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

export function formatIsoDate(date: Date) {
  return utcDayStart(date).toISOString().slice(0, 10)
}

export function parseMoney(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-")
  const digits = trimmed.replace(/[^0-9.]/g, "")
  if (!digits) return null
  const amount = Number(digits)
  if (!Number.isFinite(amount)) return null
  const signed = negative ? -Math.abs(amount) : amount
  return signed.toFixed(2)
}

export function warrantyState(
  expiresOn: string | Date | null | undefined,
  now: Date,
  windowDays = WARRANTY_EXPIRING_DAYS
): WarrantyState {
  if (!expiresOn) return "none"
  const end =
    expiresOn instanceof Date
      ? utcDayStart(expiresOn)
      : parseIsoDate(String(expiresOn))
  if (!end) return "none"
  const today = utcDayStart(now)
  if (end.getTime() < today.getTime()) return "expired"
  const windowEnd = new Date(today.getTime() + windowDays * MS_PER_DAY)
  if (end.getTime() <= windowEnd.getTime()) return "expiring"
  return "current"
}

/**
 * Prefer serial, then hostname (including an asset tag that matches the host).
 * Candidates must already exclude assets linked to another device.
 */
export function matchAssetToDevice(
  device: { serialNumber: string | null; hostname: string | null },
  candidates: readonly AssetMatchCandidate[]
): { assetId: string; reason: AssetMatchReason } | null {
  const serial = normalizeSerial(device.serialNumber)
  if (serial) {
    const hit = candidates.find(
      (asset) => normalizeSerial(asset.serial) === serial
    )
    if (hit) return { assetId: hit.id, reason: "serial" }
  }

  const hostname = normalizeHostname(device.hostname)
  if (!hostname) return null

  const hit = candidates.find((asset) => {
    if (asset.hostname && hostnamesMatch(asset.hostname, hostname)) return true
    return Boolean(asset.tag && hostnamesMatch(asset.tag, hostname))
  })
  return hit ? { assetId: hit.id, reason: "hostname" } : null
}

export function definitionAppliesTo(
  appliesTo: CustomFieldAppliesTo,
  target: "device" | "asset"
) {
  return appliesTo === "both" || appliesTo === target
}

export function normalizeCsvHeader(header: string) {
  return header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
}

export function parseCsv(text: string): {
  headers: string[]
  rows: Array<Record<string, string>>
} {
  const source = text.replace(/^\uFEFF/, "")
  const records: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n") {
      row.push(cell)
      records.push(row)
      row = []
      cell = ""
      continue
    }
    if (char === "\r") {
      continue
    }
    cell += char
  }
  if (quoted) {
    throw new Error("CSV has an unfinished quoted field.")
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    records.push(row)
  }

  const nonempty = records.filter((entry) =>
    entry.some((value) => value.trim().length > 0)
  )
  if (nonempty.length === 0) {
    return { headers: [], rows: [] }
  }

  const headers = nonempty[0].map(normalizeCsvHeader)
  const rows = nonempty.slice(1).map((values) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (!header) return
      record[header] = (values[index] ?? "").trim()
    })
    return record
  })
  return { headers, rows }
}

function firstValue(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]?.trim()
    if (value) return value
  }
  return null
}

function parseTags(value: string | null) {
  if (!value) return []
  return [
    ...new Set(
      value
        .split(/[|,]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    ),
  ].slice(0, 32)
}

function optionalText(value: string | null, max: number) {
  if (!value) return null
  return value.slice(0, max)
}

export function parseDeviceBulkCsv(text: string): {
  rows: ParsedDeviceCsvRow[]
  errors: CsvImportError[]
} {
  const parsed = parseCsv(text)
  const rows: ParsedDeviceCsvRow[] = []
  const errors: CsvImportError[] = []

  parsed.rows.forEach((record, index) => {
    const row = index + 2
    const id = firstValue(record, DEVICE_CSV_ID_KEYS)
    const serial = firstValue(record, DEVICE_CSV_SERIAL_KEYS)
    const hostname = firstValue(record, DEVICE_CSV_HOSTNAME_KEYS)
    if (!id && !serial && !hostname) {
      errors.push({
        row,
        message: "Each row needs an id, serial, or host name.",
      })
      return
    }
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) {
      errors.push({ row, message: "Device id is not valid." })
      return
    }
    rows.push({
      row,
      id,
      serial,
      hostname,
      displayName: optionalText(firstValue(record, DEVICE_CSV_NAME_KEYS), 120),
      tags: parseTags(firstValue(record, DEVICE_CSV_TAGS_KEYS)),
      site: optionalText(firstValue(record, DEVICE_CSV_SITE_KEYS), 120),
      notes: optionalText(firstValue(record, DEVICE_CSV_NOTES_KEYS), 4000),
      assetTag: optionalText(firstValue(record, DEVICE_CSV_ASSET_KEYS), 80),
    })
  })

  return { rows, errors }
}

export function parseSiteBulkCsv(text: string): {
  rows: ParsedSiteCsvRow[]
  errors: CsvImportError[]
} {
  const parsed = parseCsv(text)
  const rows: ParsedSiteCsvRow[] = []
  const errors: CsvImportError[] = []

  parsed.rows.forEach((record, index) => {
    const row = index + 2
    const organization = firstValue(record, [
      "organization",
      "organization_name",
      "organization_id",
      "org",
    ])
    const name = firstValue(record, ["name", "site", "site_name"])
    if (!organization || !name) {
      errors.push({
        row,
        message: "Each row needs an organization and a site name.",
      })
      return
    }

    const contactName = firstValue(record, ["contact_name", "contact"])
    const contactEmail = firstValue(record, ["contact_email", "email"])
    const contactPhone = firstValue(record, ["contact_phone", "phone"])
    const contactRole = firstValue(record, ["contact_role", "role"])
    let contact: SiteContact | null = null
    if (contactName) {
      const parsedContact = siteContactSchema.safeParse({
        name: contactName,
        role: contactRole,
        email: contactEmail || null,
        phone: contactPhone,
      })
      if (!parsedContact.success) {
        errors.push({ row, message: "Contact details are not valid." })
        return
      }
      contact = parsedContact.data
    }

    rows.push({
      row,
      organization,
      name: name.slice(0, 120),
      timezone: optionalText(firstValue(record, ["timezone", "tz"]), 80),
      address: optionalText(firstValue(record, ["address"]), 500),
      notes: optionalText(firstValue(record, ["notes"]), 4000),
      contact,
    })
  })

  return { rows, errors }
}

export function parseAssetBulkCsv(text: string): {
  rows: ParsedAssetCsvRow[]
  errors: CsvImportError[]
} {
  const parsed = parseCsv(text)
  const rows: ParsedAssetCsvRow[] = []
  const errors: CsvImportError[] = []

  parsed.rows.forEach((record, index) => {
    const row = index + 2
    const tag = firstValue(record, ["tag", "asset_tag", "asset"])
    if (!tag) {
      errors.push({ row, message: "Each row needs an asset tag." })
      return
    }

    const statusRaw = (firstValue(record, ["status"]) ?? "stock").toLowerCase()
    const status = assetStatusSchema.safeParse(
      statusRaw.replace(/[\s-]+/g, "_")
    )
    if (!status.success) {
      errors.push({ row, message: "Status is not recognized." })
      return
    }

    const purchaseDate = firstValue(record, [
      "purchase_date",
      "purchased",
      "bought",
    ])
    if (purchaseDate && !parseIsoDate(purchaseDate)) {
      errors.push({ row, message: "Purchase date must be YYYY-MM-DD." })
      return
    }

    const warranty = firstValue(record, [
      "warranty_expires_on",
      "warranty",
      "warranty_end",
    ])
    if (warranty && !parseIsoDate(warranty)) {
      errors.push({ row, message: "Warranty date must be YYYY-MM-DD." })
      return
    }

    const costRaw = firstValue(record, [
      "purchase_cost",
      "cost",
      "price",
      "purchase_price",
    ])
    const purchaseCost = costRaw ? parseMoney(costRaw) : null
    if (costRaw && !purchaseCost) {
      errors.push({ row, message: "Cost is not a number." })
      return
    }

    rows.push({
      row,
      tag: tag.slice(0, 80),
      vendor: optionalText(firstValue(record, ["vendor", "manufacturer"]), 120),
      model: optionalText(firstValue(record, ["model"]), 120),
      serial: optionalText(
        firstValue(record, ["serial", "serial_number"]),
        120
      ),
      hostname: optionalText(
        firstValue(record, ["hostname", "host_name"]),
        253
      ),
      site: optionalText(
        firstValue(record, ["site", "site_name", "site_id"]),
        120
      ),
      status: status.data,
      purchaseDate,
      purchaseCost,
      warrantyExpiresOn: warranty,
      notes: optionalText(firstValue(record, ["notes"]), 4000),
    })
  })

  return { rows, errors }
}
