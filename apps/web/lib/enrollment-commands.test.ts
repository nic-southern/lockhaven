import assert from "node:assert/strict"
import test from "node:test"

import {
  buildLinuxInstallCommand,
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
