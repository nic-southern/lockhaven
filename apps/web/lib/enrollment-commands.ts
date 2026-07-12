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
