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

/**
 * A container (folder) holds other assets via `parentAssetId`. Differentiate
 * containers by tracking tag and other identity fields — not a kind enum.
 */
export function isContainerAsset(asset: {
  isContainer: boolean | null | undefined
}): boolean {
  return Boolean(asset.isContainer)
}

/** @deprecated Prefer `isContainerAsset`. */
export function isFolderAsset(asset: {
  isContainer: boolean | null | undefined
}): boolean {
  return isContainerAsset(asset)
}

export type AssetContainmentRow = {
  id: string
  organizationId: string
  isContainer: boolean
  parentAssetId: string | null
}

export type ContainmentDecision = { ok: true } | { ok: false; message: string }

/**
 * One-level containment: only containers may be parents; containers cannot be
 * children; no nesting; same organization.
 */
export function assertCanAttachChild(input: {
  parent: AssetContainmentRow
  child: AssetContainmentRow
}): ContainmentDecision {
  if (input.parent.id === input.child.id) {
    return { ok: false, message: "An asset cannot contain itself." }
  }
  if (input.parent.organizationId !== input.child.organizationId) {
    return {
      ok: false,
      message: "Folder and item must belong to the same organization.",
    }
  }
  if (!isContainerAsset(input.parent)) {
    return { ok: false, message: "Only folders can contain items." }
  }
  if (input.parent.parentAssetId) {
    return {
      ok: false,
      message: "Folders cannot be nested inside other folders.",
    }
  }
  if (isContainerAsset(input.child)) {
    return {
      ok: false,
      message: "A folder cannot be placed inside another folder.",
    }
  }
  return { ok: true }
}

/** Clear parent pointer; always allowed for an attached child. */
export function assertCanDetachChild(input: {
  child: AssetContainmentRow
}): ContainmentDecision {
  if (!input.child.parentAssetId) {
    return { ok: false, message: "That item is not inside a folder." }
  }
  if (isContainerAsset(input.child)) {
    return { ok: false, message: "Folders cannot be nested." }
  }
  return { ok: true }
}

/**
 * Site inheritance while attached: child's site matches the folder when
 * attaching or when the folder site moves.
 */
export function childSiteFromFolder(folderSiteId: string | null): {
  siteId: string | null
} {
  return { siteId: folderSiteId }
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

/** Assets due to retire within this many days show "Due to retire". */
export const RETIRE_DUE_DAYS = 90

export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date.")

export const retireAfterMonthsSchema = z
  .number()
  .int()
  .min(1)
  .max(1200)
  .nullable()
  .optional()

export const retireAfterYearsSchema = z
  .number()
  .min(0.083)
  .max(100)
  .nullable()
  .optional()

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

export type AssetLifecycleState = "none" | "in_service" | "due" | "retired"

export const assetLifecycleStateLabels: Record<AssetLifecycleState, string> = {
  none: "—",
  in_service: "In service",
  due: "Due to retire",
  retired: "Retired",
}

export type AssetLifecycleFieldSource = "asset" | "model" | "none"

export type AssetLifecycleInput = {
  status: AssetStatus
  purchaseDate?: string | null
  retireAfterMonths?: number | null
  retireOn?: string | null
  modelDefaultPurchaseDate?: string | null
  modelRetireAfterMonths?: number | null
}

export type AssetLifecycle = {
  purchaseDate: string | null
  purchaseDateSource: AssetLifecycleFieldSource
  retireAfterMonths: number | null
  retireAfterMonthsSource: AssetLifecycleFieldSource
  retireOn: string | null
  retireOnSource: "asset" | "computed" | "none"
  state: AssetLifecycleState
  /** True when the operator set status to retired/disposed, or the schedule has passed. */
  showRetired: boolean
}

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

/**
 * SMBIOS / DMI / WMI strings that are not unique chassis serials. Agents omit
 * these from check-in; Hub treats them as unset for asset matching and fill.
 */
const PLACEHOLDER_HARDWARE_SERIALS = new Set(
  [
    "none",
    "n/a",
    "na",
    "null",
    "nil",
    "unknown",
    "not specified",
    "not available",
    "not applicable",
    "default string",
    "defaultstring",
    "system serial number",
    "chassis serial number",
    "to be filled by o.e.m.",
    "to be filled by oem",
    "oem",
    "o.e.m.",
    "0",
    "00000000",
    "0000000000000000",
    "123456789",
    "1234567890",
    "xxxxxxxxxxxx",
    "xxxxxxxx",
  ].map((value) => value.replace(/[\s.\-/]+/g, "").toLowerCase())
)

function serialDenylistKey(value: string) {
  return value
    .trim()
    .replace(/[\s.\-/]+/g, "")
    .toLowerCase()
}

/** True when the value is empty or a known BIOS/DMI placeholder. */
export function isPlaceholderHardwareSerial(
  value: string | null | undefined
): boolean {
  if (value == null) return true
  const trimmed = value.trim()
  if (!trimmed) return true
  const key = serialDenylistKey(trimmed)
  if (!key) return true
  if (PLACEHOLDER_HARDWARE_SERIALS.has(key)) return true
  // All X / all 0 after stripping separators (e.g. XX-XX, 00-00-00).
  if (/^x+$/i.test(key) && key.length >= 4) return true
  if (/^0+$/.test(key)) return true
  return false
}

/**
 * Return a trimmed real serial, or null when empty / placeholder.
 * Caps length to match asset / device column practice.
 */
export function sanitizeHardwareSerial(
  value: string | null | undefined
): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (isPlaceholderHardwareSerial(trimmed)) return null
  return trimmed.slice(0, 120)
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

/** Default prefix for generated tags (`LH-7K2MPQ`). Override per organization. */
export const DEFAULT_TRACKING_TAG_PREFIX = "LH"

/**
 * Org tracking-tag prefix: 1–8 alphanumeric characters, stored uppercase.
 * Separated from the body with a hyphen (`NME-7K2MPQ`).
 */
export const trackingTagPrefixSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{1,8}$/, "Prefix must be 1–8 letters or numbers.")
  .transform((value) => value.toUpperCase())

