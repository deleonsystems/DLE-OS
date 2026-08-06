[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The service test launcher requires an elevated Administrator token.'
}

$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$launcherErrorPath = Join-Path $repository '.tmp\authenticated-frontend\phase3-service-module-launch-error.log'
try {
$taskName = 'DLE-OS Phase 3 Compatibility Service Tests'
$serviceIdentity = 'DLE-OS-HOST\DLE-OS'
$runner = Join-Path $PSScriptRoot 'Run-ServiceIdentityModuleTests.ps1'
$resultPath = Join-Path $repository '.tmp\authenticated-frontend\phase3-service-module-tests.json'
if (Test-Path -LiteralPath $resultPath) { Remove-Item -LiteralPath $resultPath -Force }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
    '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '"')
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $serviceIdentity `
    -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $taskPrincipal `
    -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$deadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
do {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $resultPath) { break }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    if ($info.LastTaskResult -ne 267009 -and $info.LastRunTime -gt [datetime]'2000-01-01') {
        throw "Service test task stopped with result $($info.LastTaskResult)."
    }
} while ([DateTimeOffset]::UtcNow -lt $deadline)

if (-not (Test-Path -LiteralPath $resultPath)) {
    throw 'Service test task did not produce its governed result.'
}
Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
}
catch {
    New-Item -ItemType Directory -Path (Split-Path $launcherErrorPath -Parent) -Force | Out-Null
    ($_ | Out-String) | Set-Content -LiteralPath $launcherErrorPath -Encoding utf8
    throw
}
