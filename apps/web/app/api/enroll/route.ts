import { randomBytes } from "node:crypto"

import { and, ne } from "drizzle-orm"

import {
  adminVpnProfiles,
  auditEvents,
  devices,
  enrollmentTokens,
  eq,
  managementServiceCredentials,
  managementServices,
  organizations,
  organizationSshCredentials,
  routePolicies,
  siteSshCredentials,
  vpnIdentities,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  requestInfoFromHeaders,
  upsertAssetFromDeviceReport,
} from "@nms/api-contract"
import {
  decryptSecret,
  encryptSecret,
  generateSiteSshKeyPair,
  type EncryptedSecret,
} from "@nms/remote-access"
import {
  enrollmentIntentFromMatch,
  enrollmentRequestSchema,
  enrollmentResponseSchema,
  severityForEvent,
  shouldAdoptHardwareSerial,
} from "@nms/shared"
import { allocateVpnIpv4 } from "@nms/vpn"

import { hashAgentSecret } from "@/lib/agent-secret"
import {
  clientVpnSettings,
  loadAttachCandidates,
  matchForToken,
} from "@/lib/agent-attach"
import {
  enrollmentConflictResponse,
  isEnrollmentConflictReason,
  reenrollAuditEventData,
  vpnIdentityReenrollPatch,
} from "@/lib/device-reenroll"
import {
  addressKey,
  enforceRateLimit,
  rateLimitPolicies,
} from "@/lib/rate-limit-server"

const env = {
  vpnServerPublicKey: process.env.VPN_SERVER_PUBLIC_KEY,
  vpnPublicHostname: process.env.VPN_PUBLIC_HOSTNAME ?? "vpn.example.com",
  vpnPublicPort: Number(process.env.VPN_PUBLIC_PORT ?? 51820),
  vpnServerIp: process.env.VPN_SERVER_IP ?? "10.80.0.1",
  remoteCredentialsKey: process.env.REMOTE_CREDENTIALS_KEY,
}

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

function encryptRemoteSecret(secret: string, credentialSecret: string) {
  return encryptSecret(secret, credentialSecret)
}

function decryptRemoteSecret(
  payload: EncryptedSecret,
  credentialSecret: string
) {
  return decryptSecret(payload, credentialSecret)
}

function buildEncryptedSshCredentialFields(
  username: string,
  privateKey: string,
  credentialSecret: string
) {
  const encryptedUsername = encryptRemoteSecret(username, credentialSecret)
  const encryptedPrivateKey = encryptRemoteSecret(privateKey, credentialSecret)

  return {
    passwordCiphertext: encryptedPrivateKey.ciphertext,
    passwordIv: encryptedPrivateKey.iv,
    passwordAuthTag: encryptedPrivateKey.authTag,
    usernameCiphertext: encryptedUsername.ciphertext,
    usernameIv: encryptedUsername.iv,
    usernameAuthTag: encryptedUsername.authTag,
  }
}

function decodeStoredSshCredential(
  record: {
    usernameCiphertext: string
    usernameIv: string
    usernameAuthTag: string
    passwordCiphertext: string
    passwordIv: string
    passwordAuthTag: string
    publicKey: string
  },
  credentialSecret: string
) {
  return {
    username: decryptRemoteSecret(
      {
        ciphertext: record.usernameCiphertext,
        iv: record.usernameIv,
        authTag: record.usernameAuthTag,
      },
      credentialSecret
    ),
    privateKey: decryptRemoteSecret(
      {
        ciphertext: record.passwordCiphertext,
        iv: record.passwordIv,
        authTag: record.passwordAuthTag,
      },
      credentialSecret
    ),
    publicKey: record.publicKey,
  }
}

