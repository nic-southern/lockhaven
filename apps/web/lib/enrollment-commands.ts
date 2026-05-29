const DEFAULT_SOC_DEVICE_ROLE = "windows-endpoint"

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

function quotePowerShellDouble(value: string) {
  return `"${value.replaceAll("`", "``").replaceAll('"', '`"')}"`
}

function quoteShell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function buildWindowsInstallCommand({
  token,
  baseUrl,
}: {
  token: string
  baseUrl: string
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  return [
    `$Token = ${quotePowerShell(token)};`,
    `$Script = "$env:TEMP\\lockhaven-enroll.ps1";`,
    `Invoke-WebRequest -Uri "${normalizedBaseUrl}/install/enroll-windows.ps1" -OutFile $Script;`,
    "powershell.exe -ExecutionPolicy Bypass -File $Script -Token $Token",
  ].join(" ")
}

export function buildLinuxInstallCommand({
  token,
  baseUrl,
}: {
  token: string
  baseUrl: string
}) {
  return `curl -fsSL ${normalizeBaseUrl(baseUrl)}/install/enroll-linux.sh | sudo LOCKHAVEN_TOKEN=${quoteShell(token)} bash`
}

export function buildSocWindowsInstallCommand({
  baseUrl,
  siteName,
  enrollmentPassword,
  deviceRole = DEFAULT_SOC_DEVICE_ROLE,
}: {
  baseUrl: string
  siteName: string
  enrollmentPassword: string
  deviceRole?: string
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  return [
    `$BaseUrl = ${quotePowerShell(normalizedBaseUrl)};`,
    `$Script = "$env:TEMP\\lockhaven-soc-enroll.ps1";`,
    'Invoke-WebRequest -Uri "$BaseUrl/install/enroll-windows.ps1" -OutFile $Script;',
    `powershell.exe -ExecutionPolicy Bypass -File $Script -BaseUrl $BaseUrl -SiteId ${quotePowerShellDouble(siteName)} -DeviceRole ${quotePowerShellDouble(deviceRole)} -EnrollmentPassword ${quotePowerShellDouble(enrollmentPassword)}`,
  ].join(" ")
}

export function buildVpnAndSocWindowsInstallCommand({
  vpnToken,
  vpnBaseUrl,
  socBaseUrl,
  siteName,
  enrollmentPassword,
  deviceRole = DEFAULT_SOC_DEVICE_ROLE,
}: {
  vpnToken: string
  vpnBaseUrl: string
  socBaseUrl: string
  siteName: string
  enrollmentPassword: string
  deviceRole?: string
}) {
  return `${buildWindowsInstallCommand({
    token: vpnToken,
    baseUrl: vpnBaseUrl,
  })}; ${buildSocWindowsInstallCommand({
    baseUrl: socBaseUrl,
    siteName,
    enrollmentPassword,
    deviceRole,
  })}`
}
