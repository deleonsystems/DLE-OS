[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $StageDirectory,
    [Parameter(Mandatory)] [string] $ArtifactDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Development ControlHost installation requires the elevated approved DLE-OS identity.'
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stage = (Resolve-Path -LiteralPath $StageDirectory).Path
$artifact = [IO.Path]::GetFullPath($ArtifactDirectory)
$runtimeRoot = 'C:\DLE-OS\Development\OperationalControlHost5054'
$version = '20260805T235000Z'
$runtime = Join-Path $runtimeRoot $version
$productionRuntime = 'C:\Program Files\DLE-OS\LiveSnapshotRefreshControl'
$productionEvidence = Get-Content -Raw 'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\control-launch-evidence.json' | ConvertFrom-Json
$evidence = [ordered]@{
    Verdict='FAIL'; StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('O'); Identity=$identity.Name;
    Stage=$stage; Runtime=$runtime; ProductionPidBefore=[int]$productionEvidence.ProcessId;
    ProductionExeHashBefore=(Get-FileHash (Join-Path $productionRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.exe') -Algorithm SHA256).Hash;
    ProductionDllHashBefore=(Get-FileHash (Join-Path $productionRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.dll') -Algorithm SHA256).Hash
}

try {
    if (Test-Path -LiteralPath $runtime) { throw "Development runtime version already exists: $runtime" }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    Copy-Item -Path (Join-Path $stage '*') -Destination $runtime -Recurse -Force
    $launcherEvidence = Join-Path $artifact 'controlhost-5054-launch.json'
    & (Join-Path $repository 'Tools\DevelopmentRuntime\Start-DevelopmentOperationalControlHost.ps1') `
        -RuntimeDirectory $runtime -EvidencePath $launcherEvidence
    $launch = Get-Content -Raw $launcherEvidence | ConvertFrom-Json
    $productionAfter = Get-Content -Raw 'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\control-launch-evidence.json' | ConvertFrom-Json
    $evidence.ProductionPidAfter = [int]$productionAfter.ProcessId
    $evidence.ProductionExeHashAfter = (Get-FileHash (Join-Path $productionRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.exe') -Algorithm SHA256).Hash
    $evidence.ProductionDllHashAfter = (Get-FileHash (Join-Path $productionRuntime 'DleOs.LiveSnapshotRefresh.ControlHost.dll') -Algorithm SHA256).Hash
    if ($evidence.ProductionPidAfter -ne $evidence.ProductionPidBefore -or
        $evidence.ProductionExeHashAfter -ne $evidence.ProductionExeHashBefore -or
        $evidence.ProductionDllHashAfter -ne $evidence.ProductionDllHashBefore) {
        throw 'The production 5043 runtime changed during development installation.'
    }
    $evidence.DevelopmentLaunch = $launch
    $evidence.Rollback = [ordered]@{
        StopProcessId=[int]$launch.ProcessId
        RemoveRuntimeDirectory=$runtime
        DropDatabase='DLE_OS_OPERATIONAL_DEV'
        ProductionRuntimeAction='None'
    }
    $evidence.Verdict='PASS'
}
catch { $evidence.Error=$_.Exception.Message; throw }
finally {
    $evidence.CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('O')
    New-Item -ItemType Directory -Path $artifact -Force | Out-Null
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $artifact 'controlhost-5054-installation.json') -Encoding UTF8
}

[pscustomobject]$evidence
