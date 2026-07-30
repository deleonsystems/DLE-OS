[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedIdentity = 'DLE-OS-HOST\DLE-OS'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$sourceRoot = Join-Path $repository 'Tools\LiveSnapshotRefresh'
$runtimeRoot = 'C:\DLE-OS\Canonical\LiveMirror\Refresh'
$artifactRoot = Join-Path $repository (
    'Artifacts\PurchaseOrderPlatform001\' +
    'PURCHASEORDERPLATFORM001-20260729T212157Z')
$evidencePath = Join-Path $artifactRoot (
    'FORCE_FULL_REFRESH_DEPLOYMENT.json')
$normalLauncher = Join-Path $sourceRoot 'Start-LiveSnapshotRefresh.cmd'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $expectedIdentity) {
    throw "Deployment requires $expectedIdentity; actual identity is $identity."
}
$normalLauncherHashBefore =
    (Get-FileHash -LiteralPath $normalLauncher -Algorithm SHA256).Hash
$files = @(
    'Invoke-LiveSnapshotRefresh.ps1',
    'RefreshDecision.psm1'
)
foreach ($name in $files) {
    $source = Join-Path $sourceRoot $name
    $destination = Join-Path $runtimeRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required force-full component is absent: $source"
    }
    Copy-Item -LiteralPath $source -Destination $destination -Force
    if (
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    ) {
        throw "Deployed force-full component hash mismatch: $name"
    }
}
$normalLauncherHashAfter =
    (Get-FileHash -LiteralPath $normalLauncher -Algorithm SHA256).Hash
if ($normalLauncherHashBefore -cne $normalLauncherHashAfter) {
    throw 'The ordinary browser refresh launcher changed unexpectedly.'
}

$evidence = [ordered]@{
    Verdict = 'PASS'
    DeployedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ExecutionIdentity = $identity
    RuntimeRoot = $runtimeRoot
    DeployedFiles = @(
        foreach ($name in $files) {
            [ordered]@{
                Name = $name
                Sha256 = (
                    Get-FileHash -LiteralPath (
                        Join-Path $runtimeRoot $name
                    ) -Algorithm SHA256
                ).Hash
            }
        }
    )
    OrdinaryBrowserLauncherUnchanged = $true
    OrdinaryBrowserLauncherSha256 = $normalLauncherHashAfter
    ForceFullOperatorLauncher = Join-Path $sourceRoot (
        'Start-LiveSnapshotForceFullRefresh.ps1')
    SourceAccessPerformed = $false
}
$evidence |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath $evidencePath -Encoding UTF8
$evidence | ConvertTo-Json -Depth 6