export function normalizeTrackingTagPrefix(
  value: string | null | undefined
): string {
  const parsed = trackingTagPrefixSchema.safeParse(value ?? "")
  return parsed.success ? parsed.data : DEFAULT_TRACKING_TAG_PREFIX
}

export function generateTrackingTag(
  seed: string,
  length = 6,
  prefix: string = DEFAULT_TRACKING_TAG_PREFIX
): string {
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
  return `${normalizeTrackingTagPrefix(prefix)}-${body}`
}

/**
 * Body after `PREFIX-` when the tag uses that org prefix scheme.
 * Custom tags without that leading prefix return null (do not retarget).
 */
export function trackingTagBodyAfterPrefix(
  tag: string,
  prefix: string
): string | null {
  const normalized = normalizeTrackingTagPrefix(prefix)
  const trimmed = tag.trim()
  const expected = `${normalized}-`
  if (trimmed.length <= expected.length) return null
  if (trimmed.slice(0, expected.length).toUpperCase() !== expected) {
    return null
  }
  const body = trimmed.slice(expected.length)
  return body.length > 0 ? body : null
}

/** Replace a matching leading prefix; null when the tag is not in scheme. */
export function retargetTrackingTag(
  tag: string,
  fromPrefix: string,
  toPrefix: string
): string | null {
  const body = trackingTagBodyAfterPrefix(tag, fromPrefix)
  if (body === null) return null
  return `${normalizeTrackingTagPrefix(toPrefix)}-${body}`
}

export type TrackingTagRetargetChange = {
  id: string
  fromTag: string
  toTag: string
}

export type TrackingTagRetargetConflict = {
  id: string
  fromTag: string
  toTag: string
  reason: "target_exists" | "duplicate_target"
}

export type TrackingTagRetargetPlan = {
  fromPrefix: string
  toPrefix: string
  updates: TrackingTagRetargetChange[]
  /** Tags that do not use the from-prefix scheme. */
  skipped: number
  /** Matching tags already using the to-prefix (no write). */
  unchanged: number
  conflicts: TrackingTagRetargetConflict[]
}

/**
 * Plan a bulk prefix rewrite. Only `fromPrefix-…` tags are candidates.
 * Skips custom tags; refuses updates that would collide with an existing tag.
 */
export function planTrackingTagPrefixRetarget(
  rows: readonly { id: string; tag: string }[],
  fromPrefix: string,
  toPrefix: string
): TrackingTagRetargetPlan {
  const from = normalizeTrackingTagPrefix(fromPrefix)
  const to = normalizeTrackingTagPrefix(toPrefix)
  const existingByUpper = new Map<string, string>()
  for (const row of rows) {
    existingByUpper.set(row.tag.trim().toUpperCase(), row.id)
  }

  const updates: TrackingTagRetargetChange[] = []
  const conflicts: TrackingTagRetargetConflict[] = []
  let skipped = 0
  let unchanged = 0
  const claimedTargets = new Map<string, string>()

  for (const row of rows) {
    const fromTag = row.tag.trim()
    const body = trackingTagBodyAfterPrefix(fromTag, from)
    if (body === null) {
      skipped += 1
      continue
    }
    const toTag = `${to}-${body}`
    if (toTag.toUpperCase() === fromTag.toUpperCase()) {
      unchanged += 1
      continue
    }
    const toUpper = toTag.toUpperCase()
    const existingId = existingByUpper.get(toUpper)
    if (existingId && existingId !== row.id) {
      conflicts.push({
        id: row.id,
        fromTag,
        toTag,
        reason: "target_exists",
      })
      continue
    }
    if (claimedTargets.has(toUpper)) {
      conflicts.push({
        id: row.id,
        fromTag,
        toTag,
        reason: "duplicate_target",
      })
      continue
    }
    claimedTargets.set(toUpper, row.id)
    updates.push({ id: row.id, fromTag, toTag })
  }

  return {
    fromPrefix: from,
    toPrefix: to,
    updates,
    skipped,
    unchanged,
    conflicts,
  }
}

