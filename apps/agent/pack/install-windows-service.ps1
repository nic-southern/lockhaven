param(
  [string]$NodeExe = (Get-Command node).Source,
  [string]$AgentScript = "$PSScriptRoot\..\dist\apps\agent\src\index.js"
)

$ErrorActionPreference = "Stop"

$action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$AgentScript`" run"
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "LockhavenAgent" -Action $action -Trigger $trigger -RunLevel Highest -Force | Out-Null
Write-Host "Lockhaven agent task installed."
