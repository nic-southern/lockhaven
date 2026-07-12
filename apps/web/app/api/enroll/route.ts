import { createHash, randomBytes } from "node:crypto"

import {
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
  decryptSecret,
  encryptSecret,
  generateSiteSshKeyPair,
  type EncryptedSecret,
} from "@nms/remote-access"
import { enrollmentRequestSchema, enrollmentResponseSchema } from "@nms/shared"
import { allocateVpnIpv4, buildClientAllowedIps } from "@nms/vpn"

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

function hashEnrollmentToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function hashDeviceSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}

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

export async function POST(request: Request) {
  const parsed = enrollmentRequestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid enrollment request" },
      { status: 400 }
    )
  }

  const input = parsed.data
  const tokenHash = hashEnrollmentToken(input.token)
  const checkInSecret = randomBytes(32).toString("base64url")
  const checkInSecretHash = hashDeviceSecret(checkInSecret)
  const requestsSsh = input.services.some((service) => service.type === "ssh")

  if (!env.vpnServerPublicKey) {
    return Response.json(
      { error: "VPN server key is not configured" },
      { status: 500 }
    )
  }

  if (requestsSsh && !env.remoteCredentialsKey) {
    return Response.json(
      { error: "Remote credential secret is not configured" },
      { status: 500 }
    )
  }

  const result = await db.transaction(async (tx: TransactionClient) => {
    const [token] = await tx
      .select()
      .from(enrollmentTokens)
      .where(eq(enrollmentTokens.tokenHash, tokenHash))

    if (
      !token ||
      (!token.siteWide && token.uses >= token.maxUses) ||
      (token.expiresAt !== null && token.expiresAt.getTime() <= Date.now())
    ) {
      return null
    }

    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, token.organizationId))

    if (!organization) {
      return null
    }

    const existingIps = (
      await tx.select({ vpnIpv4: vpnIdentities.vpnIpv4 }).from(vpnIdentities)
    ).map((row: { vpnIpv4: string }) => row.vpnIpv4)
    const routePolicyRoutes = token.routePolicyId
      ? ((
          await tx
            .select({ routes: routePolicies.routes })
            .from(routePolicies)
            .where(eq(routePolicies.id, token.routePolicyId))
        )[0]?.routes ?? [])
      : []

    let sshAccess: { username: string; publicKey: string } | null = null
    let sshPrivateKey: string | null = null

    if (requestsSsh && env.remoteCredentialsKey) {
      if (token.siteId) {
        const [siteCredential] = await tx
          .select()
          .from(siteSshCredentials)
          .where(eq(siteSshCredentials.siteId, token.siteId))

        if (siteCredential) {
          const decoded = decodeStoredSshCredential(
            siteCredential,
            env.remoteCredentialsKey
          )
          sshAccess = {
            username: decoded.username,
            publicKey: decoded.publicKey,
          }
          sshPrivateKey = decoded.privateKey
        }
      } else {
        const organizationCredential =
          await ensureOrganizationSshCredentialInTx(
            tx,
            organization,
            env.remoteCredentialsKey
          )
        const decoded = decodeStoredSshCredential(
          organizationCredential,
          env.remoteCredentialsKey
        )
        sshAccess = {
          username: decoded.username,
          publicKey: decoded.publicKey,
        }
        sshPrivateKey = decoded.privateKey
      }

      if (!sshAccess || !sshPrivateKey) {
        const organizationCredential =
          await ensureOrganizationSshCredentialInTx(
            tx,
            organization,
            env.remoteCredentialsKey
          )
        const decoded = decodeStoredSshCredential(
          organizationCredential,
          env.remoteCredentialsKey
        )
        sshAccess = {
          username: decoded.username,
          publicKey: decoded.publicKey,
        }
        sshPrivateKey = decoded.privateKey
      }
    }

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

    for (const service of input.services) {
      const [createdService] = await tx
        .insert(managementServices)
        .values({
          deviceId: device.id,
          serviceType: service.type,
          protocol: service.protocol,
          port: service.port,
        })
        .returning()

      if (
        service.type === "ssh" &&
        sshAccess &&
        sshPrivateKey &&
        env.remoteCredentialsKey
      ) {
        await tx.insert(managementServiceCredentials).values({
          managementServiceId: createdService.id,
          ...buildEncryptedSshCredentialFields(
            sshAccess.username,
            sshPrivateKey,
            env.remoteCredentialsKey
          ),
        })
      }
    }

    await tx
      .update(enrollmentTokens)
      .set({ uses: token.uses + 1 })
      .where(eq(enrollmentTokens.id, token.id))

    await tx.insert(auditEvents).values({
      organizationId: token.organizationId,
      deviceId: device.id,
      eventType: "device_enrolled",
      eventData: {
        vpnIpv4,
        serviceCount: input.services.length,
        organization: organization.name,
        sshProvisioned: Boolean(sshAccess),
        imagingSsh: !token.siteId && Boolean(sshAccess),
      },
    })

    return { device, identity, routePolicyRoutes, sshAccess }
  })

  if (!result) {
    return Response.json(
      { error: "Enrollment token not found" },
      { status: 404 }
    )
  }

  const response = enrollmentResponseSchema.parse({
    device_id: result.device.id,
    vpn_ipv4: result.identity.vpnIpv4,
    check_in_secret: checkInSecret,
    wireguard: {
      server_public_key: env.vpnServerPublicKey,
      endpoint: `${env.vpnPublicHostname}:${env.vpnPublicPort}`,
      allowed_ips: buildClientAllowedIps({
        serverIp: env.vpnServerIp,
        routePolicyRoutes: result.routePolicyRoutes,
      }),
      persistent_keepalive: 25,
    },
    ssh: result.sshAccess
      ? {
          username: result.sshAccess.username,
          public_key: result.sshAccess.publicKey,
        }
      : null,
  })

  return Response.json(response)
}
