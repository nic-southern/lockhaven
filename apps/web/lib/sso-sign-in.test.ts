import assert from "node:assert/strict"
import test from "node:test"

import { PLATFORM_SSO_PROVIDER_ID_DEFAULT } from "@nms/shared"

import { resolveSsoStart, ssoRedirectUrl, SSO_START_ERROR } from "./sso-sign-in"

const companyOidc = {
  signInMethod: "oauth2" as const,
  providerId: "lockhaven",
}

test("starts company OpenID immediately with an empty email", () => {
  assert.deepEqual(
    resolveSsoStart({
      email: "",
      status: companyOidc,
      hint: { signInMethod: null, providerId: null },
    }),
    { action: "oauth2", providerId: "lockhaven" }
  )
})

test("ignores a stale organization hint when the email field is empty", () => {
  assert.deepEqual(
    resolveSsoStart({
      email: "   ",
      status: companyOidc,
      hint: { signInMethod: "sso", providerId: "org-customer" },
    }),
    { action: "oauth2", providerId: "lockhaven" }
  )
})

test("uses a typed email only to select an organization provider", () => {
  assert.deepEqual(
    resolveSsoStart({
      email: "tech@customer.com",
      status: companyOidc,
      hint: { signInMethod: "sso", providerId: "org-customer" },
    }),
    {
      action: "sso",
      providerId: "org-customer",
      email: "tech@customer.com",
    }
  )
})

test("starts company SAML without asking for email", () => {
  assert.deepEqual(
    resolveSsoStart({
      email: "",
      status: { signInMethod: "sso", providerId: "sso-saml" },
    }),
    { action: "sso", providerId: "sso-saml" }
  )
})

test("keeps company OpenID when a typed email still maps to the platform", () => {
  assert.deepEqual(
    resolveSsoStart({
      email: "ada@example.com",
      status: companyOidc,
      hint: { signInMethod: "oauth2", providerId: "lockhaven" },
    }),
    { action: "oauth2", providerId: "lockhaven" }
  )
})

test("defaults to company OpenID when status has no provider yet", () => {
  assert.deepEqual(
    resolveSsoStart({
      email: "",
      status: { signInMethod: null, providerId: null },
    }),
    { action: "oauth2", providerId: PLATFORM_SSO_PROVIDER_ID_DEFAULT }
  )
  assert.equal(PLATFORM_SSO_PROVIDER_ID_DEFAULT, "lockhaven")
  assert.equal(/email/i.test(SSO_START_ERROR), false)
})

test("reads the identity-provider URL from an OpenID start result", () => {
  assert.equal(
    ssoRedirectUrl({
      data: {
        url: "https://auth.example.com/realms/nms/protocol/openid-connect/auth",
        redirect: true,
      },
    }),
    "https://auth.example.com/realms/nms/protocol/openid-connect/auth"
  )
  assert.equal(ssoRedirectUrl({ data: { url: "", redirect: true } }), null)
  assert.equal(ssoRedirectUrl({ data: { url: "  " } }), null)
})
