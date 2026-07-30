[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $RunId,
    [Parameter(Mandatory)]
    [Guid] $ImportRunId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine 'DLE-OS-HOST\DLE-OS') {
    throw (
        'Qualified refresh-state finalization requires ' +
        'DLE-OS-HOST\DLE-OS.'
    )
}
$statusPath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json'
$sourceStatePath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\' +
    'qualified-source-state.json'
$resumeResult =
    'C:\DLE-OS\Canonical\LiveMirror\RefreshRuns\' +
    "$RunId\qualified-resume-result.json"
$artifact =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
    'PurchaseOrderPlatform001\' +
    'PURCHASEORDERPLATFORM001-20260729T212157Z\' +
    'FORCE_FULL_REFRESH_STATE_FINALIZATION.json'
foreach ($path in @($statusPath, $sourceStatePath, $resumeResult)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Refresh-state finalization input is absent: $path"
    }
}

$status =
    Get-Content -LiteralPath $statusPath -Raw |
    ConvertFrom-Json
$sourceState =
    Get-Content -LiteralPath $sourceStatePath -Raw |
    ConvertFrom-Json
$resume =
    Get-Content -LiteralPath $resumeResult -Raw |
    ConvertFrom-Json
$readiness =
    Invoke-RestMethod `
        -Uri (
            'http://DLE-OS-HOST:5042/' +
            'api/platform/live/v1/readiness'
        ) `
        -TimeoutSec 10
if (
    $status.RunId -cne $RunId -or
    -not [bool]$status.ForceFullExtraction -or
    $resume.Verdict -ne 'PASS' -or
    $resume.RunId -cne $RunId -or
    $readiness.readinessVerdict -ne 'Ready' -or
    [Guid]$readiness.currentImportRunId -ne $ImportRunId -or
    [string]$readiness.mirrorRunId -cne
        [string]$resume.BaseMirrorRunId -or
    [string]$readiness.packageHash -cne
        [string]$resume.BasePackageHash -or
    [long]$readiness.totalCount -ne 42322
) {
    throw 'Qualified refresh-state finalization evidence does not reconcile.'
}

$completedAt = [DateTimeOffset]::UtcNow.ToString('O')
$sourceCheckedAt = [string]$status.LastSourceCheckUtc
$sourceState.QualifiedAtUtc = $sourceCheckedAt
$sourceStage =
    $sourceStatePath + '.' + [Guid]::NewGuid().ToString('N') + '.staging'
[IO.File]::WriteAllText(
    $sourceStage,
    ($sourceState | ConvertTo-Json -Depth 10) + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $sourceStage `
    -Destination $sourceStatePath -Force

$status.Running = $false
$status.Status = 'SUCCESS'
$status.Phase = 'COMPLETED'
$status.Message =
    'A qualified force-full snapshot was promoted. Use Refresh View when ready.'
$status.ActiveImportRunId = $ImportRunId.ToString('D')
$status.CurrentPackageHash = [string]$readiness.packageHash
$status.LastSuccessfulRefreshUtc = $completedAt
$status.LastResult = 'SUCCESS'
$status.LastFailureReason = $null
$status.Recovery = @(
    'QUALIFIED_LOCAL_PROMOTION_RESUME_AFTER_IMPORTER_REPAIR'
)
$status.CompletedAtUtc = $completedAt
$statusStage =
    $statusPath + '.' + [Guid]::NewGuid().ToString('N') + '.staging'
[IO.File]::WriteAllText(
    $statusStage,
    ($status | ConvertTo-Json -Depth 10) + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $statusStage -Destination $statusPath -Force

$result = [ordered]@{
    Verdict = 'PASS'
    RunId = $RunId
    ImportRunId = $ImportRunId.ToString('D')
    MirrorRunId = [string]$readiness.mirrorRunId
    PackageHash = [string]$readiness.packageHash
    SnapshotTimestampUtc =
        [string]$readiness.snapshotTimestampUtc
    SourceCheckedAtUtc = $sourceCheckedAt
    FinalizedAtUtc = $completedAt
    ExecutionIdentity = $identity
    SourceAccessPerformed = $false
    XDriveWrites = 0
}
$result |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $artifact -Encoding UTF8
$result | ConvertTo-Json -Depth 5
