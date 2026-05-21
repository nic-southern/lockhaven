import { createHash, randomUUID } from "node:crypto"

import { TRPCError } from "@trpc/server"
import { z } from "zod"

import {
  adminProcedure,
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from "./trpc"
import {
  auditEvents,
  and,
  desc,
  devices,
  enrollmentTokens,
  eq,
  managementServiceCredentials,
  managementServices,
  organizations,
  remoteSessions,
  routePolicies,
  sites,
  vpnIdentities,
} from "@nms/db"
import {
  decryptSecret,
  encryptSecret,
  guacamoleConfigSchema,
  GuacamoleRemoteAccessProvider,
  type EncryptedSecret,
} from "@nms/remote-access"
import {
  enrollmentTokenCreateSchema,
  enrollmentTokenUpdateSchema,
  remoteSessionRequestSchema,
  vncServiceDefaults,
} from "@nms/shared"
import {
  normalizeRouteValues,
  permissionForServiceType,
  siteBelongsToOrganization,
} from "./helpers"

function hashEnrollmentToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function makeEnrollmentToken() {
  return `nms_enroll_${randomUUID().replaceAll("-", "")}`
}

const guacamoleProvider = new GuacamoleRemoteAccessProvider(
  guacamoleConfigSchema.parse({
    baseUrl:
      process.env.GUACAMOLE_BASE_URL ?? "https://guac.example.com/guacamole/",
    databaseUrl:
      process.env.GUACAMOLE_DATABASE_URL ??
      "postgresql://guacamole:replace_me@guacamole-db:5432/guacamole_db",
  })
)

function getCredentialSecret() {
  const secret = process.env.REMOTE_CREDENTIALS_KEY

  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing remote credential secret",
    })
  }

  return secret
}

function encryptVncPassword(password: string) {
  return encryptSecret(password, getCredentialSecret())
}

function decryptVncPassword(payload: EncryptedSecret) {
  return decryptSecret(payload, getCredentialSecret())
}

function encryptRemoteSecret(secret: string) {
  return encryptSecret(secret, getCredentialSecret())
}

function decryptRemoteSecret(payload: EncryptedSecret) {
  return decryptSecret(payload, getCredentialSecret())
}

function decodePasswordRecord(
  record: typeof managementServiceCredentials.$inferSelect | null
) {
  if (!record) {
    return null
  }

  return decryptVncPassword({
    ciphertext: record.passwordCiphertext,
    iv: record.passwordIv,
    authTag: record.passwordAuthTag,
  })
}

function decodeSshCredentialRecord(
  record: typeof managementServiceCredentials.$inferSelect | null
) {
  if (
    !record?.usernameCiphertext ||
    !record.usernameIv ||
    !record.usernameAuthTag
  ) {
    return { username: null, privateKey: null }
  }

  return {
    username: decryptRemoteSecret({
      ciphertext: record.usernameCiphertext,
      iv: record.usernameIv,
      authTag: record.usernameAuthTag,
    }),
    privateKey: decryptRemoteSecret({
      ciphertext: record.passwordCiphertext,
      iv: record.passwordIv,
      authTag: record.passwordAuthTag,
    }),
  }
}

const serviceTypes = ["vnc", "rdp", "ssh", "winrm_https"] as const

const organizationCreateInput = z.object({
  name: z.string().min(1),
})

const siteCreateInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  timezone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const siteUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  timezone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const deviceUpdateInput = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).optional(),
  hostname: z.string().min(1).optional().nullable(),
  siteId: z.string().uuid().optional().nullable(),
})

const deviceRoutePolicyInput = z.object({
  id: z.string().uuid(),
  routePolicyId: z.string().uuid().nullable(),
})

const managementServiceCreateInput = z.object({
  deviceId: z.string().uuid(),
  serviceType: z.enum(serviceTypes),
  protocol: z.string().min(1).default("tcp"),
  port: z.number().int().positive(),
  enabled: z.boolean().default(true),
})

const managementServiceUpdateInput = z.object({
  id: z.string().uuid(),
  serviceType: z.enum(serviceTypes),
  protocol: z.string().min(1),
  port: z.number().int().positive(),
  enabled: z.boolean(),
})

const routePolicyCreateInput = z.object({
  name: z.string().min(1),
  routes: z.array(z.string().min(1)).min(1),
  description: z.string().optional().nullable(),
})