async function ensureOrganizationSshCredentialInTx(
  tx: TransactionClient,
  organization: { id: string; name: string },
  credentialSecret: string
) {
  const [existing] = await tx
    .select()
    .from(organizationSshCredentials)
    .where(eq(organizationSshCredentials.organizationId, organization.id))

  if (existing) {
    return existing
  }

  const keyPair = generateSiteSshKeyPair(
    organization.name.replaceAll(/\s+/g, "-").toLowerCase()
  )
  const fields = buildEncryptedSshCredentialFields(
    "root",
    keyPair.privateKey,
    credentialSecret
  )

  const [record] = await tx
    .insert(organizationSshCredentials)
    .values({
      organizationId: organization.id,
      ...fields,
      publicKey: keyPair.publicKey,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: organizationSshCredentials.organizationId,
      set: {
        ...fields,
        publicKey: keyPair.publicKey,
        updatedAt: new Date(),
      },
    })
    .returning()

  return record
}

type EnrollmentRejection = {
  reason:
    | "invalid_request"
    | "token_not_found"
    | "token_exhausted"
    | "token_expired"
    | "organization_missing"
    | "ambiguous"
    | "hostname_conflict"
    | "revoked"
    | "out_of_scope"
    | "wireguard_key_in_use"
  organizationId?: string | null
  siteId?: string | null
  tokenId?: string | null
}

type EnrollmentService = {
  type: "vnc" | "rdp" | "ssh" | "winrm_https"
  protocol: string
  port: number
  password?: string
}

type SshAccess = { username: string; publicKey: string }

async function resolveEnrollmentSsh(
  tx: TransactionClient,
  token: { siteId: string | null },
  organization: { id: string; name: string },
  credentialSecret: string
): Promise<{ sshAccess: SshAccess; sshPrivateKey: string } | null> {
  if (token.siteId) {
    const [siteCredential] = await tx
      .select()
      .from(siteSshCredentials)
      .where(eq(siteSshCredentials.siteId, token.siteId))

    if (siteCredential) {
      const decoded = decodeStoredSshCredential(
        siteCredential,
        credentialSecret
      )
      return {
        sshAccess: {
          username: decoded.username,
          publicKey: decoded.publicKey,
        },
        sshPrivateKey: decoded.privateKey,
      }
    }
  }

  const organizationCredential = await ensureOrganizationSshCredentialInTx(
    tx,
    organization,
    credentialSecret
  )
  const decoded = decodeStoredSshCredential(
    organizationCredential,
    credentialSecret
  )
  return {
    sshAccess: {
      username: decoded.username,
      publicKey: decoded.publicKey,
    },
    sshPrivateKey: decoded.privateKey,
  }
}

async function upsertServiceCredentials(
  tx: TransactionClient,
  managementServiceId: string,
  fields: {
    passwordCiphertext: string
    passwordIv: string
    passwordAuthTag: string
    usernameCiphertext?: string
    usernameIv?: string
    usernameAuthTag?: string
  }
) {
  const [existing] = await tx
    .select({ id: managementServiceCredentials.id })
    .from(managementServiceCredentials)
    .where(
      eq(managementServiceCredentials.managementServiceId, managementServiceId)
    )

  if (existing) {
    await tx
      .update(managementServiceCredentials)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(managementServiceCredentials.id, existing.id))
    return
  }

  await tx.insert(managementServiceCredentials).values({
    managementServiceId,
    ...fields,
  })
}

async function syncEnrollmentServices(
  tx: TransactionClient,
  deviceId: string,
  services: EnrollmentService[],
  sshAccess: SshAccess | null,
  sshPrivateKey: string | null,
  credentialSecret: string | undefined
) {
  const existing = await tx
    .select()
    .from(managementServices)
    .where(eq(managementServices.deviceId, deviceId))

  for (const service of services) {
    const current =
      existing.find((row) => row.serviceType === service.type) ?? null
    const record =
      current ??
      (
        await tx
          .insert(managementServices)
          .values({
            deviceId,
            serviceType: service.type,
            protocol: service.protocol,
            port: service.port,
          })
          .returning()
      )[0]

    if (current) {
      await tx
        .update(managementServices)
        .set({
          protocol: service.protocol,
          port: service.port,
        })
        .where(eq(managementServices.id, current.id))
    }

    if (
      service.type === "ssh" &&
      sshAccess &&
      sshPrivateKey &&
      credentialSecret
    ) {
      await upsertServiceCredentials(
        tx,
        record.id,
        buildEncryptedSshCredentialFields(
          sshAccess.username,
          sshPrivateKey,
          credentialSecret
        )
      )
    }

    if (
      (service.type === "vnc" || service.type === "rdp") &&
      service.password &&
      credentialSecret
    ) {
      const encrypted = encryptRemoteSecret(service.password, credentialSecret)
      await upsertServiceCredentials(tx, record.id, {
        passwordCiphertext: encrypted.ciphertext,
        passwordIv: encrypted.iv,
        passwordAuthTag: encrypted.authTag,
      })
    }
  }
}