export function suggestAssetTrackingTag(input: {
  deviceId: string
  hostname?: string | null
  serialNumber?: string | null
  attempt?: number
  prefix?: string | null
}) {
  const attempt = input.attempt ?? 0
  const seed = [
    input.deviceId,
    input.hostname ?? "",
    input.serialNumber ?? "",
    String(attempt),
  ].join("|")
  return generateTrackingTag(
    seed,
    6,
    input.prefix ?? DEFAULT_TRACKING_TAG_PREFIX
  )
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

/**
 * Versioned label data for browser print and local tape helpers. QR text matches
 * `assetLabelQrPayload`. Company and site names are display-only (not in the QR).
 */
export const assetLabelPrintPayloadSchema = z.object({
  version: z.literal(1),
  tag: z.string().trim().min(1).max(80),
  serial: z.string().trim().min(1).max(120).nullable(),
  qrText: z.string().trim().min(1).max(220),
  siteName: z.string().trim().min(1).max(120).nullable(),
  companyName: z.string().trim().min(1).max(120).nullable(),
})

export type AssetLabelPrintPayload = z.infer<
  typeof assetLabelPrintPayloadSchema
>

export function buildAssetLabelPrintPayload(input: {
  tag: string
  serial?: string | null
  siteName?: string | null
  companyName?: string | null
}): AssetLabelPrintPayload | null {
  const tag = blankToNull(input.tag)
  if (!tag) return null
  const serial = blankToNull(input.serial)
  const qrText = assetLabelQrPayload({ tag, serial })
  if (!qrText) return null
  return assetLabelPrintPayloadSchema.parse({
    version: 1,
    tag,
    serial,
    qrText,
    siteName: blankToNull(input.siteName),
    companyName: blankToNull(input.companyName),
  })
}

/**
 * Stable CSV schema for local tape helpers (e.g. Brother P-touch via
 * `scripts/print-asset-labels.sh`). Bump `ASSET_LABEL_CSV_SCHEMA_VERSION` and
 * document column changes when extending.
 */
export const ASSET_LABEL_CSV_SCHEMA_VERSION = 1 as const

export const assetLabelCsvColumnKeys = [
  "schema_version",
  "tag",
  "serial",
  "company_name",
  "qr_text",
  "site_name",
] as const

export type AssetLabelCsvColumnKey = (typeof assetLabelCsvColumnKeys)[number]

export type AssetLabelCsvRow = {
  schemaVersion: typeof ASSET_LABEL_CSV_SCHEMA_VERSION
  tag: string
  serial: string | null
  companyName: string | null
  qrText: string
  siteName: string | null
}

export function buildAssetLabelCsvRow(input: {
  tag: string
  serial?: string | null
  siteName?: string | null
  companyName?: string | null
}): AssetLabelCsvRow | null {
  const payload = buildAssetLabelPrintPayload(input)
  if (!payload) return null
  return {
    schemaVersion: ASSET_LABEL_CSV_SCHEMA_VERSION,
    tag: payload.tag,
    serial: payload.serial,
    companyName: payload.companyName,
    qrText: payload.qrText,
    siteName: payload.siteName,
  }
}

function escapeAssetLabelCsvCell(value: unknown) {
  if (value === null || value === undefined) return ""
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function formatAssetLabelCsv(rows: readonly AssetLabelCsvRow[]): string {
  const header = assetLabelCsvColumnKeys.join(",")
  const lines = rows.map((row) =>
    [
      row.schemaVersion,
      row.tag,
      row.serial ?? "",
      row.companyName ?? "",
      row.qrText,
      row.siteName ?? "",
    ]
      .map(escapeAssetLabelCsvCell)
      .join(",")
  )
  return `${[header, ...lines].join("\r\n")}\r\n`
}

export function parseAssetLabelCsv(text: string): {
  rows: AssetLabelCsvRow[]
  errors: Array<{ row: number; message: string }>
} {
  const { headers, rows: rawRows } = parseCsv(text)
  const normalizedHeaders = headers.map(normalizeCsvHeader)
  const errors: Array<{ row: number; message: string }> = []
  const required = ["schema_version", "tag", "qr_text"] as const
  for (const key of required) {
    if (!normalizedHeaders.includes(key)) {
      return {
        rows: [],
        errors: [
          {
            row: 0,
            message: `Missing required column "${key}".`,
          },
        ],
      }
    }
  }

  const rows: AssetLabelCsvRow[] = []
  rawRows.forEach((record, index) => {
    const rowNumber = index + 2
    const versionRaw = blankToNull(record.schema_version)
    const version = versionRaw ? Number(versionRaw) : NaN
    if (version !== ASSET_LABEL_CSV_SCHEMA_VERSION) {
      errors.push({
        row: rowNumber,
        message: `Unsupported schema_version "${versionRaw ?? ""}".`,
      })
      return
    }
    const tag = blankToNull(record.tag)
    const qrText = blankToNull(record.qr_text)
    if (!tag || !qrText) {
      errors.push({
        row: rowNumber,
        message: "Each row needs a tracking tag and QR text.",
      })
      return
    }
    rows.push({
      schemaVersion: ASSET_LABEL_CSV_SCHEMA_VERSION,
      tag,
      serial: blankToNull(record.serial),
      companyName: blankToNull(record.company_name),
      qrText,
      siteName: blankToNull(record.site_name),
    })
  })

  return { rows, errors }
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
  defaultPurchaseDate: isoDateSchema.nullable().optional(),
  retireAfterMonths: retireAfterMonthsSchema,
})

export function yearsToRetireMonths(
  years: number | null | undefined
): number | null {
  if (years == null || !Number.isFinite(years) || years <= 0) return null
  return Math.max(1, Math.round(years * 12))
}

export function retireMonthsToYears(
  months: number | null | undefined
): number | null {
  if (months == null || !Number.isFinite(months) || months <= 0) return null
  const years = months / 12
  return Number.isInteger(years) ? years : Math.round(years * 100) / 100
}

export function addMonthsToIsoDate(
  isoDate: string,
  months: number
): string | null {
  const start = parseIsoDate(isoDate)
  if (!start || !Number.isFinite(months) || months <= 0) return null
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth()
  const day = start.getUTCDate()
  const totalMonths = month + Math.trunc(months)
  const targetYear = year + Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate()
  const targetDay = Math.min(day, lastDay)
  return formatIsoDate(new Date(Date.UTC(targetYear, targetMonth, targetDay)))
}

export function resolveAssetLifecycle(
  input: AssetLifecycleInput,
  now: Date,
  dueDays = RETIRE_DUE_DAYS
): AssetLifecycle {
  const purchaseDateSource: AssetLifecycleFieldSource = input.purchaseDate
    ? "asset"
    : input.modelDefaultPurchaseDate
      ? "model"
      : "none"
  const purchaseDate =
    purchaseDateSource === "asset"
      ? (input.purchaseDate ?? null)
      : purchaseDateSource === "model"
        ? (input.modelDefaultPurchaseDate ?? null)
        : null

  const retireAfterMonthsSource: AssetLifecycleFieldSource =
    input.retireAfterMonths != null
      ? "asset"
      : input.modelRetireAfterMonths != null
        ? "model"
        : "none"
  const retireAfterMonths =
    retireAfterMonthsSource === "asset"
      ? (input.retireAfterMonths ?? null)
      : retireAfterMonthsSource === "model"
        ? (input.modelRetireAfterMonths ?? null)
        : null

  let retireOn: string | null = null
  let retireOnSource: AssetLifecycle["retireOnSource"] = "none"
  if (input.retireOn) {
    retireOn = input.retireOn
    retireOnSource = "asset"
  } else if (purchaseDate && retireAfterMonths != null) {
    retireOn = addMonthsToIsoDate(purchaseDate, retireAfterMonths)
    retireOnSource = retireOn ? "computed" : "none"
  }

  let state: AssetLifecycleState = "none"
  if (retireOn) {
    const end = parseIsoDate(retireOn)
    if (end) {
      const today = utcDayStart(now)
      if (end.getTime() <= today.getTime()) {
        state = "retired"
      } else {
        const windowEnd = new Date(today.getTime() + dueDays * MS_PER_DAY)
        state = end.getTime() <= windowEnd.getTime() ? "due" : "in_service"
      }
    }
  }

  const statusRetired = input.status === "retired"
  const showRetired =
    statusRetired || input.status === "disposed" || state === "retired"

  return {
    purchaseDate,
    purchaseDateSource,
    retireAfterMonths,
    retireAfterMonthsSource,
    retireOn,
    retireOnSource,
    state: statusRetired && state !== "retired" ? "retired" : state,
    showRetired,
  }
}

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
