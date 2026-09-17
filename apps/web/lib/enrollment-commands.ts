function normalizeBaseUrl(value: string) {
  const trimmed = value.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  return withProtocol.replace(/\/+$/, "")
}

function quotePowerShell(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function buildWindowsInstallCommand({
  token,
  baseUrl,
  deviceId,
}: {
  token: string
  baseUrl: string
  deviceId?: string | null
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const parts = [
    `$Token = ${quotePowerShell(token)};`,
    `$BaseUrl = ${quotePowerShell(normalizedBaseUrl)};`,
  ]
  if (deviceId) {
    parts.push(`$DeviceId = ${quotePowerShell(deviceId)};`)
  }
  parts.push(
    `$Script = "$env:TEMP\\install-lockhaven-agent.ps1";`,
    `Invoke-WebRequest -Uri "${normalizedBaseUrl}/install/install-lockhaven-agent.ps1" -OutFile $Script;`,
    "powershell.exe -ExecutionPolicy Bypass -File $Script -Token $Token -BaseUrl $BaseUrl"
  )
  if (deviceId) {
    parts[parts.length - 1] += " -DeviceId $DeviceId"
  }
  return parts.join(" ")
}

export function buildWindowsEnrollCommand({
  token,
  baseUrl,
}: {
  token: string
  baseUrl: string
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  return [
    `$Token = ${quotePowerShell(token)};`,
    `$BaseUrl = ${quotePowerShell(normalizedBaseUrl)};`,
    `$Script = "$env:TEMP\\lockhaven-enroll.ps1";`,
    `Invoke-WebRequest -Uri "${normalizedBaseUrl}/install/enroll-windows.ps1" -OutFile $Script;`,
    "powershell.exe -ExecutionPolicy Bypass -File $Script -Token $Token -BaseUrl $BaseUrl",
  ].join(" ")
}

export function buildLinuxInstallCommand({
  token,
  baseUrl,
  deviceId,
}: {
  token: string
  baseUrl: string
  deviceId?: string | null
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const env = [
    `LOCKHAVEN_TOKEN=${quoteShell(token)}`,
    `LOCKHAVEN_BASE_URL=${quoteShell(normalizedBaseUrl)}`,
  ]
  if (deviceId) {
    env.push(`LOCKHAVEN_DEVICE_ID=${quoteShell(deviceId)}`)
  }
  return `curl -fsSL ${normalizedBaseUrl}/install/install-lockhaven-agent.sh | sudo ${env.join(" ")} bash`
}

export function buildLinuxEnrollCommand({
  token,
  baseUrl,
}: {
  token: string
  baseUrl: string
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  return `curl -fsSL ${normalizedBaseUrl}/install/enroll-linux.sh | sudo LOCKHAVEN_TOKEN=${quoteShell(token)} LOCKHAVEN_BASE_URL=${quoteShell(normalizedBaseUrl)} bash`
}

export function buildAgentDownloadUrl({
  baseUrl,
  arch,
  platform = "linux",
}: {
  baseUrl: string
  arch: "amd64" | "arm64"
  platform?: "linux" | "windows"
}) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (platform === "windows") {
    return `${normalized}/install/lockhaven-agent-windows-${arch}.exe`
  }
  return `${normalized}/install/lockhaven-agent-linux-${arch}`
}

export function buildAndroidInstallCommand({
  token,
  baseUrl,
}: {
  token: string
  baseUrl: string
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  return [
    `curl -fsSL ${normalizedBaseUrl}/install/enroll-android.sh`,
    `-o /tmp/lockhaven-enroll-android.sh`,
    `&& LOCKHAVEN_TOKEN=${quoteShell(token)}`,
    `LOCKHAVEN_BASE_URL=${quoteShell(normalizedBaseUrl)}`,
    `bash /tmp/lockhaven-enroll-android.sh`,
  ].join(" ")
}

export function buildWindowsUninstallCommand({ baseUrl }: { baseUrl: string }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  return [
    `$Script = "$env:TEMP\\lockhaven-uninstall.ps1";`,
    `Invoke-WebRequest -Uri "${normalizedBaseUrl}/install/uninstall-windows.ps1" -OutFile $Script;`,
    "powershell.exe -ExecutionPolicy Bypass -File $Script",
  ].join(" ")
}

export function buildLinuxUninstallCommand({ baseUrl }: { baseUrl: string }) {
  return `curl -fsSL ${normalizeBaseUrl(baseUrl)}/install/uninstall-linux.sh | sudo bash`
}
