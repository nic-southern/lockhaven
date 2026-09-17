import assert from "node:assert/strict"
import test from "node:test"

import { PLATFORM_SSO_PROVIDER_ID_DEFAULT } from "@nms/shared"

import { resolveSsoStart, SSO_START_ERROR } from "./sso-sign-in"

const companyOidc = {
  signInMethod: "oauth2" as const,
  providerId: "sso",
}

test("starts company OpenID immediately with an empty email", () => {
  assert.deepEqual(
    resolveSsoStart({
      email: "",
      status: companyOidc,
      hint: { signInMethod: null, providerId: null },
    }),
    { action: "oauth2", providerId: "sso" }
  )
})

test("ignores a stale organization hint when the email field is empty", () => {
  assert.deepEqual(
    resolveSsoStart({
      email: "   ",
      status: companyOidc,
      hint: { signInMethod: "sso", providerId: "org-customer" },
    }),
    { action: "oauth2", providerId: "sso" }
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
      hint: { signInMethod: "oauth2", providerId: "sso" },
    }),
    { action: "oauth2", providerId: "sso" }
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
  assert.equal(/email/i.test(SSO_START_ERROR), false)
})
