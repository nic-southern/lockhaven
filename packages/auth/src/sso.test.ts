import assert from "node:assert/strict"
import { test } from "node:test"

import {
  decodeJwtPayload,
  matchOrgSsoSettings,
  platformSignInTarget,
  platformSsoConfigFromEnv,
  publicSsoStartTarget,
} from "./sso"

test("enables company OIDC only when the client secret is set", () => {
  const disabled = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "replace_me",
  })
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.issuer, "https://auth.newmarketsecurity.com/realms/nms")
  assert.equal(
    disabled.discoveryUrl,
    "https://auth.newmarketsecurity.com/realms/nms/.well-known/openid-configuration"
  )

  const enabled = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "a-real-secret",
    SSO_OIDC_CLIENT_ID: "lockhaven",
    SSO_ALLOWED_DOMAINS: "example.com",
    SSO_REQUIRED: "true",
    SSO_TRUST_IDP_MFA: "true",
  })
  assert.equal(enabled.enabled, true)
  assert.equal(enabled.required, true)
  assert.equal(enabled.trustIdpMfa, true)
  assert.deepEqual(enabled.allowedDomains, ["example.com"])
  assert.equal(enabled.clientId, "lockhaven")
})

test("defaults to optional SSO so password sign-in stays available", () => {
  const config = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "a-real-secret",
  })
  assert.equal(config.enabled, true)
  assert.equal(config.required, false)
})

test("company OpenID is the default Sign in with SSO target without email", () => {
  const oidc = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "a-real-secret",
  })
  assert.deepEqual(platformSignInTarget(oidc), {
    providerId: "sso",
    signInMethod: "oauth2",
    protocol: "oidc",
  })

  const samlOnly = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "replace_me",
    SSO_SAML_ENTRY_POINT: "https://idp.example.com/sso",
    SSO_SAML_CERT: "not-a-real-cert",
  })
  assert.deepEqual(platformSignInTarget(samlOnly), {
    providerId: "sso-saml",
    signInMethod: "sso",
    protocol: "saml",
  })

  const off = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "replace_me",
  })
  assert.deepEqual(platformSignInTarget(off), {
    providerId: null,
    signInMethod: null,
    protocol: null,
  })
})

test("uses company OpenID for Sign in with SSO when only org SSO is on", () => {
  const platform = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "replace_me",
  })
  assert.deepEqual(
    publicSsoStartTarget(platform, [
      {
        enabled: true,
        protocol: "oidc",
        usePlatformIdp: true,
        providerId: null,
      },
    ]),
    {
      providerId: "sso",
      signInMethod: "oauth2",
      protocol: "oidc",
    }
  )
})

test("uses a single organization provider when the company provider is not ready", () => {
  const platform = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "replace_me",
  })
  assert.deepEqual(
    publicSsoStartTarget(platform, [
      {
        enabled: true,
        protocol: "saml",
        usePlatformIdp: false,
        providerId: "org-1-saml",
      },
    ]),
    {
      providerId: "org-1-saml",
      signInMethod: "sso",
      protocol: "saml",
    }
  )
})

test("decodes identity-token claims without verifying the signature", () => {
  const payload = Buffer.from(
    JSON.stringify({
      email: "ada@example.com",
      email_verified: true,
      groups: ["operators"],
    }),
    "utf8"
  ).toString("base64url")
  const token = `header.${payload}.sig`
  const claims = decodeJwtPayload(token)
  assert.equal(claims?.email, "ada@example.com")
  assert.deepEqual(claims?.groups, ["operators"])
})

test("org SSO settings override platform defaults for a matching domain", () => {
  const platform = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "a-real-secret",
    SSO_ALLOWED_DOMAINS: "example.com",
  })
  const policy = matchOrgSsoSettings(
    "tech@customer.com",
    [
      {
        organizationId: "org-1",
        enabled: true,
        required: true,
        protocol: "saml",
        usePlatformIdp: false,
        allowedDomains: ["customer.com"],
        trustIdpMfa: true,
        claimsMap: { claim: "groups", values: {} },
        defaultOrganizationRole: "operator",
        providerId: "org-1-saml",
      },
    ],
    platform
  )
  assert.equal(policy?.required, true)
  assert.equal(policy?.signInMethod, "sso")
  assert.equal(policy?.providerId, "org-1-saml")
  assert.equal(policy?.organizationId, "org-1")
})

test("falls back to company OpenID when no organization domain matches", () => {
  const platform = platformSsoConfigFromEnv({
    SSO_OIDC_CLIENT_SECRET: "a-real-secret",
    SSO_ALLOWED_DOMAINS: "example.com",
    SSO_REQUIRED: "true",
  })
  const policy = matchOrgSsoSettings("ada@example.com", [], platform)
  assert.equal(policy?.usePlatformIdp, true)
  assert.equal(policy?.signInMethod, "oauth2")
  assert.equal(policy?.required, true)
  assert.equal(policy?.providerId, "sso")
})
