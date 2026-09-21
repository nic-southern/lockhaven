import assert from "node:assert/strict"
import test from "node:test"

import {
  adminForwardDeviceIps,
  decideInfrastructureAccess,
  INFRASTRUCTURE_ACCESS_DEFAULT_MINUTES,
  INFRASTRUCTURE_ACCESS_MAX_MINUTES,
  infrastructureAccessExpiresAt,
  infrastructureSessionNeedsClose,
  resolveInfrastructureAccessMinutes,
  type InfrastructureForwardGrant,
  type InfrastructureGrantView,
} from "./infrastructure-access"

const now = new Date("2026-09-21T12:00:00.000Z")
const actorId = "admin-1"
const otherId = "admin-2"

function grant(
  overrides: Partial<InfrastructureGrantView> &
    Pick<InfrastructureGrantView, "expiresAt">
): InfrastructureGrantView {
  return {
    id: "grant-1",
    requestedByUserId: actorId,
    status: "active",
    revokedAt: null,
    ...overrides,
  }
}

test("infrastructure access defaults to 30 minutes and caps at 2 hours", () => {
  const fallback = resolveInfrastructureAccessMinutes(undefined)
  assert.equal(fallback.ok, true)
  if (fallback.ok) {
    assert.equal(fallback.minutes, INFRASTRUCTURE_ACCESS_DEFAULT_MINUTES)
  }
  assert.equal(INFRASTRUCTURE_ACCESS_DEFAULT_MINUTES, 30)
  assert.equal(INFRASTRUCTURE_ACCESS_MAX_MINUTES, 120)
  assert.equal(resolveInfrastructureAccessMinutes(120).ok, true)
  assert.equal(resolveInfrastructureAccessMinutes(121).ok, false)
  assert.equal(resolveInfrastructureAccessMinutes(0).ok, false)
  assert.equal(
    infrastructureAccessExpiresAt(now, 30).toISOString(),
    "2026-09-21T12:30:00.000Z"
  )
})

test("infrastructure devices deny connection until a grant exists", () => {
  const decision = decideInfrastructureAccess({
    action: "connect",
    platformRole: "admin",
    infrastructure: true,
    actorId,
    grants: [],
    now,
  })
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, "denied")
})

test("a grant allows connection only until it expires", () => {
  const live = grant({
    expiresAt: new Date("2026-09-21T12:30:00.000Z"),
  })
  const allowed = decideInfrastructureAccess({
    action: "connect",
    platformRole: "owner",
    infrastructure: true,
    actorId,
    grants: [live],
    now,
  })
  assert.equal(allowed.allowed, true)
  assert.equal(allowed.grantId, "grant-1")

  const expired = grant({
    expiresAt: new Date("2026-09-21T11:59:59.000Z"),
  })
  const denied = decideInfrastructureAccess({
    action: "connect",
    platformRole: "owner",
    infrastructure: true,
    actorId,
    grants: [expired],
    now,
  })
  assert.equal(denied.allowed, false)
  assert.equal(denied.code, "expired")
})

test("an expired or revoked grant denies even if someone forgets to close it", () => {
  const staleStatus = grant({
    status: "active",
    expiresAt: new Date("2026-09-21T11:00:00.000Z"),
  })
  const revoked = grant({
    id: "grant-2",
    status: "active",
    revokedAt: new Date("2026-09-21T11:50:00.000Z"),
    expiresAt: new Date("2026-09-21T13:00:00.000Z"),
  })
  for (const grants of [[staleStatus], [revoked]]) {
    const decision = decideInfrastructureAccess({
      action: "connect",
      platformRole: "admin",
      infrastructure: true,
      actorId,
      grants,
      now,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.code, "expired")
  }
})

test("organization administrators cannot grant infrastructure access", () => {
  for (const action of ["classify", "request"] as const) {
    const decision = decideInfrastructureAccess({
      action,
      platformRole: "member",
      infrastructure: true,
      actorId,
      now,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.code, "not_platform_admin")
  }
  const connect = decideInfrastructureAccess({
    action: "connect",
    platformRole: "member",
    infrastructure: true,
    actorId,
    grants: [grant({ expiresAt: new Date("2026-09-21T12:30:00.000Z") })],
    now,
  })
  assert.equal(connect.allowed, false)
  assert.equal(connect.code, "not_platform_admin")
})

test("ordinary devices keep today's connection behavior", () => {
  const decision = decideInfrastructureAccess({
    action: "connect",
    platformRole: "member",
    infrastructure: false,
    actorId,
    grants: [],
    now,
  })
  assert.equal(decision.allowed, true)
  assert.equal(decision.code, "unchanged")

  const ips = adminForwardDeviceIps({
    devices: [
      {
        organizationId: "org-1",
        vpnIpv4: "10.8.0.4",
        infrastructure: false,
        reachable: true,
      },
      {
        organizationId: "org-1",
        vpnIpv4: "10.8.0.9",
        infrastructure: true,
        reachable: true,
      },
    ],
    grants: [],
    adminUserId: actorId,
    organizationId: "org-1",
    now,
  })
  assert.deepEqual(ips, ["10.8.0.4"])
})

test("forwards include an infrastructure device only for the grantee until expiry", () => {
  const devices = [
    {
      organizationId: "org-1",
      vpnIpv4: "10.8.0.9",
      infrastructure: true,
      reachable: true,
    },
  ]
  const grants: InfrastructureForwardGrant[] = [
    {
      ...grant({ expiresAt: new Date("2026-09-21T12:30:00.000Z") }),
      organizationId: "org-1",
      vpnIpv4: "10.8.0.9",
    },
  ]
  assert.deepEqual(
    adminForwardDeviceIps({
      devices,
      grants,
      adminUserId: actorId,
      organizationId: "org-1",
      now,
    }),
    ["10.8.0.9"]
  )
  assert.deepEqual(
    adminForwardDeviceIps({
      devices,
      grants,
      adminUserId: otherId,
      organizationId: "org-1",
      now,
    }),
    []
  )
  assert.deepEqual(
    adminForwardDeviceIps({
      devices,
      grants: [
        {
          ...grants[0],
          expiresAt: new Date("2026-09-21T11:00:00.000Z"),
        },
      ],
      adminUserId: actorId,
      organizationId: "org-1",
      now,
    }),
    []
  )
})

test("open infrastructure sessions close once the grant is gone", () => {
  assert.equal(
    infrastructureSessionNeedsClose({
      infrastructure: false,
      adminUserId: actorId,
      deviceId: "device-1",
      grants: [],
      now,
    }),
    false
  )
  assert.equal(
    infrastructureSessionNeedsClose({
      infrastructure: true,
      adminUserId: actorId,
      deviceId: "device-1",
      grants: [],
      now,
    }),
    true
  )
  assert.equal(
    infrastructureSessionNeedsClose({
      infrastructure: true,
      adminUserId: actorId,
      deviceId: "device-1",
      grants: [
        {
          ...grant({ expiresAt: new Date("2026-09-21T12:30:00.000Z") }),
          deviceId: "device-1",
        },
      ],
      now,
    }),
    false
  )
  assert.equal(
    infrastructureSessionNeedsClose({
      infrastructure: true,
      adminUserId: actorId,
      deviceId: "device-1",
      grants: [
        {
          ...grant({ expiresAt: new Date("2026-09-21T11:00:00.000Z") }),
          deviceId: "device-1",
        },
      ],
      now,
    }),
    true
  )
})
