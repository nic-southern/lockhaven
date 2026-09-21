import assert from "node:assert/strict"
import test from "node:test"

import {
  aptPocketIsSecurity,
  classifyWindowsUpdateCategories,
  parseAptUpgradable,
  parseDfKp,
  parseDnfCheckUpdate,
  parseDnfSecurityUpdates,
  parseDpkgQuery,
  parseListeningPorts,
  parseProcMeminfo,
  parseProcNetDev,
  parseWindowsUpdateList,
} from "./parse"

test("parses df -kP mounts and skips tmpfs", () => {
  const disks =
    parseDfKp(`Filesystem     1024-blocks    Used Available Capacity Mounted on
/dev/sda1           100000   40000     60000      40% /
tmpfs                16000       0     16000       0% /dev/shm
/dev/sdb1           200000   50000    150000      25% /var
`)
  assert.equal(disks.length, 2)
  assert.equal(disks[0]?.mount, "/")
  assert.equal(disks[0]?.total_bytes, 100000 * 1024)
  assert.equal(disks[1]?.mount, "/var")
})

test("parses /proc/net/dev counters and skips loopback", () => {
  const ifaces =
    parseProcNetDev(`Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 100 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0
  eth0: 1234 10 0 0 0 0 0 0 5678 20 0 0 0 0 0 0
`)
  assert.equal(ifaces.length, 1)
  assert.deepEqual(ifaces[0], {
    name: "eth0",
    rx_bytes: 1234,
    rx_packets: 10,
    tx_bytes: 5678,
    tx_packets: 20,
  })
})

test("parses meminfo available memory", () => {
  const memory = parseProcMeminfo(`MemTotal:        8000 kB
MemFree:         1000 kB
MemAvailable:    3000 kB
`)
  assert.equal(memory.total_bytes, 8000 * 1024)
  assert.equal(memory.available_bytes, 3000 * 1024)
  assert.equal(memory.used_bytes, 5000 * 1024)
})

test("parses dpkg and apt upgrade lists", () => {
  assert.deepEqual(parseDpkgQuery("curl\t8.0.0\nbash\t5.2\n"), [
    { name: "curl", version: "8.0.0", source: "apt" },
    { name: "bash", version: "5.2", source: "apt" },
  ])
  assert.deepEqual(
    parseAptUpgradable(
      "curl/stable 8.1.0 amd64 [upgradable from: 8.0.0]\nWARNING: apt does not have a stable CLI interface.\n"
    ),
    [
      {
        name: "curl",
        available_version: "8.1.0",
        current_version: "8.0.0",
        source: "apt",
      },
    ]
  )
  assert.equal(aptPocketIsSecurity("jammy-updates"), false)
  assert.equal(aptPocketIsSecurity("jammy-security,jammy-updates"), true)
  assert.deepEqual(
    parseAptUpgradable(
      "openssl/jammy-security,jammy-updates 3.0.2-1 amd64 [upgradable from: 3.0.2]\n"
    ),
    [
      {
        name: "openssl",
        available_version: "3.0.2-1",
        current_version: "3.0.2",
        source: "apt",
        severity: "security",
      },
    ]
  )
})

test("dnf security advisories classify critical and ignore unknown labels", () => {
  assert.deepEqual(
    parseDnfSecurityUpdates(`RHSA-2024:0001 Critical/Sec. curl-7.76.1-1.el9.x86_64
RHSA-2024:0002 Important/Sec. bash-5.1.8-2.el9.x86_64
RHBA-2024:0003 bugfix jq-1.6-1.el9.x86_64
libseccomp is not an advisory
`),
    [
      {
        name: "curl",
        available_version: "7.76.1-1.el9",
        source: "rpm",
        severity: "critical",
      },
      {
        name: "bash",
        available_version: "5.1.8-2.el9",
        source: "rpm",
        severity: "security",
      },
    ]
  )
  assert.deepEqual(
    parseDnfCheckUpdate(`curl.x86_64  7.76.1-1.el9  baseos
Obsoleting Packages
old.x86_64  new.x86_64
`),
    [
      {
        name: "curl",
        available_version: "7.76.1-1.el9",
        source: "rpm",
        severity: "security",
      },
    ]
  )
})

test("windows update categories fail closed", () => {
  assert.equal(
    classifyWindowsUpdateCategories("Security Updates|Updates"),
    "security"
  )
  assert.equal(classifyWindowsUpdateCategories("Critical Updates"), "critical")
  for (const raw of [
    "",
    "Updates",
    "Definition Updates",
    "Security Intelligence Updates",
    "unknown",
  ]) {
    assert.equal(classifyWindowsUpdateCategories(raw), undefined)
  }
  assert.deepEqual(
    parseWindowsUpdateList(
      "Cumulative Update\t5034441\tSecurity Updates\nDriver pack\t\tDrivers\n"
    ),
    [
      {
        name: "Cumulative Update",
        available_version: "KB5034441",
        source: "windows-update",
        severity: "security",
      },
      {
        name: "Driver pack",
        available_version: "pending",
        source: "windows-update",
      },
    ]
  )
})

test("parses listening ports from ss output", () => {
  const ports =
    parseListeningPorts(`State  Recv-Q Send-Q Local Address:Port  Peer Address:Port
LISTEN 0      128          0.0.0.0:22         0.0.0.0:*
LISTEN 0      5            0.0.0.0:5900       0.0.0.0:*
`)
  assert.equal(ports.has(22), true)
  assert.equal(ports.has(5900), true)
  assert.equal(ports.has(3389), false)
})
