import assert from "node:assert/strict"
import { test } from "node:test"

import {
  authorize,
  permissionsForOrganizationRole,
  permissionsForRole,
  permissionsForSiteRole,
} from "./access"

test("maps organization roles to scoped permissions", () => {
  assert.equal(
    permissionsForOrganizationRole("admin").includes("organization:admin"),
    true
  )
  assert.equal(
    permissionsForOrganizationRole("admin").includes("site:admin"),
    true
  )
  assert.equal(
    permissionsForOrganizationRole("viewer").includes("device:update"),
    false
  )
})

test("maps site roles to scoped permissions", () => {
  assert.equal(permissionsForSiteRole("operator").includes("device:update"), true)
  assert.equal(permissionsForSiteRole("viewer").includes("device:update"), false)
})

test("platform permissions stay separate from membership permissions", () => {
  assert.equal(permissionsForRole("admin").includes("organization:admin"), true)
  assert.equal(permissionsForRole("owner").includes("device:update"), true)
})

test("denies device access outside the user's organization", () => {
  const decision = authorize(
    {
      id: "user-1",
      email: "user@example.com",
      name: null,
      platformRole: "admin",
      platformPermissions: [],
      permissions: [],
      organizationMemberships: [
        {
          id: "membership-1",
          organizationId: "org-1",
          role: "viewer",
          status: "active",
        },
      ],
      siteMemberships: [],
    },
    "device:view",
    {
      kind: "device",
      organizationId: "org-2",
      siteId: null,
    }
  )

  assert.equal(decision.allowed, false)
})

test("allows access through a matching site grant", () => {
  const decision = authorize(
    {
      id: "user-1",
      email: "user@example.com",
      name: null,
      platformRole: "admin",
      platformPermissions: [],
      permissions: [],
      organizationMemberships: [],
      siteMemberships: [
        {
          id: "site-membership-1",
          siteId: "site-1",
          organizationId: "org-1",
          role: "operator",
          status: "active",
        },
      ],
    },
    "device:start_ssh",
    {
      kind: "device",
      organizationId: "org-1",
      siteId: "site-1",
    }
  )

  assert.equal(decision.allowed, true)
})
