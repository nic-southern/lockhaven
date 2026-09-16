import { z } from "zod"

/** How long Hub keeps per-check-in metric samples. */
export const DEVICE_METRICS_SAMPLE_RETENTION_DAYS = 14

/**
 * Hub→agent commands are a closed whitelist. Expanding this list is a
 * contract change on both Hub and the client. Never a free-form shell string.
 */
export const agentCommandKinds = ["reboot", "restart", "update"] as const
export type AgentCommandKind = (typeof agentCommandKinds)[number]

export const agentCommandResultStatuses = [
  "succeeded",
  "failed",
  "refused",
] as const
export type AgentCommandResultStatus =
  (typeof agentCommandResultStatuses)[number]

/**
 * Strict on purpose: extra keys such as `command`, `script`, or `args` are
 * rejected so a Hub payload can never smuggle a shell string.
 */
export const agentCommandSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(agentCommandKinds),
  })
  .strict()

export type AgentCommand = z.infer<typeof agentCommandSchema>

export const agentCommandResultSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(agentCommandResultStatuses),
  detail: z.string().trim().max(500).optional(),
})

export type AgentCommandResult = z.infer<typeof agentCommandResultSchema>

export const checkInCommandResultsSchema = z
  .array(agentCommandResultSchema)
  .max(32)

export const checkInDiskSchema = z.object({
  mount: z.string().trim().min(1).max(256),
  filesystem: z.string().trim().min(1).max(64).optional(),
  total_bytes: z.number().int().nonnegative(),
  used_bytes: z.number().int().nonnegative(),
  available_bytes: z.number().int().nonnegative(),
})

export const checkInNetworkInterfaceSchema = z.object({
  name: z.string().trim().min(1).max(64),
  rx_bytes: z.number().int().nonnegative(),
  tx_bytes: z.number().int().nonnegative(),
  rx_packets: z.number().int().nonnegative().optional(),
  tx_packets: z.number().int().nonnegative().optional(),
})

export const checkInMetricsSchema = z.object({
  collected_at: z.coerce.date().optional(),
  uptime_seconds: z.number().int().nonnegative(),
  cpu: z.object({
    load1: z.number().nonnegative(),
    load5: z.number().nonnegative(),
    load15: z.number().nonnegative(),
    cores: z.number().int().positive().optional(),
  }),
  memory: z.object({
    total_bytes: z.number().int().nonnegative(),
    available_bytes: z.number().int().nonnegative(),
    used_bytes: z.number().int().nonnegative(),
  }),
  disks: z.array(checkInDiskSchema).max(64).default([]),
  network: z.array(checkInNetworkInterfaceSchema).max(64).default([]),
  wireguard: z
    .object({
      handshake_age_seconds: z.number().int().nonnegative().nullable(),
    })
    .optional(),
})

export type CheckInMetrics = z.infer<typeof checkInMetricsSchema>

export const checkInPackageSchema = z.object({
  name: z.string().trim().min(1).max(256),
  version: z.string().trim().min(1).max(128),
  source: z.string().trim().min(1).max(64).default("unknown"),
})

export const checkInPackageUpdateSchema = z.object({
  name: z.string().trim().min(1).max(256),
  current_version: z.string().trim().min(1).max(128).optional(),
  available_version: z.string().trim().min(1).max(128),
  source: z.string().trim().min(1).max(64).default("unknown"),
})

export const checkInPackagesSchema = z.object({
  collected_at: z.coerce.date().optional(),
  reboot_required: z.boolean().default(false),
  installed: z.array(checkInPackageSchema).max(5000).default([]),
  available_updates: z.array(checkInPackageUpdateSchema).max(2000).default([]),
})

export type CheckInPackages = z.infer<typeof checkInPackagesSchema>

/**
 * Hub check-in response. `commands` stays `unknown[]` so a single invalid
 * entry can be refused without dropping the rest of the payload.
 */
export const checkInResponseSchema = z.object({
  ok: z.boolean().optional(),
  desired_agent_version: z.string().trim().min(1).max(64).optional(),
  download_url: z.string().url().optional(),
  commands: z.array(z.unknown()).max(32).optional(),
})

export type CheckInResponse = z.infer<typeof checkInResponseSchema>

export type PackageRecord = {
  name: string
  version: string
  source: string
  availableVersion: string | null
}

export type PackageDiff = {
  added: PackageRecord[]
  removed: PackageRecord[]
  updated: Array<{ previous: PackageRecord; next: PackageRecord }>
  unchanged: PackageRecord[]
}

export function packageKey(pkg: { name: string; source: string }) {
  return `${pkg.source.toLowerCase()}::${pkg.name.toLowerCase()}`
}

