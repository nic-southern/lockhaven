[CmdletBinding()]
param(
  [string]$Token = $env:LOCKHAVEN_TOKEN,

  [string]$BaseUrl = "https://vpn.newmarketsecurity.com",

  [string]$Hostname = $env:COMPUTERNAME,

  [string]$OsVersion,

  [string]$Architecture,

  [string]$SerialNumber,

  [string]$TunnelName = "lockhaven",

  [switch]$RunAsAdministrator
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
  throw "Provide an enrollment token with -Token or LOCKHAVEN_TOKEN."
}

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

function Invoke-EnrollmentRequest {
  param(
    [string]$Uri,
    [object]$Body
  )

  $request = @{
    Method = "Post"
    Uri = $Uri
    ContentType = "application/json"
    Body = ($Body | ConvertTo-Json -Depth 6)
  }

  $irmCommand = Get-Command Invoke-RestMethod
  if ($irmCommand.Parameters.ContainsKey("SkipCertificateCheck")) {
    $request.SkipCertificateCheck = $true
    return Invoke-RestMethod @request
  }

  $previousCallback = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
  try {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = {
      param($sender, $certificate, $chain, $sslPolicyErrors)
      return $true
    }

    return Invoke-RestMethod @request
  } finally {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $previousCallback
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
    "-Token"
    $Token
    "-BaseUrl"
    $BaseUrl
    "-Hostname"
    $Hostname
    "-TunnelName"
    $TunnelName
    "-RunAsAdministrator"
  )

  if ($OsVersion) {
    $argumentList += @("-OsVersion", $OsVersion)
  }

  if ($Architecture) {
    $argumentList += @("-Architecture", $Architecture)
  }

  if ($SerialNumber) {
    $argumentList += @("-SerialNumber", $SerialNumber)
  }

  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argumentList | Out-Null
  return
}

if (-not $OsVersion) {
  $OsVersion = (Get-CimInstance Win32_OperatingSystem).Version
}

if (-not $Architecture) {
  $Architecture = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "x86" }
}

if (-not $SerialNumber) {
  $SerialNumber = (Get-CimInstance Win32_BIOS).SerialNumber
}

$paths = Ensure-WireGuardInstalled
$privateKey = (& $paths.WgExe genkey).Trim()
$publicKey = ($privateKey | & $paths.WgExe pubkey).Trim()
$enrollUri = ("{0}/api/enroll" -f $BaseUrl.TrimEnd("/"))

$payload = @{
  token = $Token
  hostname = $Hostname
  os_family = "windows"
  os_version = $OsVersion
  architecture = $Architecture
  serial_number = $SerialNumber
  wireguard_public_key = $publicKey
  services = @(
    @{
      type = "rdp"
      protocol = "tcp"
      port = 3389
    }
  )
}

Write-Host "Enrolling device..."
$response = Invoke-EnrollmentRequest -Uri $enrollUri -Body $payload

$secretPath = Join-Path $env:TEMP "$TunnelName.check-in-secret.txt"
Set-Content -Path $secretPath -Value $response.check_in_secret -Encoding Ascii

$configPath = Join-Path $env:TEMP "$TunnelName.conf"
$config = @"
[Interface]
Address = $($response.vpn_ipv4)
PrivateKey = $privateKey

[Peer]
PublicKey = $($response.wireguard.server_public_key)
Endpoint = $($response.wireguard.endpoint)
AllowedIPs = $($response.wireguard.allowed_ips -join ", ")
PersistentKeepalive = $($response.wireguard.persistent_keepalive)
"@

Set-Content -Path $configPath -Value $config -Encoding Ascii

$serviceName = "WireGuardTunnel`$$TunnelName"
Write-Host "Installing tunnel service..."
try {
  & $paths.WireGuardExe /uninstalltunnelservice $TunnelName | Out-Null
} catch {
  # Ignore missing service on first install.
}

$installProcess = Start-Process -FilePath $paths.WireGuardExe -ArgumentList @("/installtunnelservice", $configPath) -Wait -PassThru
if ($installProcess.ExitCode -ne 0) {
  throw "Tunnel service install failed with code $($installProcess.ExitCode)."
}

Start-Sleep -Seconds 2

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne "Running") {
  Start-Service -Name $serviceName
}

Write-Host "WireGuard tunnel ready."
Write-Host "Service: $serviceName"
Write-Host "Config: $configPath"
Write-Host "Check-in secret: $secretPath"