const routePolicyUpdateInput = routePolicyCreateInput.extend({
  id: z.string().uuid(),
})

const enrollmentTokenInput = enrollmentTokenCreateSchema

const auditListInput = z.object({
  organizationId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
})

const sessionCreateInput = remoteSessionRequestSchema.extend({
  deviceId: z.string().uuid(),
})

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => ({ ok: true })),
  organizations: createTRPCRouter({
    list: adminProcedure.query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(organizations)
        .orderBy(desc(organizations.createdAt))
    }),
    create: permissionProcedure("organization:admin")
      .input(organizationCreateInput)
      .mutation(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .insert(organizations)
          .values({ name: input.name })
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: record.id,
          eventType: "organization_created",
          eventData: { organizationId: record.id, name: record.name },
        })

        return record
      }),
  }),
  sites: createTRPCRouter({
    list: adminProcedure.query(async ({ ctx }) => {
      return ctx.db.select().from(sites).orderBy(desc(sites.createdAt))
    }),
    create: permissionProcedure("site:admin")
      .input(siteCreateInput)
      .mutation(async ({ ctx, input }) => {
        const [record] = await ctx.db.insert(sites).values(input).returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: record.organizationId,
          eventType: "site_created",
          eventData: { siteId: record.id, name: record.name },
        })

        return record
      }),
    update: permissionProcedure("site:admin")
      .input(siteUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(sites)
          .where(eq(sites.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [record] = await ctx.db
          .update(sites)
          .set({
            name: input.name,
            timezone: input.timezone ?? null,
            notes: input.notes ?? null,
          })
          .where(eq(sites.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "site_updated",
          eventData: { siteId: record.id, name: record.name },
        })

        return record
      }),
    delete: permissionProcedure("site:admin")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(sites)
          .where(eq(sites.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [record] = await ctx.db
          .delete(sites)
          .where(eq(sites.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "site_deleted",
          eventData: { siteId: existing.id, name: existing.name },
        })

        return record ?? existing
      }),
  }),
  devices: createTRPCRouter({
    list: permissionProcedure("device:view").query(async ({ ctx }) => {
      return ctx.db
        .select({
          id: devices.id,
          organizationId: devices.organizationId,
          siteId: devices.siteId,
          siteName: sites.name,
          hostname: devices.hostname,
          displayName: devices.displayName,
          osFamily: devices.osFamily,
          osVersion: devices.osVersion,
          architecture: devices.architecture,
          serialNumber: devices.serialNumber,
          status: devices.status,
          lastSeenAt: devices.lastSeenAt,
          createdAt: devices.createdAt,
          vpnIpv4: vpnIdentities.vpnIpv4,
          vpnRoutePolicyId: vpnIdentities.routePolicyId,
          vpnLastHandshakeAt: vpnIdentities.lastHandshakeAt,
          vpnLatestEndpoint: vpnIdentities.latestEndpoint,
          vpnRxBytes: vpnIdentities.rxBytes,
          vpnTxBytes: vpnIdentities.txBytes,
          vpnRevokedAt: vpnIdentities.revokedAt,
        })
        .from(devices)
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .orderBy(desc(devices.createdAt))
    }),
    byId: permissionProcedure("device:view")
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.id))

        if (!record) {
          return null
        }

        const [identity] = await ctx.db
          .select()
          .from(vpnIdentities)
          .where(eq(vpnIdentities.deviceId, record.id))

        const services = await ctx.db
          .select({
            service: managementServices,
            credential: managementServiceCredentials,
          })
          .from(managementServices)
          .leftJoin(
            managementServiceCredentials,
            eq(
              managementServiceCredentials.managementServiceId,
              managementServices.id
            )
          )
          .where(eq(managementServices.deviceId, record.id))
          .orderBy(desc(managementServices.createdAt))

        return {
          ...record,
          vpnIdentity: identity ?? null,
          services: services.map(({ service, credential }) => ({
            ...service,
            hasSavedPassword: Boolean(credential),
          })),
        }
      }),
    update: permissionProcedure("device:update")
      .input(deviceUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        if (input.siteId !== undefined && input.siteId !== null) {
          const [site] = await ctx.db
            .select()
            .from(sites)
            .where(eq(sites.id, input.siteId))

          if (
            !site ||
            !siteBelongsToOrganization(
              site.organizationId,
              existing.organizationId
            )
          ) {
            throw new TRPCError({ code: "BAD_REQUEST" })
          }
        }

        const patch: Record<string, string | null> = {}

        if (input.displayName !== undefined) {
          patch.displayName = input.displayName
        }

        if (input.hostname !== undefined) {
          patch.hostname = input.hostname
        }

        if (input.siteId !== undefined) {
          patch.siteId = input.siteId
        }

        if (Object.keys(patch).length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST" })
        }

        const [record] = await ctx.db
          .update(devices)
          .set(patch)
          .where(eq(devices.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          deviceId: existing.id,
          eventType:
            input.siteId !== undefined
              ? "device_site_assigned"
              : "device_updated",
          eventData: {
            deviceId: existing.id,
            siteId: input.siteId ?? existing.siteId,
            displayName: input.displayName ?? existing.displayName,
            hostname: input.hostname ?? existing.hostname,
          },
        })

        return record ?? null
      }),
    assignRoutePolicy: permissionProcedure("device:update")
      .input(deviceRoutePolicyInput)
      .mutation(async ({ ctx, input }) => {
        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.id))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        if (input.routePolicyId !== null) {
          const [policy] = await ctx.db
            .select()
            .from(routePolicies)
            .where(eq(routePolicies.id, input.routePolicyId))

          if (!policy) {
            throw new TRPCError({ code: "BAD_REQUEST" })
          }
        }

        const [record] = await ctx.db
          .update(vpnIdentities)
          .set({
            routePolicyId: input.routePolicyId,
          })
          .where(eq(vpnIdentities.deviceId, input.id))
          .returning()

        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: device.id,
          eventType: "device_updated",
          eventData: {
            deviceId: device.id,
            routePolicyId: input.routePolicyId,
          },
        })

        return record
      }),
    revokeVpn: permissionProcedure("device:revoke_vpn")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .update(vpnIdentities)
          .set({
            revokedAt: new Date(),
            serverPeerEnabled: false,
          })
          .where(eq(vpnIdentities.deviceId, input.id))
          .returning()

        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          deviceId: input.id,
          eventType: "device_revoked",
          eventData: { revoked: true },
        })

        return record
      }),
    services: permissionProcedure("device:view")
      .input(z.object({ deviceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.deviceId, input.deviceId))
          .orderBy(desc(managementServices.createdAt))
      }),
  }),
  managementServices: createTRPCRouter({
    list: permissionProcedure("device:view")
      .input(z.object({ deviceId: z.string().uuid().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const query = ctx.db
          .select({
            service: managementServices,
            credential: managementServiceCredentials,
          })
          .from(managementServices)
          .leftJoin(
            managementServiceCredentials,
            eq(
              managementServiceCredentials.managementServiceId,
              managementServices.id
            )
          )

        if (input?.deviceId) {
          const rows = await query
            .where(eq(managementServices.deviceId, input.deviceId))
            .orderBy(desc(managementServices.createdAt))

          return rows.map(({ service, credential }) => ({
            ...service,
            hasSavedPassword: Boolean(credential),
          }))
        }

        const rows = await query.orderBy(desc(managementServices.createdAt))

        return rows.map(({ service, credential }) => ({
          ...service,
          hasSavedPassword: Boolean(credential),
        }))
      }),
    create: permissionProcedure("device:update")
      .input(managementServiceCreateInput)
      .mutation(async ({ ctx, input }) => {
        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [existing] = await ctx.db
          .select()
          .from(managementServices)
          .where(
            and(
              eq(managementServices.deviceId, input.deviceId),
              eq(managementServices.serviceType, input.serviceType)
            )
          )

        if (existing) {
          throw new TRPCError({ code: "CONFLICT" })
        }

        const [record] = await ctx.db
          .insert(managementServices)
          .values({
            ...input,
            protocol:
              input.serviceType === "vnc"
                ? vncServiceDefaults.protocol
                : input.protocol,
            port:
              input.serviceType === "vnc"
                ? vncServiceDefaults.port
                : input.port,
          })
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: device.id,
          eventType: "management_service_created",
          eventData: {
            serviceId: record.id,
            serviceType: record.serviceType,
            port: record.port,
          },
        })

        return record
      }),
    update: permissionProcedure("device:update")
      .input(managementServiceUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, existing.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [duplicate] = await ctx.db
          .select()
          .from(managementServices)
          .where(
            and(
              eq(managementServices.deviceId, existing.deviceId),
              eq(managementServices.serviceType, input.serviceType)
            )
          )

        if (duplicate && duplicate.id !== existing.id) {
          throw new TRPCError({ code: "CONFLICT" })
        }

        const [record] = await ctx.db
          .update(managementServices)
          .set({
            serviceType: input.serviceType,
            protocol:
              input.serviceType === "vnc"
                ? vncServiceDefaults.protocol
                : input.protocol,
            port:
              input.serviceType === "vnc"
                ? vncServiceDefaults.port
                : input.port,
            enabled: input.enabled,
          })
          .where(eq(managementServices.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: device.id,
          eventType: "management_service_updated",
          eventData: {
            serviceId: record.id,
            serviceType: record.serviceType,
            port: record.port,
            enabled: record.enabled,
          },
        })

        return record
      }),
    delete: permissionProcedure("device:update")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, existing.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [record] = await ctx.db
          .delete(managementServices)
          .where(eq(managementServices.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: device.id,
          eventType: "management_service_deleted",
          eventData: {
            serviceId: existing.id,
            serviceType: existing.serviceType,
          },
        })

        return record ?? existing
      }),
    setCredential: permissionProcedure("device:update")
      .input(
        z.object({
          id: z.string().uuid(),
          password: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [service] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!service) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        if (service.serviceType !== "vnc") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Saved credentials are only supported for VNC services",
          })
        }

        const encrypted = encryptVncPassword(input.password)

        const [record] = await ctx.db
          .insert(managementServiceCredentials)
          .values({
            managementServiceId: input.id,
            passwordCiphertext: encrypted.ciphertext,
            passwordIv: encrypted.iv,
            passwordAuthTag: encrypted.authTag,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: managementServiceCredentials.managementServiceId,
            set: {
              passwordCiphertext: encrypted.ciphertext,
              passwordIv: encrypted.iv,
              passwordAuthTag: encrypted.authTag,
              updatedAt: new Date(),
            },
          })
          .returning()

        return record
      }),
    setSshCredential: permissionProcedure("device:update")
      .input(
        z.object({
          id: z.string().uuid(),
          username: z.string().min(1),
          privateKey: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [service] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!service) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        if (service.serviceType !== "ssh") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Saved SSH keys are only supported for SSH services",
          })
        }

        const encryptedUsername = encryptRemoteSecret(input.username)
        const encryptedPrivateKey = encryptRemoteSecret(input.privateKey)

        const [record] = await ctx.db
          .insert(managementServiceCredentials)
          .values({
            managementServiceId: input.id,
            passwordCiphertext: encryptedPrivateKey.ciphertext,
            passwordIv: encryptedPrivateKey.iv,
            passwordAuthTag: encryptedPrivateKey.authTag,
            usernameCiphertext: encryptedUsername.ciphertext,
            usernameIv: encryptedUsername.iv,
            usernameAuthTag: encryptedUsername.authTag,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: managementServiceCredentials.managementServiceId,
            set: {
              passwordCiphertext: encryptedPrivateKey.ciphertext,
              passwordIv: encryptedPrivateKey.iv,
              passwordAuthTag: encryptedPrivateKey.authTag,
              usernameCiphertext: encryptedUsername.ciphertext,
              usernameIv: encryptedUsername.iv,
              usernameAuthTag: encryptedUsername.authTag,
              updatedAt: new Date(),
            },
          })
          .returning()

        return record
      }),
    clearCredential: permissionProcedure("device:update")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .delete(managementServiceCredentials)
          .where(eq(managementServiceCredentials.managementServiceId, input.id))
          .returning()

        return record ?? null
      }),
  }),
  routePolicies: createTRPCRouter({
    list: adminProcedure.query(async ({ ctx }) => {
      return ctx.db.select().from(routePolicies).orderBy(routePolicies.name)
    }),
    create: permissionProcedure("organization:admin")
      .input(routePolicyCreateInput)
      .mutation(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .insert(routePolicies)
          .values({
            name: input.name,
            routes: normalizeRouteValues(input.routes),
            description: input.description ?? null,
          })
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          eventType: "route_policy_created",
          eventData: {
            routePolicyId: record.id,
            name: record.name,
          },
        })

        return record
      }),
    update: permissionProcedure("organization:admin")
      .input(routePolicyUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .update(routePolicies)
          .set({
            name: input.name,
            routes: normalizeRouteValues(input.routes),
            description: input.description ?? null,
          })
          .where(eq(routePolicies.id, input.id))
          .returning()

        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          eventType: "route_policy_updated",
          eventData: {
            routePolicyId: record.id,
            name: record.name,
          },
        })

        return record
      }),
    delete: permissionProcedure("organization:admin")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .delete(routePolicies)
          .where(eq(routePolicies.id, input.id))
          .returning()

        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          eventType: "route_policy_deleted",
          eventData: {
            routePolicyId: record.id,
            name: record.name,
          },
        })

        return record
      }),
  }),
  enrollmentTokens: createTRPCRouter({
    list: adminProcedure.query(async ({ ctx }) => {
      return ctx.db
        .select({
          id: enrollmentTokens.id,
          organizationId: enrollmentTokens.organizationId,
          siteId: enrollmentTokens.siteId,
          siteWide: enrollmentTokens.siteWide,
          routePolicyId: enrollmentTokens.routePolicyId,
          expiresAt: enrollmentTokens.expiresAt,
          maxUses: enrollmentTokens.maxUses,
          uses: enrollmentTokens.uses,
          createdAt: enrollmentTokens.createdAt,
          organizationName: organizations.name,
          siteName: sites.name,
          routePolicyName: routePolicies.name,
        })
        .from(enrollmentTokens)
        .leftJoin(
          organizations,
          eq(organizations.id, enrollmentTokens.organizationId)
        )
        .leftJoin(sites, eq(sites.id, enrollmentTokens.siteId))
        .leftJoin(
          routePolicies,
          eq(routePolicies.id, enrollmentTokens.routePolicyId)
        )
        .orderBy(desc(enrollmentTokens.createdAt))
    }),
    create: permissionProcedure("device:enroll")
      .input(enrollmentTokenInput)
      .mutation(async ({ ctx, input }) => {
        if (input.siteWide && !input.siteId) {
          throw new TRPCError({ code: "BAD_REQUEST" })
        }

        if (input.siteWide && input.siteId) {
          const activeTokens = await ctx.db
            .select({
              id: enrollmentTokens.id,
              expiresAt: enrollmentTokens.expiresAt,
            })
            .from(enrollmentTokens)
            .where(
              and(
                eq(enrollmentTokens.siteId, input.siteId),
                eq(enrollmentTokens.siteWide, true)
              )
            )

          const hasActiveToken = activeTokens.some(
            (token) => token.expiresAt.getTime() > Date.now()
          )

          if (hasActiveToken) {
            throw new TRPCError({ code: "CONFLICT" })
          }
        }

        const rawToken = makeEnrollmentToken()
        const tokenHash = hashEnrollmentToken(rawToken)

        const [record] = await ctx.db
          .insert(enrollmentTokens)
          .values({
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            siteWide: input.siteWide,
            routePolicyId: input.routePolicyId ?? null,
            expiresAt: input.expiresAt,
            maxUses: input.maxUses,
            tokenHash,
            createdByUserId: ctx.actor?.id ?? null,
          })
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: input.organizationId,
          eventType: "enrollment_token_created",
          eventData: { tokenId: record.id },
        })

        return {
          token: rawToken,
          enrollmentToken: record,
        }
      }),
    update: permissionProcedure("device:enroll")
      .input(enrollmentTokenUpdateSchema)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(enrollmentTokens)
          .where(eq(enrollmentTokens.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        if (input.siteWide && !input.siteId) {
          throw new TRPCError({ code: "BAD_REQUEST" })
        }

        if (input.siteId) {
          const [site] = await ctx.db
            .select()
            .from(sites)
            .where(eq(sites.id, input.siteId))

          if (
            !site ||
            !siteBelongsToOrganization(
              site.organizationId,
              input.organizationId
            )
          ) {
            throw new TRPCError({ code: "BAD_REQUEST" })
          }
        }

        if (input.siteWide && input.siteId) {
          const activeTokens = await ctx.db
            .select({
              id: enrollmentTokens.id,
              expiresAt: enrollmentTokens.expiresAt,
            })
            .from(enrollmentTokens)
            .where(
              and(
                eq(enrollmentTokens.siteId, input.siteId),
                eq(enrollmentTokens.siteWide, true)
              )
            )

          const hasActiveToken = activeTokens.some(
            (token) =>
              token.id !== input.id && token.expiresAt.getTime() > Date.now()
          )

          if (hasActiveToken) {
            throw new TRPCError({ code: "CONFLICT" })
          }
        }

        const [record] = await ctx.db
          .update(enrollmentTokens)
          .set({
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            siteWide: input.siteWide,
            routePolicyId: input.routePolicyId ?? null,
            expiresAt: input.expiresAt,
            maxUses: input.maxUses,
          })
          .where(eq(enrollmentTokens.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: input.organizationId,
          eventType: "enrollment_token_updated",
          eventData: {
            tokenId: record.id,
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            siteWide: input.siteWide,
            routePolicyId: input.routePolicyId ?? null,
            expiresAt: input.expiresAt.toISOString(),
            maxUses: input.maxUses,
          },
        })

        return record
      }),
    revoke: permissionProcedure("device:enroll")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .delete(enrollmentTokens)
          .where(eq(enrollmentTokens.id, input.id))
          .returning()

        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: record.organizationId,
          eventType: "enrollment_token_revoked",
          eventData: {
            tokenId: record.id,
          },
        })

        return record
      }),
  }),
  audit: createTRPCRouter({
    list: permissionProcedure("audit:view")
      .input(auditListInput)
      .query(async ({ ctx, input }) => {
        const filters = []

        if (input.organizationId) {
          filters.push(eq(auditEvents.organizationId, input.organizationId))
        }

        if (input.deviceId) {
          filters.push(eq(auditEvents.deviceId, input.deviceId))
        }

        const query = ctx.db.select().from(auditEvents)

        return filters.length > 0
          ? query.where(and(...filters)).orderBy(desc(auditEvents.createdAt))
          : query.orderBy(desc(auditEvents.createdAt))
      }),
  }),
  sessions: createTRPCRouter({
    create: permissionProcedure("device:view")
      .input(sessionCreateInput)
      .mutation(async ({ ctx, input }) => {
        const [serviceRow] = await ctx.db
          .select({
            service: managementServices,
            credential: managementServiceCredentials,
          })
          .from(managementServices)
          .leftJoin(
            managementServiceCredentials,
            eq(
              managementServiceCredentials.managementServiceId,
              managementServices.id
            )
          )
          .where(eq(managementServices.id, input.serviceId))

        if (!serviceRow) {
          return null
        }

        const { service, credential } = serviceRow
        const requiredPermission = permissionForServiceType(
          service.serviceType as "vnc" | "rdp" | "ssh" | "winrm_https"
        )

        if (!ctx.actor?.permissions.includes(requiredPermission)) {
          throw new TRPCError({ code: "FORBIDDEN" })
        }

        if (service.serviceType !== "vnc" && service.serviceType !== "ssh") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This launch path only supports VNC and SSH services",
          })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [identity] = await ctx.db
          .select()
          .from(vpnIdentities)
          .where(eq(vpnIdentities.deviceId, device.id))

        if (!identity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Device is not connected",
          })
        }

        if (service.deviceId !== device.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Service does not belong to the selected device",
          })
        }

        const password =
          service.serviceType === "vnc"
            ? decodePasswordRecord(credential)
            : null
        const sshCredential =
          service.serviceType === "ssh"
            ? decodeSshCredentialRecord(credential)
            : { username: null, privateKey: null }

        const launchId = randomUUID()

        const session = await guacamoleProvider.createSession({
          deviceId: device.id,
          serviceId: service.id,
          serviceType: service.serviceType,
          adminUserId: ctx.actor?.id ?? "",
          connectionMethod: input.connectionMethod,
          hostname: String(identity.vpnIpv4),
          port: service.port,
          password,
          username: sshCredential.username,
          privateKey: sshCredential.privateKey,
          launchId,
        })

        const launchUrl = new URL(
          "/api/guacamole/launch",
          process.env.APP_BASE_URL ??
            process.env.BETTER_AUTH_URL ??
            "http://localhost:3000"
        )
        launchUrl.searchParams.set("target", session.url)

        const [record] = await ctx.db
          .insert(remoteSessions)
          .values({
            adminUserId: ctx.actor?.id ?? "",
            deviceId: device.id,
            managementServiceId: input.serviceId,
            status: "starting",
            connectionMethod: input.connectionMethod,
            auditMetadata: {
              requestedBy: ctx.actor?.email,
              serviceType: service.serviceType,
              guacamoleSessionId: session.sessionId,
              guacamoleLaunchId: launchId,
            },
          })
          .returning()

        return {
          session: record,
          url: launchUrl.toString(),
        }
      }),
  }),
})

export type AppRouter = typeof appRouter
