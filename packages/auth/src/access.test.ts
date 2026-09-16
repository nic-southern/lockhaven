import assert from "node:assert/strict"
import { test } from "node:test"

import {
  type ActorPrincipal,
  authorize,
  permissionsForOrganizationRole,
  permissionsForRole,
  permissionsForSiteRole,
  uiScopeFor,
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
  assert.equal(
    permissionsForOrganizationRole("owner").includes("vpn:admin_profile"),
    true
  )
  assert.equal(
    permissionsForOrganizationRole("admin").includes("vpn:admin_profile"),
    false
  )
  assert.equal(
    permissionsForOrganizationRole("operator").includes("vpn:admin_profile"),
    false
  )
})

test("maps site roles to scoped permissions", () => {
  assert.equal(
    permissionsForSiteRole("operator").includes("device:update"),
    true
  )
  assert.equal(
    permissionsForSiteRole("viewer").includes("device:update"),
    false
  )
})

test("platform permissions stay separate from membership permissions", () => {
  assert.equal(permissionsForRole("admin").includes("organization:admin"), true)
  assert.equal(permissionsForRole("owner").includes("device:update"), true)
  assert.equal(permissionsForRole("admin").includes("vpn:admin_profile"), true)
  assert.equal(permissionsForRole("owner").includes("vpn:admin_profile"), true)
})

test("allows org owners to manage admin vpn profiles in their organization", () => {
  const decision = authorize(
    {
      id: "user-1",
      email: "owner@example.com",
      name: null,
      platformRole: "admin",
      platformPermissions: [],
      permissions: [],
      organizationMemberships: [
        {
          id: "membership-1",
          organizationId: "org-1",
          role: "owner",
          status: "active",
        },
      ],
      siteMemberships: [],
    },
    "vpn:admin_profile",
    {
      kind: "organization",
      organizationId: "org-1",
    }
  )

  assert.equal(decision.allowed, true)
})

test("denies org admins from managing admin vpn profiles", () => {
  const decision = authorize(
    {
      id: "user-2",
      email: "admin@example.com",
      name: null,
      platformRole: "admin",
      platformPermissions: [],
      permissions: [],
      organizationMemberships: [
        {
          id: "membership-2",
          organizationId: "org-1",
          role: "admin",
          status: "active",
        },
      ],
      siteMemberships: [],
    },
    "vpn:admin_profile",
    {
      kind: "organization",
      organizationId: "org-1",
    }
  )

  assert.equal(decision.allowed, false)
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

function member(overrides: Partial<ActorPrincipal> = {}): ActorPrincipal {
  return {
    id: "user-m",
    email: "member@example.com",
    name: null,
    platformRole: "member",
    platformPermissions: permissionsForRole("member"),
    permissions: [],
    organizationMemberships: [],
    siteMemberships: [],
    ...overrides,
  }
}

test("platform members hold no platform-wide permissions", () => {
  assert.deepEqual(permissionsForRole("member"), [])
  assert.equal(
    authorize(member(), "device:view", { kind: "platform" }).allowed,
    false
  )
  assert.equal(
    authorize(member(), "device:view", {
      kind: "device",
      organizationId: "org-1",
      siteId: null,
    }).allowed,
    false
  )
})

test("technicians can view and connect but not enroll, revoke, or reveal", () => {
  const technician = permissionsForOrganizationRole("technician")
  assert.equal(technician.includes("device:view"), true)
  assert.equal(technician.includes("device:start_vnc"), true)
  assert.equal(technician.includes("device:update"), true)
  assert.equal(technician.includes("device:enroll"), false)
  assert.equal(technician.includes("device:revoke_vpn"), false)
  assert.equal(technician.includes("device:delete"), false)
  assert.equal(technician.includes("credential:reveal"), false)
  assert.equal(technician.includes("user:manage"), false)
  assert.deepEqual(permissionsForSiteRole("technician"), technician)
})

test("site technicians are scoped to their site", () => {
  const actor = member({
    permissions: permissionsForSiteRole("technician"),
    siteMemberships: [
      {
        id: "sm-1",
        siteId: "site-1",
        organizationId: "org-1",
        role: "technician",
        status: "active",
      },
    ],
  })

  assert.equal(
    authorize(actor, "device:start_rdp", {
      kind: "device",
      organizationId: "org-1",
      siteId: "site-1",
    }).allowed,
    true
  )
  assert.equal(
    authorize(actor, "device:start_rdp", {
      kind: "device",
      organizationId: "org-1",
      siteId: "site-2",
    }).allowed,
    false
  )
  assert.equal(
    authorize(actor, "device:revoke_vpn", {
      kind: "device",
      organizationId: "org-1",
      siteId: "site-1",
    }).allowed,
    false
  )
  assert.equal(uiScopeFor(actor), "technician")
})

test("suspended memberships grant nothing", () => {
  const actor = member({
    organizationMemberships: [
      {
        id: "om-1",
        organizationId: "org-1",
        role: "owner",
        status: "suspended",
      },
    ],
  })

  assert.equal(
    authorize(actor, "device:view", {
      kind: "organization",
      organizationId: "org-1",
    }).allowed,
    false
  )
})

test("ui scope is admin for anyone with management permissions", () => {
  assert.equal(uiScopeFor(member({ platformRole: "admin" })), "admin")
  assert.equal(
    uiScopeFor(
      member({
        permissions: permissionsForOrganizationRole("admin"),
        organizationMemberships: [
          {
            id: "om-1",
            organizationId: "org-1",
            role: "admin",
            status: "active",
          },
        ],
      })
    ),
    "admin"
  )
  assert.equal(
    uiScopeFor(member({ permissions: permissionsForSiteRole("viewer") })),
    "technician"
  )
})

test("owners and org admins can reveal credentials and manage users", () => {
  assert.equal(permissionsForRole("owner").includes("credential:reveal"), true)
  assert.equal(permissionsForRole("owner").includes("user:manage"), true)
  assert.equal(
    permissionsForOrganizationRole("admin").includes("credential:reveal"),
    true
  )
  assert.equal(
    permissionsForOrganizationRole("viewer").includes("credential:reveal"),
    false
  )
})