async function recordEnrollmentFailure(
  request: Request,
  rejection: EnrollmentRejection,
  extra: Record<string, unknown> = {}
) {
  const info = requestInfoFromHeaders(request.headers)
  await db.insert(auditEvents).values({
    organizationId: rejection.organizationId ?? null,
    siteId: rejection.siteId ?? null,
    eventType: "device_enroll_failed",
    severity: severityForEvent("device_enroll_failed"),
    actorIp: info.ipAddress,
    userAgent: info.userAgent,
    eventData: {
      reason: rejection.reason,
      tokenId: rejection.tokenId ?? null,
      ...extra,
    },
  })
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as unknown
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(
    `enroll:ip:${addressKey(request.headers)}`,
    rateLimitPolicies.enrollPerAddress,
    "Too many enrollment attempts from this address. Try again in a minute."
  )
  if (limited) return limited

  const parsed = enrollmentRequestSchema.safeParse(await readJson(request))

  if (!parsed.success) {
    await recordEnrollmentFailure(request, { reason: "invalid_request" })
    return Response.json(
      { error: "Invalid enrollment request" },
      { status: 400 }
    )
  }

  const input = parsed.data
  const tokenHash = hashAgentSecret(input.token)
  const checkInSecret = randomBytes(32).toString("base64url")
  const checkInSecretHash = hashAgentSecret(checkInSecret)
  const requestsSsh = input.services.some((service) => service.type === "ssh")
  const requestsPasswordService = input.services.some(
    (service) =>
      (service.type === "vnc" || service.type === "rdp") &&
      Boolean(service.password)
  )

  if (!env.vpnServerPublicKey) {
    return Response.json(
      { error: "VPN server key is not configured" },
      { status: 500 }
    )
  }

  if ((requestsSsh || requestsPasswordService) && !env.remoteCredentialsKey) {
    return Response.json(
      { error: "Remote credential secret is not configured" },
      { status: 500 }
    )
  }

  let rejection: EnrollmentRejection | null = null

  const result = await db.transaction(async (tx: TransactionClient) => {
    const [token] = await tx
      .select()
      .from(enrollmentTokens)
      .where(eq(enrollmentTokens.tokenHash, tokenHash))

    if (!token) {
      rejection = { reason: "token_not_found" }
      return null
    }

    const tokenScope = {
      organizationId: token.organizationId,
      siteId: token.siteId ?? null,
      tokenId: token.id,
    }

    if (!token.siteWide && token.uses >= token.maxUses) {
      rejection = { reason: "token_exhausted", ...tokenScope }
      return null
    }

    if (token.expiresAt !== null && token.expiresAt.getTime() <= Date.now()) {
      rejection = { reason: "token_expired", ...tokenScope }
      return null
    }

    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, token.organizationId))

    if (!organization) {
      rejection = { reason: "organization_missing", ...tokenScope }
      return null
    }

    const attachIdentity = {
      hostname: input.hostname,
      serialNumber: input.serial_number,
      wireguardPublicKey: input.wireguard_public_key,
    }
    const intent = enrollmentIntentFromMatch(
      matchForToken(
        await loadAttachCandidates(
          tx,
          token.organizationId,
          attachIdentity,
          token.siteId
        ),
        attachIdentity,
        token
      )
    )
    if (intent.action === "reject") {
      rejection = { reason: intent.reason, ...tokenScope }
      return null
    }

    async function loadRoutePolicyRoutes(routePolicyId: string | null) {
      if (!routePolicyId) return [] as string[]
      return (
        (
          await tx
            .select({ routes: routePolicies.routes })
            .from(routePolicies)
            .where(eq(routePolicies.id, routePolicyId))
        )[0]?.routes ?? []
      )
    }

    let sshAccess: SshAccess | null = null
    let sshPrivateKey: string | null = null
    if (requestsSsh && env.remoteCredentialsKey) {
      const resolved = await resolveEnrollmentSsh(
        tx,
        token,
        organization,
        env.remoteCredentialsKey
      )
      if (resolved) {
        sshAccess = resolved.sshAccess
        sshPrivateKey = resolved.sshPrivateKey
      }
    }

    const requestInfo = requestInfoFromHeaders(request.headers)

    if (intent.action === "reenroll") {
      const [device] = await tx
        .select()
        .from(devices)
        .where(eq(devices.id, intent.deviceId))
      if (!device) {
        rejection = { reason: "token_not_found", ...tokenScope }
        return null
      }

      const [vpnTaken] = await tx
        .select({ deviceId: vpnIdentities.deviceId })
        .from(vpnIdentities)
        .where(
          and(
            eq(vpnIdentities.wireguardPublicKey, input.wireguard_public_key),
            ne(vpnIdentities.deviceId, device.id)
          )
        )
      const [adminTaken] = await tx
        .select({ id: adminVpnProfiles.id })
        .from(adminVpnProfiles)
        .where(
          eq(adminVpnProfiles.wireguardPublicKey, input.wireguard_public_key)
        )
      if (vpnTaken || adminTaken) {
        rejection = { reason: "wireguard_key_in_use", ...tokenScope }
        return null
      }

      const now = new Date()
      const nextSerial = shouldAdoptHardwareSerial(
        device.serialNumber,
        input.serial_number
      )
        ? input.serial_number
        : (device.serialNumber ?? input.serial_number)
      const [updatedDevice] = await tx
        .update(devices)
        .set({
          hostname: input.hostname,
          osFamily: input.os_family,
          osVersion: input.os_version,
          architecture: input.architecture,
          serialNumber: nextSerial,
          checkInSecretHash,
          status: "enrolled",
          updatedAt: now,
        })
        .where(eq(devices.id, device.id))
        .returning()

      const [existingIdentity] = await tx
        .select()
        .from(vpnIdentities)
        .where(eq(vpnIdentities.deviceId, device.id))

      let identity = existingIdentity
      if (existingIdentity) {
        const patch = vpnIdentityReenrollPatch({
          vpnIpv4: existingIdentity.vpnIpv4,
          nextPublicKey: input.wireguard_public_key,
        })
        const [updatedIdentity] = await tx
          .update(vpnIdentities)
          .set(patch)
          .where(eq(vpnIdentities.id, existingIdentity.id))
          .returning()
        identity = updatedIdentity ?? existingIdentity
      } else {
        const existingIps = (
          await tx
            .select({ vpnIpv4: vpnIdentities.vpnIpv4 })
            .from(vpnIdentities)
        ).map((row: { vpnIpv4: string }) => row.vpnIpv4)
        const [createdIdentity] = await tx
          .insert(vpnIdentities)
          .values({
            deviceId: device.id,
            vpnIpv4: allocateVpnIpv4(existingIps, input.os_family),
            wireguardPublicKey: input.wireguard_public_key,
            routePolicyId: token.routePolicyId,
          })
          .returning()
        identity = createdIdentity
      }

      await syncEnrollmentServices(
        tx,
        device.id,
        input.services,
        sshAccess,
        sshPrivateKey,
        env.remoteCredentialsKey
      )

      await tx
        .update(enrollmentTokens)
        .set({ uses: token.uses + 1 })
        .where(eq(enrollmentTokens.id, token.id))

      await tx.insert(auditEvents).values({
        organizationId: token.organizationId,
        siteId: token.siteId ?? null,
        deviceId: device.id,
        eventType: "device_reenrolled",
        severity: severityForEvent("device_reenrolled"),
        actorIp: requestInfo.ipAddress,
        userAgent: requestInfo.userAgent,
        eventData: reenrollAuditEventData({
          tokenId: token.id,
          matchReason: intent.matchReason,
          vpnIpv4: identity.vpnIpv4,
          oldPublicKey: existingIdentity?.wireguardPublicKey ?? "",
          newPublicKey: input.wireguard_public_key,
          organization: organization.name,
        }),
      })

      const enrolled = updatedDevice ?? device
      await upsertAssetFromDeviceReport(tx, {
        id: enrolled.id,
        organizationId: enrolled.organizationId,
        siteId: enrolled.siteId,
        assetId: enrolled.assetId,
        serialNumber: enrolled.serialNumber,
        hostname: enrolled.hostname,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
      })

      return {
        device: enrolled,
        identity,
        routePolicyRoutes: await loadRoutePolicyRoutes(identity.routePolicyId),
        sshAccess,
      }
    }

    const existingIps = (
      await tx.select({ vpnIpv4: vpnIdentities.vpnIpv4 }).from(vpnIdentities)
    ).map((row: { vpnIpv4: string }) => row.vpnIpv4)
    const routePolicyRoutes = await loadRoutePolicyRoutes(token.routePolicyId)
    const vpnIpv4 = allocateVpnIpv4(existingIps, input.os_family)
    const [device] = await tx
      .insert(devices)
      .values({
        organizationId: token.organizationId,
        siteId: token.siteId ?? null,
        hostname: input.hostname,
        displayName: input.hostname,
        osFamily: input.os_family,
        osVersion: input.os_version,
        architecture: input.architecture,
        serialNumber: input.serial_number,
        checkInSecretHash,
        status: "enrolled",
      })
      .returning()

    const [identity] = await tx
      .insert(vpnIdentities)
      .values({
        deviceId: device.id,
        vpnIpv4,
        wireguardPublicKey: input.wireguard_public_key,
        routePolicyId: token.routePolicyId,
      })
      .returning()

    await syncEnrollmentServices(
      tx,
      device.id,
      input.services,
      sshAccess,
      sshPrivateKey,
      env.remoteCredentialsKey
    )

    await tx
      .update(enrollmentTokens)
      .set({ uses: token.uses + 1 })
      .where(eq(enrollmentTokens.id, token.id))

    await tx.insert(auditEvents).values({
      organizationId: token.organizationId,
      siteId: token.siteId ?? null,
      deviceId: device.id,
      eventType: "device_enrolled",
      actorIp: requestInfo.ipAddress,
      userAgent: requestInfo.userAgent,
      eventData: {
        tokenId: token.id,
        vpnIpv4,
        serviceCount: input.services.length,
        organization: organization.name,
        sshProvisioned: Boolean(sshAccess),
        imagingSsh: !token.siteId && Boolean(sshAccess),
      },
    })

    await upsertAssetFromDeviceReport(tx, {
      id: device.id,
      organizationId: device.organizationId,
      siteId: device.siteId,
      assetId: device.assetId,
      serialNumber: device.serialNumber,
      hostname: device.hostname,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
    })

    return { device, identity, routePolicyRoutes, sshAccess }
  })

  if (!result) {
    const failed: EnrollmentRejection = rejection ?? {
      reason: "token_not_found",
    }
    await recordEnrollmentFailure(request, failed, {
      hostname: input.hostname,
      osFamily: input.os_family,
    })
    if (isEnrollmentConflictReason(failed.reason)) {
      const conflict = enrollmentConflictResponse(failed.reason)
      return Response.json(conflict.body, { status: conflict.status })
    }
    return Response.json(
      { error: "Enrollment token not found" },
      { status: 404 }
    )
  }

  const vpn = clientVpnSettings(result.routePolicyRoutes)
  if (!vpn) {
    return Response.json(
      { error: "VPN server key is not configured" },
      { status: 500 }
    )
  }

  const response = enrollmentResponseSchema.parse({
    device_id: result.device.id,
    vpn_ipv4: result.identity.vpnIpv4,
    check_in_secret: checkInSecret,
    wireguard: vpn,
    ssh: result.sshAccess
      ? {
          username: result.sshAccess.username,
          public_key: result.sshAccess.publicKey,
        }
      : null,
  })

  return Response.json(response)
}
