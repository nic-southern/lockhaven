[CmdletBinding()]
param(
  [string]$Token = $env:LOCKHAVEN_TOKEN,

  [string]$BaseUrl = $env:LOCKHAVEN_BASE_URL,

  [string]$DeviceId = $env:LOCKHAVEN_DEVICE_ID,

  [string]$TunnelName = $(if ($env:LOCKHAVEN_TUNNEL_NAME) { $env:LOCKHAVEN_TUNNEL_NAME } else { "lockhaven" }),

  [string]$InstallDir,

  [switch]$RunAsAdministrator
)

$ErrorActionPreference = "Stop"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-GoArch {
  $arch = $env:PROCESSOR_ARCHITEW6432
  if (-not $arch) {
    $arch = $env:PROCESSOR_ARCHITECTURE
  }
  switch ($arch.ToUpperInvariant()) {
    "AMD64" { return "amd64" }
    "ARM64" { return "arm64" }
    default {
      throw "This architecture is not supported yet."
    }
  }
}

function Get-WireGuardPaths {
  $programFilesCandidates = @(
    $env:ProgramW6432,
    $env:ProgramFiles
  ) | Where-Object { $_ }

  $wgExe = $null
  $wireguardExe = $null
  foreach ($programFiles in $programFilesCandidates) {
    $candidateWg = Join-Path $programFiles "WireGuard\wg.exe"
    $candidateWireGuard = Join-Path $programFiles "WireGuard\wireguard.exe"
    if (-not $wgExe -and (Test-Path $candidateWg)) {
      $wgExe = $candidateWg
    }
    if (-not $wireguardExe -and (Test-Path $candidateWireGuard)) {
      $wireguardExe = $candidateWireGuard
    }
  }

  [pscustomobject]@{
    WgExe = $wgExe
    WireGuardExe = $wireguardExe
    InstallerPath = Join-Path $env:TEMP "wireguard-installer.exe"
  }
}

function Ensure-WireGuardInstalled {
  $paths = Get-WireGuardPaths
  if ($paths.WgExe -and $paths.WireGuardExe) {
    return $paths
  }

  $installerUrl = "https://download.wireguard.com/windows-client/wireguard-installer.exe"
  Write-Host "Downloading WireGuard..."
  Invoke-WebRequest -Uri $installerUrl -OutFile $paths.InstallerPath

  Write-Host "Installing WireGuard..."
  $installer = Start-Process -FilePath $paths.InstallerPath -ArgumentList @("/S") -Wait -PassThru
  if ($installer.ExitCode -ne 0) {
    throw "WireGuard installer exited with code $($installer.ExitCode)."
  }

  $paths = Get-WireGuardPaths
  if (-not $paths.WgExe -or -not $paths.WireGuardExe) {
    throw "WireGuard was not found after installation."
  }

  return $paths
}

if (-not $RunAsAdministrator -and -not (Test-Administrator)) {
  $scriptPath = $MyInvocation.MyCommand.Path
  $argumentList = @(
    "-NoProfile"
    "-ExecutionPolicy"
    "Bypass"
    "-File"
    $scriptPath
    "-TunnelName"
    $TunnelName
    "-RunAsAdministrator"
  )
  if ($Token) {
    $argumentList += @("-Token", $Token)
  }
  if ($BaseUrl) {
    $argumentList += @("-BaseUrl", $BaseUrl)
  }
  if ($DeviceId) {
    $argumentList += @("-DeviceId", $DeviceId)
  }
  if ($InstallDir) {
    $argumentList += @("-InstallDir", $InstallDir)
  }
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argumentList | Out-Null
  return
}

if (-not $BaseUrl) {
  throw "Set LOCKHAVEN_BASE_URL or pass -BaseUrl."
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$goarch = Get-GoArch
$binaryUrl = "{0}/install/lockhaven-agent-windows-{1}.exe" -f $BaseUrl, $goarch

if (-not $InstallDir) {
  $programFiles = $env:ProgramW6432
  if (-not $programFiles) {
    $programFiles = $env:ProgramFiles
  }
  $InstallDir = Join-Path $programFiles "Lockhaven"
}

$dest = Join-Path $InstallDir "lockhaven-agent.exe"
$tmp = Join-Path $env:TEMP "lockhaven-agent.exe"

Write-Host "Downloading the Lockhaven agent..."
Invoke-WebRequest -Uri $binaryUrl -OutFile $tmp

$existing = Get-Service -Name "LockhavenAgent" -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -ne "Stopped") {
  Stop-Service -Name "LockhavenAgent" -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path $tmp -Destination $dest -Force

$null = Ensure-WireGuardInstalled

$statePath = Join-Path $env:ProgramData "Lockhaven\agent.json"
if (-not $Token -and -not (Test-Path $statePath)) {
  throw "Set LOCKHAVEN_TOKEN, or install on a device that already has local agent state."
}

$env:LOCKHAVEN_TOKEN = $Token
$env:LOCKHAVEN_BASE_URL = $BaseUrl
$env:LOCKHAVEN_TUNNEL_NAME = $TunnelName
if ($DeviceId) {
  $env:LOCKHAVEN_DEVICE_ID = $DeviceId
}

& $dest install
if ($LASTEXITCODE -ne 0) {
  throw "Agent install failed."
}
