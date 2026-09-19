import assert from "node:assert/strict"
import test from "node:test"

import {
  encodeAssignedServices,
  isAgentServiceName,
  isAgentServiceTarget,
} from "./agent-services"

test("service targets are a single token", () => {
  assert.equal(isAgentServiceTarget("nginx.service"), true)
  assert.equal(isAgentServiceTarget("getty@tty1.service"), true)
  assert.equal(isAgentServiceTarget("LockhavenAgent"), true)
  assert.equal(isAgentServiceTarget("nginx.service;id"), false)
  assert.equal(isAgentServiceTarget("nginx.service extra"), false)
  assert.equal(isAgentServiceTarget("../nginx.service"), false)
  assert.equal(isAgentServiceTarget("/bin/systemctl"), false)
  assert.equal(isAgentServiceTarget("C:\\Windows\\system"), false)
  assert.equal(isAgentServiceTarget("name`id`"), false)
  assert.equal(isAgentServiceTarget(""), false)
})

test("service labels can include spaces but not paths", () => {
  assert.equal(isAgentServiceName("Front display"), true)
  assert.equal(isAgentServiceName("../secret"), false)
  assert.equal(isAgentServiceName("a/b"), false)
})

test("assigned services drop invalid targets and duplicate labels", () => {
  const encoded = encodeAssignedServices([
    { name: "Web", target: "nginx.service" },
    { name: "Web", target: "other.service" },
    { name: "Bad", target: "rm -rf" },
  ])
  assert.deepEqual(encoded, [{ name: "Web", target: "nginx.service" }])
})
