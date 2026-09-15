import assert from "node:assert/strict"
import test from "node:test"

import { flowLogPrefix, parseFlowLine, splitCompleteLines } from "./flows"

const base = {
  timestamp: "2026-09-15T12:00:00.123456",
  dvc: "hub",
  "raw.pktlen": 60,
  "raw.pktcount": 1,
  "oob.prefix": "lockhaven-flow-fwd-accept ",
  "oob.time.sec": 1789473600,
  "oob.time.usec": 250000,
  "oob.in": "wg0",
  "oob.out": "eth0",
  "oob.family": 2,
  "ip.protocol": 6,
  src_ip: "10.80.10.11",
  dest_ip: "192.168.50.20",
  "tcp.sport": 51544,
  "tcp.dport": 5900,
}

test("parses a forwarded TCP flow with an explicit verdict", () => {
  const record = parseFlowLine(JSON.stringify(base))
  assert.ok(record)
  assert.equal(record.direction, "forward")
  assert.equal(record.verdict, "accept")
  assert.equal(record.srcIp, "10.80.10.11")
  assert.equal(record.dstIp, "192.168.50.20")
  assert.equal(record.dstPort, 5900)
  assert.equal(record.protocol, "tcp")
  assert.equal(record.bytes, 60)
  assert.equal(record.inInterface, "wg0")
  assert.equal(record.outInterface, "eth0")
  assert.equal(record.occurredAt.toISOString(), "2026-09-15T12:00:00.250Z")
})

test("hub-bound drops and UDP ports are recognised", () => {
  const record = parseFlowLine(
    JSON.stringify({
      ...base,
      "oob.prefix": "lockhaven-flow-in-drop ",
      "oob.out": "",
      "ip.protocol": 17,
      "tcp.sport": undefined,
      "tcp.dport": undefined,
      "udp.sport": 40000,
      "udp.dport": 53,
    })
  )
  assert.ok(record)
  assert.equal(record.direction, "hub")
  assert.equal(record.verdict, "drop")
  assert.equal(record.protocol, "udp")
  assert.equal(record.dstPort, 53)
  assert.equal(record.outInterface, null)
})

test("ICMP flows carry no port and unknown protocols map to other", () => {
  const icmp = parseFlowLine(
    JSON.stringify({ ...base, "ip.protocol": 1, "tcp.dport": undefined })
  )
  assert.ok(icmp)
  assert.equal(icmp.protocol, "icmp")
  assert.equal(icmp.dstPort, null)

  const other = parseFlowLine(JSON.stringify({ ...base, "ip.protocol": 47 }))
  assert.ok(other)
  assert.equal(other.protocol, "other")
  assert.equal(other.dstPort, null)
})

test("falls back to the textual timestamp and legacy address keys", () => {
  const record = parseFlowLine(
    JSON.stringify({
      "oob.prefix": "lockhaven-flow-in-accept ",
      timestamp: "2026-09-15T12:00:00Z",
      "ip.saddr.str": "10.80.10.12",
      "ip.daddr.str": "10.80.0.1",
      "ip.protocol": 6,
      "tcp.dport": 443,
    })
  )
  assert.ok(record)
  assert.equal(record.occurredAt.toISOString(), "2026-09-15T12:00:00.000Z")
  assert.equal(record.srcIp, "10.80.10.12")
  assert.equal(record.dstPort, 443)
  assert.equal(record.bytes, 0)
})

test("ignores lines that are not Lockhaven flow records", () => {
  assert.equal(parseFlowLine(""), null)
  assert.equal(parseFlowLine("not json"), null)
  assert.equal(parseFlowLine('{"oob.prefix":"other-rule "}'), null)
  assert.equal(
    parseFlowLine(JSON.stringify({ ...base, "oob.prefix": "lockhaven-flow-" })),
    null
  )
  assert.equal(
    parseFlowLine(JSON.stringify({ ...base, src_ip: "not-an-ip" })),
    null
  )
  assert.equal(
    parseFlowLine(
      JSON.stringify({
        ...base,
        "oob.time.sec": undefined,
        timestamp: "garbage",
      })
    ),
    null
  )
  // Truncated JSON from a partial write.
  assert.equal(parseFlowLine(JSON.stringify(base).slice(0, 40)), null)
})

test("prefixes round-trip through the parser", () => {
  for (const direction of ["hub", "forward"] as const) {
    for (const verdict of ["accept", "drop"] as const) {
      const record = parseFlowLine(
        JSON.stringify({
          ...base,
          "oob.prefix": flowLogPrefix(direction, verdict),
        })
      )
      assert.ok(record)
      assert.equal(record.direction, direction)
      assert.equal(record.verdict, verdict)
    }
  }
})

test("splitCompleteLines keeps a trailing partial line for the next read", () => {
  const { lines, rest } = splitCompleteLines('{"a":1}\n{"b":2}\n{"c":')
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}'])
  assert.equal(rest, '{"c":')
  assert.deepEqual(splitCompleteLines("partial"), {
    lines: [],
    rest: "partial",
  })
})
