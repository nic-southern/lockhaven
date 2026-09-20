import { z } from "zod"

/**
 * Hub-defined module kinds. Agents cannot register new kinds. Game/build
 * titles stay on check-in `titles` when that contract exists; modules only
 * collect Hub-issued observations. Hub never evaluates these as code.
 */
export const agentModuleKinds = ["observations"] as const
export type AgentModuleKind = (typeof agentModuleKinds)[number]
export const agentModuleKindSchema = z.enum(agentModuleKinds)

export const agentModuleKindLabels: Record<AgentModuleKind, string> = {
  observations: "Custom observations",
}

/**
 * Closed collector list. Each collector reads local state only. None of these
 * spawn a process, evaluate a script, or run an uploaded blob.
 */
export const agentCollectorTypes = [
  "process_running",
  "file_exists",
  "file_text",
  "file_size",
] as const
export type AgentCollectorType = (typeof agentCollectorTypes)[number]
export const agentCollectorTypeSchema = z.enum(agentCollectorTypes)

export const agentCollectorTypeLabels: Record<AgentCollectorType, string> = {
  process_running: "Process running",
  file_exists: "File present",
  file_text: "Text from file",
  file_size: "File size",
}

export const AGENT_MODULE_NAME_MAX = 80
export const AGENT_MODULE_COLLECTORS_MAX = 32
export const AGENT_MODULES_PER_DEVICE_MAX = 16
export const AGENT_MODULE_OBSERVATION_VALUE_MAX = 256
export const AGENT_MODULE_PATH_MAX = 512
export const AGENT_MODULE_PROCESS_MAX = 128
export const CHECK_IN_MAX_BODY_BYTES = 256 * 1024
export const AGENT_MODULE_JSON_DEPTH_MAX = 6

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const PROCESS_FORBIDDEN = /[\\/:*?"<>|;&=`$()]/
const EXECUTABLE_SUFFIX =
  /\.(exe|bat|cmd|com|ps1|psm1|sh|bash|dll|sys|msi|scr|vbs|js|wsf)$/i
const POISONED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"])
const SCRIPTISH =
  /^\s*(?:#!|\u004d\u005a|\u007fELF|<\?php|<script\b|javascript:|vbscript:|powershell(?:\.exe)?(?:\s|-)|cmd(?:\.exe)?\s|\/bin\/(?:ba)?sh\b)/i

export function isSafeProcessName(value: string) {
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > AGENT_MODULE_PROCESS_MAX) {
    return false
  }
  if (trimmed === "." || trimmed === "..") return false
  if (CONTROL_CHARS.test(trimmed) || PROCESS_FORBIDDEN.test(trimmed)) {
    return false
  }
  return true
}

export function isSafeCollectorPath(value: string) {
  if (value.length < 2 || value.length > AGENT_MODULE_PATH_MAX) return false
  if (CONTROL_CHARS.test(value)) return false
  const normalized = value.replaceAll("\\", "/")
  if (normalized.split("/").includes("..")) return false
  if (normalized.startsWith("//")) return false
  if (/^[A-Za-z]:\//.test(normalized)) return true
  if (normalized.startsWith("/") && !normalized.startsWith("//")) return true
  return false
}

export function isExecutableCollectorPath(value: string) {
  const normalized = value.replaceAll("\\", "/").split("/").pop() ?? value
  return EXECUTABLE_SUFFIX.test(normalized)
}

/**
 * Uploaded module JSON is treated as poisoned. Forbidden prototype keys,
 * excessive nesting, and unknown shapes fail closed before Hub stores them.
 */
export function hasPoisonedKeys(value: unknown, depth = 0): boolean {
  if (depth > AGENT_MODULE_JSON_DEPTH_MAX) return true
  if (value == null) return false
  if (typeof value === "string") return looksLikeScriptOrBinary(value)
  if (typeof value !== "object") return false
  if (Array.isArray(value)) {
    return value.some((item) => hasPoisonedKeys(item, depth + 1))
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (POISONED_OBJECT_KEYS.has(key.toLowerCase())) return true
    if (hasPoisonedKeys((value as Record<string, unknown>)[key], depth + 1)) {
      return true
    }
  }
  return false
}

export function looksLikeScriptOrBinary(value: string) {
  if (CONTROL_CHARS.test(value)) return true
  if (SCRIPTISH.test(value)) return true
  if (value.length < 8) return false
  let nonText = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 32 || code === 127 || code > 126) nonText += 1
  }
  return nonText / value.length > 0.3
}

const processNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_MODULE_PROCESS_MAX)
  .refine(isSafeProcessName, "That process name is not allowed.")

