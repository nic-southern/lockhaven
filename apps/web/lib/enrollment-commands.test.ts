import assert from "node:assert/strict"
import test from "node:test"

import {
  buildAgentDownloadUrl,
  buildAndroidInstallCommand,
  buildLinuxEnrollCommand,
  buildLinuxInstallCommand,
  buildLinuxUninstallCommand,
  buildWindowsEnrollCommand,
  buildWindowsInstallCommand,
  buildWindowsUninstallCommand,
} from "./enrollment-commands"

test("builds the Windows agent install command", () => {
  assert.equal(
    buildWindowsInstallCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
    }),
    [
      "$Token = 'nms_enroll_abc''123';",
      "$BaseUrl = 'https://vpn.example.com';",
      '$Script = "$env:TEMP\\install-lockhaven-agent.ps1";',
      'Invoke-WebRequest -Uri "https://vpn.example.com/install/install-lockhaven-agent.ps1" -OutFile $Script;',
      "powershell.exe -ExecutionPolicy Bypass -File $Script -Token $Token -BaseUrl $BaseUrl",
    ].join(" ")
  )
})

test("builds the Windows agent install command for a listed device", () => {
  assert.equal(
    buildWindowsInstallCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
      deviceId: "11111111-1111-4111-8111-111111111111",
    }),
    [
      "$Token = 'nms_enroll_abc''123';",
      "$BaseUrl = 'https://vpn.example.com';",
      "$DeviceId = '11111111-1111-4111-8111-111111111111';",
      '$Script = "$env:TEMP\\install-lockhaven-agent.ps1";',
      'Invoke-WebRequest -Uri "https://vpn.example.com/install/install-lockhaven-agent.ps1" -OutFile $Script;',
      "powershell.exe -ExecutionPolicy Bypass -File $Script -Token $Token -BaseUrl $BaseUrl -DeviceId $DeviceId",
    ].join(" ")
  )
})

test("builds the Windows tunnel-only enrollment command", () => {
  assert.equal(
    buildWindowsEnrollCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
    }),
    [
      "$Token = 'nms_enroll_abc''123';",
      "$BaseUrl = 'https://vpn.example.com';",
      '$Script = "$env:TEMP\\lockhaven-enroll.ps1";',
      'Invoke-WebRequest -Uri "https://vpn.example.com/install/enroll-windows.ps1" -OutFile $Script;',
      "powershell.exe -ExecutionPolicy Bypass -File $Script -Token $Token -BaseUrl $BaseUrl",
    ].join(" ")
  )
})

test("builds the Linux VPN enrollment command", () => {
  assert.equal(
    buildLinuxInstallCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
    }),
    "curl -fsSL https://vpn.example.com/install/install-lockhaven-agent.sh | sudo LOCKHAVEN_TOKEN='nms_enroll_abc'\\''123' LOCKHAVEN_BASE_URL='https://vpn.example.com' bash"
  )
})

test("builds the Linux tunnel-only enrollment command", () => {
  assert.equal(
    buildLinuxEnrollCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
    }),
    "curl -fsSL https://vpn.example.com/install/enroll-linux.sh | sudo LOCKHAVEN_TOKEN='nms_enroll_abc'\\''123' LOCKHAVEN_BASE_URL='https://vpn.example.com' bash"
  )
})

test("builds the Linux agent install command for a listed device", () => {
  assert.equal(
    buildLinuxInstallCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
      deviceId: "11111111-1111-4111-8111-111111111111",
    }),
    "curl -fsSL https://vpn.example.com/install/install-lockhaven-agent.sh | sudo LOCKHAVEN_TOKEN='nms_enroll_abc'\\''123' LOCKHAVEN_BASE_URL='https://vpn.example.com' LOCKHAVEN_DEVICE_ID='11111111-1111-4111-8111-111111111111' bash"
  )
})

test("builds Linux agent download URLs", () => {
  assert.equal(
    buildAgentDownloadUrl({
      baseUrl: "https://vpn.example.com/",
      arch: "amd64",
    }),
    "https://vpn.example.com/install/lockhaven-agent-linux-amd64"
  )
  assert.equal(
    buildAgentDownloadUrl({
      baseUrl: "https://vpn.example.com/",
      arch: "arm64",
    }),
    "https://vpn.example.com/install/lockhaven-agent-linux-arm64"
  )
})

test("builds Windows agent download URLs", () => {
  assert.equal(
    buildAgentDownloadUrl({
      baseUrl: "https://vpn.example.com/",
      arch: "amd64",
      platform: "windows",
    }),
    "https://vpn.example.com/install/lockhaven-agent-windows-amd64.exe"
  )
  assert.equal(
    buildAgentDownloadUrl({
      baseUrl: "https://vpn.example.com/",
      arch: "arm64",
      platform: "windows",
    }),
    "https://vpn.example.com/install/lockhaven-agent-windows-arm64.exe"
  )
})

test("builds the Android VPN enrollment command", () => {
  assert.equal(
    buildAndroidInstallCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
    }),
    [
      "curl -fsSL https://vpn.example.com/install/enroll-android.sh",
      "-o /tmp/lockhaven-enroll-android.sh",
      "&& LOCKHAVEN_TOKEN='nms_enroll_abc'\\''123'",
      "LOCKHAVEN_BASE_URL='https://vpn.example.com'",
      "bash /tmp/lockhaven-enroll-android.sh",
    ].join(" ")
  )
})

test("builds the Windows VPN uninstall command", () => {
  assert.equal(
    buildWindowsUninstallCommand({
      baseUrl: "https://vpn.example.com/",
    }),
    [
      '$Script = "$env:TEMP\\lockhaven-uninstall.ps1";',
      'Invoke-WebRequest -Uri "https://vpn.example.com/install/uninstall-windows.ps1" -OutFile $Script;',
      "powershell.exe -ExecutionPolicy Bypass -File $Script",
    ].join(" ")
  )
})

test("builds the Linux VPN uninstall command", () => {
  assert.equal(
    buildLinuxUninstallCommand({
      baseUrl: "https://vpn.example.com/",
    }),
    "curl -fsSL https://vpn.example.com/install/uninstall-linux.sh | sudo bash"
  )
})
