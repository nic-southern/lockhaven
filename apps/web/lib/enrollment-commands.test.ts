import assert from "node:assert/strict"
import test from "node:test"

import {
  buildLinuxInstallCommand,
  buildSocWindowsInstallCommand,
  buildVpnAndSocWindowsInstallCommand,
  buildWindowsInstallCommand,
} from "./enrollment-commands"

test("builds the Windows VPN enrollment command", () => {
  assert.equal(
    buildWindowsInstallCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
    }),
    [
      "$Token = 'nms_enroll_abc''123';",
      '$Script = "$env:TEMP\\lockhaven-enroll.ps1";',
      'Invoke-WebRequest -Uri "https://vpn.example.com/install/enroll-windows.ps1" -OutFile $Script;',
      "powershell.exe -ExecutionPolicy Bypass -File $Script -Token $Token",
    ].join(" ")
  )
})

test("builds the Linux VPN enrollment command", () => {
  assert.equal(
    buildLinuxInstallCommand({
      token: "nms_enroll_abc'123",
      baseUrl: "https://vpn.example.com/",
    }),
    "curl -fsSL https://vpn.example.com/install/enroll-linux.sh | sudo LOCKHAVEN_TOKEN='nms_enroll_abc'\\''123' bash"
  )
})

test("builds the SOC enrollment command with the site name", () => {
  assert.equal(
    buildSocWindowsInstallCommand({
      baseUrl: "https://soc.example.com/",
      siteName: "Venue '001'",
      deviceRole: "windows-endpoint",
      enrollmentPassword: 'secret"`123',
    }),
    [
      "$BaseUrl = 'https://soc.example.com';",
      '$Script = "$env:TEMP\\lockhaven-soc-enroll.ps1";',
      'Invoke-WebRequest -Uri "$BaseUrl/install/enroll-windows.ps1" -OutFile $Script;',
      'powershell.exe -ExecutionPolicy Bypass -File $Script -BaseUrl $BaseUrl -SiteId "Venue \'001\'" -DeviceRole "windows-endpoint" -EnrollmentPassword "secret`` `"123"',
    ].join(" ")
  )
})

test("builds a combined Windows VPN and SOC enrollment command", () => {
  assert.equal(
    buildVpnAndSocWindowsInstallCommand({
      vpnToken: "nms_enroll_abc",
      vpnBaseUrl: "https://vpn.example.com",
      socBaseUrl: "https://soc.example.com",
      siteName: "venue-001",
      deviceRole: "windows-endpoint",
      enrollmentPassword: "soc-secret",
    }),
    `${buildWindowsInstallCommand({
      token: "nms_enroll_abc",
      baseUrl: "https://vpn.example.com",
    })}; ${buildSocWindowsInstallCommand({
      baseUrl: "https://soc.example.com",
      siteName: "venue-001",
      deviceRole: "windows-endpoint",
      enrollmentPassword: "soc-secret",
    })}`
  )
})
