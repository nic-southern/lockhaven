import assert from "node:assert/strict"
import test from "node:test"

import { isTunnelOnlyDevice } from "./tunnel-device"

test("tunnel-only devices have no agent secret or version", () => {
  assert.equal(
    isTunnelOnlyDevice({ hasCheckInSecret: false, agentVersion: null }),
    true
  )
  assert.equal(
    isTunnelOnlyDevice({
      hasCheckInSecret: undefined,
      agentVersion: undefined,
    }),
    true
  )
  assert.equal(
    isTunnelOnlyDevice({ hasCheckInSecret: true, agentVersion: null }),
    false
  )
  assert.equal(
    isTunnelOnlyDevice({ hasCheckInSecret: false, agentVersion: "0.1.0" }),
    false
  )
})
