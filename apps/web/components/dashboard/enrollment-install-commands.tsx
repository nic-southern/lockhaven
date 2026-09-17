"use client"

import { CodeBlock } from "@/components/dashboard/code-block"
import {
  buildAndroidInstallCommand,
  buildLinuxEnrollCommand,
  buildLinuxInstallCommand,
  buildWindowsInstallCommand,
} from "@/lib/enrollment-commands"
import { getClientVpnBaseUrl } from "@/lib/product-name"

export function EnrollmentInstallCommands({
  token,
  deviceId,
}: {
  token: string
  deviceId?: string | null
}) {
  const baseUrl = getClientVpnBaseUrl()

  return (
    <div className="flex flex-col gap-3">
      <CodeBlock
        label="Linux agent"
        value={buildLinuxInstallCommand({ token, baseUrl, deviceId })}
      />
      <CodeBlock
        label="Linux tunnel only"
        value={buildLinuxEnrollCommand({ token, baseUrl })}
      />
      <CodeBlock
        label="Windows"
        value={buildWindowsInstallCommand({ token, baseUrl })}
      />
      <CodeBlock
        label="Android"
        value={buildAndroidInstallCommand({ token, baseUrl })}
      />
    </div>
  )
}
