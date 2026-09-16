import assert from "node:assert/strict"
import test from "node:test"

import {
  claimValues,
  decideSsoUserLink,
  discoveryUrlForIssuer,
  emailDomain,
  isEmailDomainAllowed,
  localSignInBlock,
  resolveLegacySignInBlock,
  mapClaimsToRoles,
  parseDomainList,
  parseSsoClaimsMap,
  PLATFORM_SSO_ISSUER_DEFAULT,
} from "./sso"

test("parses email domains and allowlists", () => {
  assert.equal(
    emailDomain("Ada@NewMarketSecurity.com"),
    "newmarketsecurity.com"
  )
  assert.equal(emailDomain("not-an-email"), null)
  assert.deepEqual(parseDomainList("a.com, b.com  a.com"), ["a.com", "b.com"])
  assert.equal(isEmailDomainAllowed("tech@example.com", ["example.com"]), true)
  assert.equal(isEmailDomainAllowed("tech@example.com", ["other.com"]), false)
  assert.equal(isEmailDomainAllowed("tech@example.com", []), false)
})

test("maps group claims to the highest organization role", () => {
  const mapped = mapClaimsToRoles({
    claims: { groups: ["technicians", "operators"] },
    claimsMap: {
      claim: "groups",
      values: {
        technicians: { organizationRole: "technician" },
        operators: { organizationRole: "operator" },
      },
    },
    defaultOrganizationRole: "viewer",
  })
  assert.equal(mapped.organizationRole, "operator")
  assert.deepEqual(mapped.matchedValues, ["technicians", "operators"])
})

test("maps nested role claims and site grants", () => {
  const mapped = mapClaimsToRoles({
    claims: {
      realm_access: { roles: ["operator"] },
    },
    claimsMap: {
      claim: "realm_access.roles",
      values: {
        operator: {
          organizationRole: "operator",
          siteId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          siteRole: "technician",
        },
      },
    },
  })
  assert.equal(mapped.organizationRole, "operator")
  assert.equal(
    mapped.siteGrants[0]?.siteId,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  )
  assert.equal(mapped.siteGrants[0]?.role, "technician")
})

test("falls back to the default organization role when no claim matches", () => {
  const mapped = mapClaimsToRoles({
    claims: { groups: ["unknown"] },
    claimsMap: parseSsoClaimsMap({
      claim: "groups",
      values: { operators: { organizationRole: "operator" } },
    }),
    defaultOrganizationRole: "technician",
  })
  assert.equal(mapped.organizationRole, "technician")
  assert.deepEqual(mapped.matchedValues, [])
})

test("links an existing local user by verified email", () => {
  const decision = decideSsoUserLink({
    email: "ada@example.com",
    emailVerified: true,
    allowedDomains: ["example.com"],
    existing: {
      id: "user-1",
      emailVerified: true,
      status: "active",
    },
  })
  assert.deepEqual(decision, { action: "link", userId: "user-1" })
})

test("JIT provisions when the domain is allowed and the email is verified", () => {
  const decision = decideSsoUserLink({
    email: "new@example.com",
    emailVerified: true,
    allowedDomains: ["example.com"],
    existing: null,
  })
  assert.deepEqual(decision, { action: "jit" })
})

test("empty allowlist links existing users and blocks JIT", () => {
  assert.deepEqual(
    decideSsoUserLink({
      email: "ada@example.com",
      emailVerified: true,
      allowedDomains: [],
      existing: { id: "user-1", emailVerified: true, status: "active" },
    }),
    { action: "link", userId: "user-1" }
  )
  assert.equal(
    decideSsoUserLink({
      email: "new@example.com",
      emailVerified: true,
      allowedDomains: [],
      existing: null,
    }).action,
    "reject"
  )
})

test("rejects unverified, inactive, and off-allowlist identities", () => {
  assert.equal(
    decideSsoUserLink({
      email: "new@example.com",
      emailVerified: false,
      allowedDomains: ["example.com"],
      existing: null,
    }).action,
    "reject"
  )
  assert.equal(
    decideSsoUserLink({
      email: "ada@example.com",
      emailVerified: true,
      allowedDomains: ["example.com"],
      existing: { id: "user-1", emailVerified: true, status: "suspended" },
    }).action,
    "reject"
  )
  assert.equal(
    decideSsoUserLink({
      email: "ada@other.com",
      emailVerified: true,
      allowedDomains: ["example.com"],
      existing: null,
    }).action,
    "reject"
  )
})

test("fails closed when SSO is required and the identity provider is down", () => {
  assert.deepEqual(
    localSignInBlock({ ssoRequired: true, idpAvailable: false }),
    { blocked: true, reason: "idp_unavailable" }
  )
  assert.deepEqual(
    localSignInBlock({ ssoRequired: true, idpAvailable: true }),
    {
      blocked: true,
      reason: "sso_required",
    }
  )
  assert.deepEqual(
    localSignInBlock({ ssoRequired: false, idpAvailable: false }),
    { blocked: false }
  )
})

test("keeps password and passkeys available until SSO is required", () => {
  assert.deepEqual(
    resolveLegacySignInBlock({
      platformRequired: false,
      matchedPolicyRequired: false,
      idpAvailable: false,
    }),
    { blocked: false }
  )
  assert.deepEqual(
    resolveLegacySignInBlock({
      platformRequired: false,
      matchedPolicyRequired: true,
      idpAvailable: true,
    }),
    { blocked: true, reason: "sso_required" }
  )
  assert.equal(
    resolveLegacySignInBlock({
      platformRequired: false,
      matchedPolicyRequired: false,
      idpAvailable: true,
    }).blocked,
    false
  )
})

test("builds the company discovery URL from the realm issuer", () => {
  assert.equal(
    discoveryUrlForIssuer(PLATFORM_SSO_ISSUER_DEFAULT),
    "https://auth.newmarketsecurity.com/realms/nms/.well-known/openid-configuration"
  )
})

test("reads nested claim arrays", () => {
  assert.deepEqual(claimValues({ groups: ["operators"] }, "groups"), [
    "operators",
  ])
  assert.deepEqual(
    claimValues(
      { realm_access: { roles: ["technician"] } },
      "realm_access.roles"
    ),
    ["technician"]
  )
})