const collectorPathSchema = z
  .string()
  .trim()
  .min(2)
  .max(AGENT_MODULE_PATH_MAX)
  .refine(isSafeCollectorPath, "That path is not allowed.")

const readablePathSchema = collectorPathSchema.refine(
  (value) => !isExecutableCollectorPath(value),
  "Text collectors cannot point at an executable."
)

const collectorIdSchema = z.string().uuid()

export const agentModuleCollectorSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: collectorIdSchema,
      type: z.literal("process_running"),
      process: processNameSchema,
    })
    .strict(),
  z
    .object({
      id: collectorIdSchema,
      type: z.literal("file_exists"),
      path: collectorPathSchema,
    })
    .strict(),
  z
    .object({
      id: collectorIdSchema,
      type: z.literal("file_text"),
      path: readablePathSchema,
    })
    .strict(),
  z
    .object({
      id: collectorIdSchema,
      type: z.literal("file_size"),
      path: collectorPathSchema,
    })
    .strict(),
])

export type AgentModuleCollector = z.infer<typeof agentModuleCollectorSchema>

export const agentModuleCollectorDraftSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("process_running"),
      process: processNameSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("file_exists"),
      path: collectorPathSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("file_text"),
      path: readablePathSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("file_size"),
      path: collectorPathSchema,
    })
    .strict(),
])

export type AgentModuleCollectorDraft = z.infer<
  typeof agentModuleCollectorDraftSchema
>

export const agentModuleCollectorsSchema = z
  .array(agentModuleCollectorSchema)
  .min(1)
  .max(AGENT_MODULE_COLLECTORS_MAX)

const printableValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_MODULE_OBSERVATION_VALUE_MAX)
  .refine(
    (value) => !CONTROL_CHARS.test(value) && !looksLikeScriptOrBinary(value),
    "Value contains invalid characters."
  )

export const processRunningObservationSchema = z
  .object({
    id: collectorIdSchema,
    type: z.literal("process_running"),
    running: z.boolean(),
  })
  .strict()

export const fileExistsObservationSchema = z
  .object({
    id: collectorIdSchema,
    type: z.literal("file_exists"),
    exists: z.boolean(),
  })
  .strict()

export const fileTextObservationSchema = z
  .object({
    id: collectorIdSchema,
    type: z.literal("file_text"),
    exists: z.boolean(),
    value: printableValueSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.exists && value.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A present file must include a text value.",
        path: ["value"],
      })
    }
    if (!value.exists && value.value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A missing file cannot include a value.",
        path: ["value"],
      })
    }
  })

export const fileSizeObservationSchema = z
  .object({
    id: collectorIdSchema,
    type: z.literal("file_size"),
    exists: z.boolean(),
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.exists && value.bytes === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A present file must include a size.",
        path: ["bytes"],
      })
    }
    if (!value.exists && value.bytes !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A missing file cannot include a size.",
        path: ["bytes"],
      })
    }
  })

export const agentModuleObservationSchema = z.discriminatedUnion("type", [
  processRunningObservationSchema,
  fileExistsObservationSchema,
  fileTextObservationSchema,
  fileSizeObservationSchema,
])

export type AgentModuleObservation = z.infer<
  typeof agentModuleObservationSchema
>

export const checkInModuleReportSchema = z
  .object({
    module_id: z.string().uuid(),
    kind: agentModuleKindSchema,
    observations: z
      .array(agentModuleObservationSchema)
      .max(AGENT_MODULE_COLLECTORS_MAX),
  })
  .strict()

export type CheckInModuleReport = z.infer<typeof checkInModuleReportSchema>

export const checkInModulesSchema = z.preprocess(
  (value) => (value === null ? [] : value),
  z
    .array(checkInModuleReportSchema)
    .max(AGENT_MODULES_PER_DEVICE_MAX)
    .superRefine((value, ctx) => {
      if (hasPoisonedKeys(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Module payload contains forbidden keys.",
        })
      }
    })
)

export const hubModuleDefinitionSchema = z
  .object({
    id: z.string().uuid(),
    kind: agentModuleKindSchema,
    name: z.string().trim().min(1).max(AGENT_MODULE_NAME_MAX),
    collectors: agentModuleCollectorsSchema,
  })
  .strict()

export type HubModuleDefinition = z.infer<typeof hubModuleDefinitionSchema>

export const hubModulesResponseSchema = z
  .array(hubModuleDefinitionSchema)
  .max(AGENT_MODULES_PER_DEVICE_MAX)

function rejectPoisonedInput(value: unknown, ctx: z.RefinementCtx) {
  if (hasPoisonedKeys(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Module payload contains forbidden keys.",
    })
  }
}

