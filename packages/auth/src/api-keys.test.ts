import assert from "node:assert/strict"
import { test } from "node:test"

import {
  actorForApiKey,
  authorize,
  intersectPermissions,
  permissionsForRole,
  type ActorPrincipal,
} from "./access"
import {
  apiKeyAccessState,
  apiKeyLookupPrefix,
  generateApiKeySecret,
  hashApiKeySecret,
  isApiKeySecretFormat,
  parseBearerToken,
  verifyApiKeySecret,
} from "./api-keys"

function ownerActor(overrides: Partial<ActorPrincipal> = {}): ActorPrincipal {
  const permissions = permissionsForRole("owner")
  return {
    id: "user-owner",
    email: "owner@example.com",
    name: "Owner",
    platformRole: "owner",
    platformPermissions: permissions,
    permissions,
    organizationMemberships: [],
    siteMemberships: [],
    ...overrides,
  }
}

test("hashes secrets and looks them up by prefix", () => {
  const secret = generateApiKeySecret()
  assert.equal(isApiKeySecretFormat(secret), true)
  const prefix = apiKeyLookupPrefix(secret)
  assert.equal(prefix.startsWith("lhv_"), true)
  assert.equal(prefix.length, 12)
  assert.equal(prefix, secret.slice(0, 12))

  const hash = hashApiKeySecret(secret)
  assert.equal(verifyApiKeySecret(secret, hash), true)
  assert.equal(verifyApiKeySecret(`${secret}x`, hash), false)
  assert.notEqual(hash, secret)
})

test("parses bearer tokens and rejects missing headers", () => {
  assert.equal(parseBearerToken("Bearer lhv_example"), "lhv_example")
  assert.equal(parseBearerToken("bearer lhv_example"), "lhv_example")
  assert.equal(parseBearerToken("Basic abc"), null)
  assert.equal(parseBearerToken(null), null)
})

test("permission intersection keeps only grants the owner holds", () => {
  assert.deepEqual(
    intersectPermissions(
      ["device:view", "device:update", "audit:view"],
      ["device:view", "device:delete", "device:view"]
    ),
    ["device:view"]
  )
})

test("org-scoped keys do not inherit platform-wide access", () => {
  const actor = actorForApiKey(ownerActor(), {
    id: "key-1",
    organizationId: "org-1",
    permissions: ["device:view"],
  })
  assert.equal(actor.apiKeyId, "key-1")
  assert.equal(actor.platformRole, "member")
  assert.deepEqual(actor.permissions, ["device:view"])
  assert.equal(actor.organizationMemberships[0]?.organizationId, "org-1")
  assert.equal(
    authorize(actor, "device:view", {
      kind: "device",
      organizationId: "org-1",
      siteId: null,
    }).allowed,
    true
  )
  assert.equal(
    authorize(actor, "device:delete", {
      kind: "device",
      organizationId: "org-1",
      siteId: null,
    }).allowed,
    false
  )
})

test("platform owner keys still cannot exceed the grant set", () => {
  const actor = actorForApiKey(ownerActor(), {
    id: "key-2",
    organizationId: null,
    permissions: ["device:view"],
  })
  assert.equal(actor.platformRole, "owner")
  assert.equal(
    authorize(actor, "device:view", {
      kind: "device",
      organizationId: "org-9",
      siteId: null,
    }).allowed,
    true
  )
  assert.equal(
    authorize(actor, "organization:admin", { kind: "platform" }).allowed,
    false
  )
})

test("expired and revoked keys are rejected", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")
  assert.equal(
    apiKeyAccessState({ revokedAt: null, expiresAt: null }, now),
    "ok"
  )
  assert.equal(
    apiKeyAccessState(
      { revokedAt: new Date("2026-09-16T11:00:00.000Z"), expiresAt: null },
      now
    ),
    "revoked"
  )
  assert.equal(
    apiKeyAccessState(
      {
        revokedAt: null,
        expiresAt: new Date("2026-09-16T11:59:59.000Z"),
      },
      now
    ),
    "expired"
  )
})
