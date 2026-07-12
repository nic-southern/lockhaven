[CmdletBinding()]
param(
  [string]$TunnelName = "lockhaven",

  [switch]$RunAsAdministrator
)

$ErrorActionPreference = "Stop"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
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
  }
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

  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argumentList | Out-Null
  return
}

Write-Host "Removing $TunnelName tunnel..."

$paths = Get-WireGuardPaths
$serviceName = "WireGuardTunnel`$$TunnelName"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -eq "Running") {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  }
}

if ($paths.WireGuardExe) {
  try {
    & $paths.WireGuardExe /uninstalltunnelservice $TunnelName | Out-Null
  } catch {
    # Ignore missing tunnel service.
  }
} else {
  Write-Host "WireGuard was not found; skipped tunnel service removal."
}

$secretPath = Join-Path $env:TEMP "$TunnelName.check-in-secret.txt"
$configPath = Join-Path $env:TEMP "$TunnelName.conf"
Remove-Item -Path $secretPath, $configPath -Force -ErrorAction SilentlyContinue

Write-Host "Uninstall complete."
Write-Host "Tunnel service and local Lockhaven files were removed."
Write-Host "Revoke the device in the Console if it should no longer appear there."
Write-Host "WireGuard itself was left installed."