export function inventoryFromCheckIn(
  payload: CheckInPackages
): PackageRecord[] {
  const updates = new Map<string, string>()
  for (const update of payload.available_updates) {
    updates.set(
      packageKey({ name: update.name, source: update.source }),
      update.available_version
    )
  }

  const inventory = new Map<string, PackageRecord>()

  for (const pkg of payload.installed) {
    const key = packageKey(pkg)
    inventory.set(key, {
      name: pkg.name,
      version: pkg.version,
      source: pkg.source,
      availableVersion: updates.get(key) ?? null,
    })
  }

  for (const update of payload.available_updates) {
    const key = packageKey(update)
    if (inventory.has(key)) continue
    inventory.set(key, {
      name: update.name,
      version: update.current_version ?? "",
      source: update.source,
      availableVersion: update.available_version,
    })
  }

  return [...inventory.values()].sort((left, right) =>
    packageKey(left).localeCompare(packageKey(right))
  )
}

export function diffPackages(
  previous: PackageRecord[],
  next: PackageRecord[]
): PackageDiff {
  const previousByKey = new Map(
    previous.map((pkg) => [packageKey(pkg), pkg] as const)
  )
  const nextByKey = new Map(next.map((pkg) => [packageKey(pkg), pkg] as const))

  const added: PackageRecord[] = []
  const removed: PackageRecord[] = []
  const updated: PackageDiff["updated"] = []
  const unchanged: PackageRecord[] = []

  for (const [key, pkg] of nextByKey) {
    const prior = previousByKey.get(key)
    if (!prior) {
      added.push(pkg)
      continue
    }
    if (
      prior.version !== pkg.version ||
      prior.availableVersion !== pkg.availableVersion
    ) {
      updated.push({ previous: prior, next: pkg })
      continue
    }
    unchanged.push(pkg)
  }

  for (const [key, pkg] of previousByKey) {
    if (!nextByKey.has(key)) {
      removed.push(pkg)
    }
  }

  return { added, removed, updated, unchanged }
}

export type AgentCommandRefusalReason =
  | "invalid_payload"
  | "unknown_kind"
  | "unsupported_fields"
  | "missing_id"

export type ResolvedAgentCommand =
  | { ok: true; command: AgentCommand }
  | {
      ok: false
      result: AgentCommandResult
      reason: AgentCommandRefusalReason
    }

function commandIdFromUnknown(value: unknown) {
  if (!value || typeof value !== "object") return null
  const id = (value as { id?: unknown }).id
  return typeof id === "string" && id.length > 0 ? id : null
}

/**
 * Accept only `{ id, kind }` where `kind` is on the allowlist. Any extra
 * field or unknown kind is refused and must never reach a process spawn.
 */
export function resolveAgentCommand(input: unknown): ResolvedAgentCommand {
  const parsed = agentCommandSchema.safeParse(input)
  if (parsed.success) {
    return { ok: true, command: parsed.data }
  }

  const fallbackId =
    commandIdFromUnknown(input) ?? "00000000-0000-0000-0000-000000000000"
  const issues = parsed.error.issues
  const hasUnsupportedFields = issues.some(
    (issue) => issue.code === "unrecognized_keys"
  )
  const kindIssue = issues.find((issue) => issue.path.includes("kind"))
  const idIssue = issues.find((issue) => issue.path.includes("id"))

  const reason: AgentCommandRefusalReason = hasUnsupportedFields
    ? "unsupported_fields"
    : kindIssue
      ? "unknown_kind"
      : idIssue
        ? "missing_id"
        : "invalid_payload"

  const detail =
    reason === "unknown_kind"
      ? "This command is not allowed."
      : reason === "unsupported_fields"
        ? "This command included unsupported fields."
        : "This command was not recognized."

  return {
    ok: false,
    reason,
    result: {
      id: fallbackId,
      status: "refused",
      detail,
    },
  }
}

export function resolveAgentCommands(inputs: unknown[] | undefined) {
  const accepted: AgentCommand[] = []
  const refused: AgentCommandResult[] = []

  for (const input of inputs ?? []) {
    const resolved = resolveAgentCommand(input)
    if (resolved.ok) {
      accepted.push(resolved.command)
    } else {
      refused.push(resolved.result)
    }
  }

  return { accepted, refused }
}

/**
 * Hub encoder: drop anything that is not `{ id, kind }` on the allowlist.
 * Never serializes a shell string, extra keys, or an unknown kind.
 */
export function encodeHubCommands(
  inputs: unknown[] | undefined
): AgentCommand[] {
  return resolveAgentCommands(inputs).accepted
}

export function hubCheckInResponse(args?: {
  desiredAgentVersion?: string
  downloadUrl?: string
  commands?: unknown[]
}) {
  return {
    ok: true as const,
    ...(args?.desiredAgentVersion
      ? { desired_agent_version: args.desiredAgentVersion }
      : {}),
    ...(args?.downloadUrl ? { download_url: args.downloadUrl } : {}),
    commands: encodeHubCommands(args?.commands),
  }
}
