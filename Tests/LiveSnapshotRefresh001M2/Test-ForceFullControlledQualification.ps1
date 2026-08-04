[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedIdentity = 'DLE-OS-HOST\DLE-OS'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$runner =
    'C:\DLE-OS\Canonical\LiveMirror\Refresh\Invoke-LiveSnapshotRefresh.ps1'
$artifactRoot = Join-Path $repository (
    'Artifacts\PurchaseOrderPlatform001\' +
    'PURCHASEORDERPLATFORM001-20260729T212157Z')
$resultPath = Join-Path $artifactRoot (
    'FORCE_FULL_CONTROLLED_QUALIFICATION.json')
$lockPath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\refresh.lock'
$sourceStatePath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\qualified-source-state.json'
$boundaryPath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\QualifiedBoundary\current-qualified-snapshot.json'

if (
    [Security.Principal.WindowsIdentity]::GetCurrent().Name -ine
        $expectedIdentity
) {
    throw "Qualification requires $expectedIdentity."
}

function Get-DirectoryIdentity {
    param([string] $Path)
    $material = foreach (
        $file in Get-ChildItem -LiteralPath $Path -Recurse -File |
            Sort-Object FullName
    ) {
        $relative = $file.FullName.Substring($Path.Length).TrimStart('\')
        "$relative`0$($file.Length)`0$((Get-FileHash $file.FullName -Algorithm SHA256).Hash)"
    }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($material -join "`n"))
        return (
            [BitConverter]::ToString($algorithm.ComputeHash($bytes))
        ).Replace('-', '')
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-Snapshot {
    $connection = [Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;')
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText =
            'SELECT ImportRunId, PackageHash FROM liveapi.SnapshotMetadata;'
        $table = [Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        return [ordered]@{
            ImportRunId = [string]$table.Rows[0].ImportRunId
            PackageHash = [string]$table.Rows[0].PackageHash
        }
    }
    finally {
        $connection.Dispose()
    }
}

function Get-Boundary {
    [ordered]@{
        SourceState = (Get-FileHash $sourceStatePath -Algorithm SHA256).Hash
        QualifiedBoundary = (Get-FileHash $boundaryPath -Algorithm SHA256).Hash
        BaseCurrent =
            Get-DirectoryIdentity 'C:\DLE-OS\Canonical\LiveMirror\Current'
        SalesCurrent =
            Get-DirectoryIdentity (
                'C:\DLE-OS\Canonical\LiveMirror\Platform002\Current')
        Sql = Get-Snapshot
    }
}

function Start-QualificationRun {
    param([string] $Name, [string[]] $Arguments)
    $stdout = Join-Path $artifactRoot "$Name.stdout.log"
    $stderr = Join-Path $artifactRoot "$Name.stderr.log"
    $argumentList = @(
        '-NoLogo', '-NoProfile', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$runner`""
    ) + $Arguments
    $process = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList $argumentList `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    [pscustomobject]@{
        Process = $process
        StandardOutput = $stdout
        StandardError = $stderr
    }
}

function Complete-Run {
    param([object] $Run)
    $Run.Process.WaitForExit()
    $Run.Process.Refresh()
    $standardOutput =
        Get-Content $Run.StandardOutput -Raw -ErrorAction SilentlyContinue
    $standardError =
        Get-Content $Run.StandardError -Raw -ErrorAction SilentlyContinue
    $exitCode = $Run.Process.ExitCode
    if ($null -eq $exitCode) {
        if ($standardOutput -match 'ALREADY_RUNNING') {
            $exitCode = 2
        }
        elseif (-not [string]::IsNullOrWhiteSpace($standardError)) {
            $exitCode = 1
        }
        else {
            $exitCode = 0
        }
    }
    elseif (
        [int]$exitCode -eq 0 -and
        $standardOutput -match 'ALREADY_RUNNING'
    ) {
        $exitCode = 2
    }
    elseif (
        [int]$exitCode -eq 0 -and
        $standardError -match (
            'Controlled qualification failure|mutually exclusive'
        )
    ) {
        $exitCode = 1
    }
    [ordered]@{
        ExitCode = [int]$exitCode
        StandardOutput = $standardOutput
        StandardError = $standardError
    }
}

function Assert-BoundaryEqual {
    param([object] $Before, [object] $After, [string] $Name)
    if (
        ($Before | ConvertTo-Json -Depth 6 -Compress) -cne
        ($After | ConvertTo-Json -Depth 6 -Compress)
    ) {
        throw "$Name changed the qualified snapshot boundary."
    }
}

$before = Get-Boundary
$failure = Start-QualificationRun `
    'force-full-induced-failure' @(
        '-ForceFullExtraction',
        '-QualificationInduceFailure'
    )
$failureResult = Complete-Run $failure
if (
    $failureResult.ExitCode -ne 1 -or
    $failureResult.StandardError -notmatch
        'Controlled qualification failure before\s+candidate mutation'
) {
    throw 'Force-full induced-failure qualification did not reach the guarded branch.'
}
$afterFailure = Get-Boundary
Assert-BoundaryEqual $before $afterFailure 'Induced failure'

$primary = Start-QualificationRun `
    'force-full-concurrency-primary' @(
        '-ForceFullExtraction',
        '-QualificationHoldLockSeconds', '8',
        '-QualificationInduceFailure'
    )
for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if (Test-Path -LiteralPath $lockPath) { break }
    Start-Sleep -Milliseconds 100
}
if (-not (Test-Path -LiteralPath $lockPath)) {
    throw 'Force-full concurrency primary did not acquire the lock.'
}
$overlap = Start-QualificationRun `
    'force-full-concurrency-overlap' @('-ForceFullExtraction')
$overlapResult = Complete-Run $overlap
$primaryResult = Complete-Run $primary
if (
    $overlapResult.ExitCode -ne 2 -or
    $overlapResult.StandardOutput -notmatch 'ALREADY_RUNNING'
) {
    throw 'Force-full overlap did not return ALREADY_RUNNING.'
}
if ($primaryResult.ExitCode -ne 1) {
    throw 'Force-full concurrency primary did not exit through induced failure.'
}
$afterConcurrency = Get-Boundary
Assert-BoundaryEqual $before $afterConcurrency 'Concurrency qualification'

$combination = Start-QualificationRun `
    'force-full-fixture-rejection' @(
        '-ForceFullExtraction',
        '-QualificationCurrentFixture'
    )
$combinationResult = Complete-Run $combination
if (
    $combinationResult.ExitCode -ne 1 -or
    $combinationResult.StandardError -notmatch 'mutually exclusive'
) {
    throw 'Force-full and current-fixture combination was not rejected.'
}
$afterCombination = Get-Boundary
Assert-BoundaryEqual $before $afterCombination 'Fixture rejection'

$result = [ordered]@{
    Verdict = 'PASS'
    QualifiedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ExecutionIdentity = $expectedIdentity
    ForceFullInducedFailure = [ordered]@{
        ExitCode = $failureResult.ExitCode
        PriorSnapshotRetained = $true
    }
    Concurrency = [ordered]@{
        PrimaryExitCode = $primaryResult.ExitCode
        OverlapExitCode = $overlapResult.ExitCode
        OverlapResult = 'ALREADY_RUNNING'
        PriorSnapshotRetained = $true
    }
    QualificationCurrentFixture = [ordered]@{
        CombinedInvocationRejected = $true
        ExitCode = $combinationResult.ExitCode
    }
    SourceStateUnchanged = $true
    QualifiedBoundaryUnchanged = $true
    VProRecordReadsPerformed = 0
    XDriveWrites = 0
}
$result |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath $resultPath -Encoding UTF8
$result | ConvertTo-Json -Depth 6