export const agentModuleCreateSchema = z
  .object({
    organizationId: z.string().uuid(),
    name: z.string().trim().min(1).max(AGENT_MODULE_NAME_MAX),
    kind: agentModuleKindSchema.default("observations"),
    collectors: z
      .array(agentModuleCollectorDraftSchema)
      .min(1)
      .max(AGENT_MODULE_COLLECTORS_MAX),
  })
  .strict()
  .superRefine(rejectPoisonedInput)

export type AgentModuleCreateInput = z.infer<typeof agentModuleCreateSchema>

export const agentModuleUpdateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(AGENT_MODULE_NAME_MAX),
    collectors: z
      .array(agentModuleCollectorDraftSchema)
      .min(1)
      .max(AGENT_MODULE_COLLECTORS_MAX),
  })
  .strict()
  .superRefine(rejectPoisonedInput)

export const agentModuleAssignSchema = z
  .object({
    moduleId: z.string().uuid(),
    siteId: z.string().uuid().nullable().optional(),
    deviceId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.siteId && value.deviceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assign to a site or a device, not both.",
        path: ["deviceId"],
      })
    }
  })

export type ModulePayloadRefusalReason =
  | "unknown_module"
  | "kind_mismatch"
  | "unknown_collector"
  | "collector_type_mismatch"
  | "duplicate_module"
  | "duplicate_collector"
  | "invalid_observation"
  | "poisoned_payload"

export type ModulePayloadDecision =
  | { ok: true; reports: CheckInModuleReport[] }
  | {
      ok: false
      reason: ModulePayloadRefusalReason
      detail: string
    }

function observationMatchesCollector(
  observation: AgentModuleObservation,
  collector: AgentModuleCollector
) {
  return observation.id === collector.id && observation.type === collector.type
}

/**
 * Agents may only report modules Hub assigned, using the Hub-issued kind and
 * collector ids. Poisoned shapes, kind spoofing, type mismatches, and
 * duplicates fail closed. Reports for modules or collectors Hub no longer
 * assigns are dropped so check-in can still succeed and return the current
 * Hub definitions (agents heal after delete/re-add). Hub must not eval, exec,
 * or shell-out on this payload — callers only store JSON.
 */
export function validateReportedModules(
  assigned: HubModuleDefinition[],
  reported: CheckInModuleReport[] | undefined
): ModulePayloadDecision {
  if (reported === undefined) {
    return { ok: true, reports: [] }
  }
  if (hasPoisonedKeys(reported)) {
    return {
      ok: false,
      reason: "poisoned_payload",
      detail: "Module payload contains forbidden keys.",
    }
  }

  const assignedById = new Map(assigned.map((module) => [module.id, module]))
  const seenModules = new Set<string>()
  const accepted: CheckInModuleReport[] = []

  for (const report of reported) {
    if (seenModules.has(report.module_id)) {
      return {
        ok: false,
        reason: "duplicate_module",
        detail: "A module was reported more than once.",
      }
    }
    seenModules.add(report.module_id)

    const definition = assignedById.get(report.module_id)
    // Stale local agent state after delete/re-add: drop, do not reject check-in.
    if (!definition) {
      continue
    }
    if (definition.kind !== report.kind) {
      return {
        ok: false,
        reason: "kind_mismatch",
        detail: "The module kind does not match the Hub definition.",
      }
    }

    const collectorsById = new Map(
      definition.collectors.map((collector) => [collector.id, collector])
    )
    const seenCollectors = new Set<string>()
    const observations: CheckInModuleReport["observations"] = []
    for (const observation of report.observations) {
      if (seenCollectors.has(observation.id)) {
        return {
          ok: false,
          reason: "duplicate_collector",
          detail: "A collector was reported more than once.",
        }
      }
      seenCollectors.add(observation.id)
      const collector = collectorsById.get(observation.id)
      // Collector ids reminted on Hub edit, or removed: drop observation only.
      if (!collector) {
        continue
      }
      if (!observationMatchesCollector(observation, collector)) {
        return {
          ok: false,
          reason: "collector_type_mismatch",
          detail: "An observation did not match its collector.",
        }
      }
      observations.push(observation)
    }

    accepted.push({
      module_id: report.module_id,
      kind: report.kind,
      observations,
    })
  }

  return { ok: true, reports: accepted }
}

export function encodeHubModules(
  input: HubModuleDefinition[] | undefined
): HubModuleDefinition[] {
  const encoded: HubModuleDefinition[] = []
  for (const definition of input ?? []) {
    const parsed = hubModuleDefinitionSchema.safeParse(definition)
    if (parsed.success) {
      encoded.push(parsed.data)
    }
  }
  return encoded.slice(0, AGENT_MODULES_PER_DEVICE_MAX)
}
