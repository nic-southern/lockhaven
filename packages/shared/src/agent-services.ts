import { z } from "zod"

/** Label shown in the console. Not passed to the device as an argument. */
export const AGENT_SERVICE_NAME_MAX = 64

/** Exact name the device restarts. One token. */
export const AGENT_SERVICE_TARGET_MAX = 64

const targetPattern = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/

export function isAgentServiceName(value: string) {
  const name = value.trim()
  if (name.length < 1 || name.length > AGENT_SERVICE_NAME_MAX) return false
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return false
  }
  return !/[\u0000-\u001f\u007f]/.test(name)
}

export function isAgentServiceTarget(value: string) {
  if (!targetPattern.test(value)) return false
  if (value.includes("..")) return false
  if (value.length > AGENT_SERVICE_TARGET_MAX) return false
  return true
}

export const agentServiceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_SERVICE_NAME_MAX)
  .refine(isAgentServiceName, "Use a short name.")

export const agentServiceTargetSchema = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_SERVICE_TARGET_MAX)
  .refine(isAgentServiceTarget, "Use the name this device already uses.")

export const agentServiceCreateSchema = z.object({
  organizationId: z.string().uuid(),
  name: agentServiceNameSchema,
  target: agentServiceTargetSchema,
})

export const agentServiceUpdateSchema = z.object({
  id: z.string().uuid(),
  name: agentServiceNameSchema,
  target: agentServiceTargetSchema,
})

export const agentServiceAssignSchema = z
  .object({
    serviceId: z.string().uuid(),
    siteId: z.string().uuid().nullable().optional(),
    deviceId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.siteId && value.deviceId) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a site or a device, not both.",
      })
    }
  })

export type AssignedAgentService = {
  name: string
  target: string
}

export const assignedAgentServiceSchema = z
  .object({
    name: agentServiceNameSchema,
    target: agentServiceTargetSchema,
  })
  .strict()

export const assignedAgentServicesSchema = z
  .array(assignedAgentServiceSchema)
  .max(32)

export function encodeAssignedServices(inputs: AssignedAgentService[]) {
  const seen = new Set<string>()
  const out: AssignedAgentService[] = []
  for (const input of inputs) {
    const parsed = assignedAgentServiceSchema.safeParse(input)
    if (!parsed.success) continue
    const key = parsed.data.name
    if (seen.has(key)) continue
    seen.add(key)
    out.push(parsed.data)
    if (out.length >= 32) break
  }
  return out
}
