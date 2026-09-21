import assert from "node:assert/strict"
import test from "node:test"

import {
  canGrantOrganizationRole,
  canSupersedeInvitation,
  isInvitationOpen,
  isUserEmailConflict,
  normalizeInvitationSiteGrants,
  siteGrantsBelongToOrganization,
} from "./invitation"

const now = new Date("2026-09-21T12:00:00.000Z")
const siteId = "3fa85f64-5717-4562-b3fc-2c963f66afa6"

function invitation(
  overrides: Partial<{
    acceptedAt: Date | null
    revokedAt: Date | null
    expiresAt: Date
  }> = {}
) {
  return {
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  }
}

test("an unused unexpired invitation stays open through the exact expiry instant", () => {
  assert.equal(isInvitationOpen(invitation(), now), true)
  assert.equal(
    isInvitationOpen(invitation({ expiresAt: now }), now),
    true,
    "the expiry instant itself is still open"
  )
})

test("used, revoked, expired, and missing invitations are closed", () => {
  assert.equal(isInvitationOpen(null, now), false)
  assert.equal(isInvitationOpen(undefined, now), false)
  assert.equal(isInvitationOpen(invitation({ acceptedAt: now }), now), false)
  assert.equal(isInvitationOpen(invitation({ revokedAt: now }), now), false)
  assert.equal(
    isInvitationOpen(
      invitation({ expiresAt: new Date(now.getTime() - 1) }),
      now
    ),
    false
  )
})

test("resending an invite does not revoke another organization's invitation", () => {
  const orgA = "org-a"
  const orgB = "org-b"
  assert.equal(canSupersedeInvitation([orgA], { organizationId: orgA }), true)
  assert.equal(canSupersedeInvitation([orgA], { organizationId: orgB }), false)
  assert.equal(
    canSupersedeInvitation([orgA], { organizationId: null }),
    false,
    "an organization admin cannot replace a platform invitation"
  )
  assert.equal(
    canSupersedeInvitation(null, { organizationId: orgB }),
    true,
    "platform managers can replace any pending invitation"
  )
})

test("only an organization owner can invite another owner", () => {
  assert.equal(
    canGrantOrganizationRole({
      platformWide: false,
      actorRole: "admin",
      role: "owner",
    }),
    false
  )
  assert.equal(
    canGrantOrganizationRole({
      platformWide: false,
      actorRole: "owner",
      role: "owner",
    }),
    true
  )
  assert.equal(
    canGrantOrganizationRole({
      platformWide: true,
      actorRole: null,
      role: "owner",
    }),
    true
  )
  assert.equal(
    canGrantOrganizationRole({
      platformWide: false,
      actorRole: "admin",
      role: "technician",
    }),
    true
  )
})

test("site grants must belong to the invitation organization", () => {
  const grants = [{ siteId, role: "viewer" as const }]
  assert.equal(
    siteGrantsBelongToOrganization(
      [{ id: siteId, organizationId: "org-a" }],
      grants,
      "org-a"
    ),
    true
  )
  assert.equal(
    siteGrantsBelongToOrganization(
      [{ id: siteId, organizationId: "org-b" }],
      grants,
      "org-a"
    ),
    false
  )
  assert.equal(siteGrantsBelongToOrganization([], grants, "org-a"), false)
  assert.equal(siteGrantsBelongToOrganization([], grants, null), false)
  assert.equal(siteGrantsBelongToOrganization([], [], null), true)
})

test("duplicate or malformed site grants are rejected", () => {
  assert.deepEqual(
    normalizeInvitationSiteGrants([{ siteId, role: "technician" }]),
    [{ siteId, role: "technician" }]
  )
  assert.equal(
    normalizeInvitationSiteGrants([
      { siteId, role: "viewer" },
      { siteId, role: "operator" },
    ]),
    null
  )
  assert.equal(normalizeInvitationSiteGrants([{ siteId, role: "owner" }]), null)
  assert.equal(normalizeInvitationSiteGrants("not-grants"), null)
})

test("only the account email conflict is treated as an existing account", () => {
  assert.equal(
    isUserEmailConflict({
      code: "23505",
      constraint: "user_email_unique",
    }),
    true
  )
  assert.equal(
    isUserEmailConflict({
      message: "insert failed",
      cause: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "user_email_unique"',
      },
    }),
    true
  )
  assert.equal(
    isUserEmailConflict({
      code: "23505",
      constraint: "site_memberships_site_user_idx",
    }),
    false
  )
  assert.equal(isUserEmailConflict(new Error("connection refused")), false)
})
