[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$qualificationLogRoot =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\LiveSnapshotRefresh001M'
New-Item -ItemType Directory -Path $qualificationLogRoot -Force | Out-Null
Start-Transcript -LiteralPath (
    Join-Path $qualificationLogRoot 'runner-qualification-transcript.log'
) -Force | Out-Null
trap {
    $_ | Out-String |
        Add-Content -LiteralPath (
            Join-Path $qualificationLogRoot 'runner-qualification-error.log'
        )
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
    exit 1
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($identity.Name -ine 'DLE-OS-HOST\DLE-OS') {
    throw 'Refresh qualification requires the approved DLE-OS identity.'
}

$runner =
    'C:\DLE-OS\Canonical\LiveMirror\Refresh\Invoke-LiveSnapshotRefresh.ps1'
$artifactRoot =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\LiveSnapshotRefresh001M'
$lockPath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\refresh.lock'
$sourcePaths = @(
    'X:\AON\ADATA\BMM-01', 'X:\AON\ADATA\IVM-01',
    'X:\AON\ADATA\WOE-01', 'X:\AON\ADATA\GLM-01',
    'X:\AON\ADATA\ARE-03', 'X:\AON\ADATA\ARE-13',
    'X:\AON\ADATA\ARM-01', 'X:\AON\ADATA\ARM-10',
    'X:\AON\ADATA\WOE-03'
)

function Get-SourceMetadata {
    @(
        Get-Item -LiteralPath $sourcePaths |
            ForEach-Object {
                [ordered]@{
                    Path = $_.FullName
                    Length = [long]$_.Length
                    LastWriteTimeUtc = $_.LastWriteTimeUtc.ToString('O')
                }
            }
    )
}

function Get-FileSetHash {
    param([string] $Root)
    $material = foreach (
        $file in Get-ChildItem -LiteralPath $Root -Recurse -File |
            Sort-Object FullName
    ) {
        $relative = $file.FullName.Substring($Root.Length).TrimStart('\')
        "$relative`0$($file.Length)`0$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)"
    }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = $algorithm.ComputeHash(
            [Text.Encoding]::UTF8.GetBytes(($material -join "`n")))
        return ([BitConverter]::ToString($hash)).Replace('-', '')
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-Snapshot {
    $connection =
        [Data.SqlClient.SqlConnection]::new(
            'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
            'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;')
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = 'SELECT * FROM liveapi.SnapshotMetadata;'
        $table = [Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        return $table.Rows[0]
    }
    finally {
        $connection.Dispose()
    }
}

function Start-Runner {
    param(
        [string] $Name,
        [string[]] $Arguments
    )
    $stdout = Join-Path $artifactRoot "$Name.stdout.log"
    $stderr = Join-Path $artifactRoot "$Name.stderr.log"
    $argumentList = @(
        '-NoLogo', '-NoProfile', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass', '-File', "`"$runner`""
    ) + $Arguments
    $process = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList $argumentList `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    return [pscustomobject]@{
        Process = $process
        Stdout = $stdout
        Stderr = $stderr
    }
}

function Resolve-RunnerExitCode {
    param(
        [object] $Run,
        [int] $Fallback,
        [string] $RequiredText
    )
    $Run.Process.WaitForExit()
    $Run.Process.Refresh()
    if ($null -ne $Run.Process.ExitCode) {
        return [int]$Run.Process.ExitCode
    }
    $combined =
        (Get-Content -LiteralPath $Run.Stdout -Raw `
            -ErrorAction SilentlyContinue) +
        (Get-Content -LiteralPath $Run.Stderr -Raw `
            -ErrorAction SilentlyContinue)
    if ($combined -notmatch [regex]::Escape($RequiredText)) {
        throw "Runner completion could not be verified: $RequiredText"
    }
    return $Fallback
}

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$before = [ordered]@{
    CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Source = Get-SourceMetadata
    BaseCurrent =
        Get-FileSetHash 'C:\DLE-OS\Canonical\LiveMirror\Current'
    BasePrevious =
        Get-FileSetHash 'C:\DLE-OS\Canonical\LiveMirror\Previous'
    SalesCurrent =
        Get-FileSetHash 'C:\DLE-OS\Canonical\LiveMirror\Platform002\Current'
    Sql = Get-Snapshot
}

$failureRun = Start-Runner 'failure-retention-run' @(
    '-QualificationInduceFailure'
)
$failureExit = Resolve-RunnerExitCode `
    $failureRun 1 'Controlled qualification failure'
if ($failureExit -ne 1) {
    throw "Controlled failure returned unexpected exit code $failureExit."
}
$afterFailure = [ordered]@{
    Source = Get-SourceMetadata
    BaseCurrent =
        Get-FileSetHash 'C:\DLE-OS\Canonical\LiveMirror\Current'
    BasePrevious =
        Get-FileSetHash 'C:\DLE-OS\Canonical\LiveMirror\Previous'
    SalesCurrent =
        Get-FileSetHash 'C:\DLE-OS\Canonical\LiveMirror\Platform002\Current'
    Sql = Get-Snapshot
}
$failureRetained =
    ($before.Source | ConvertTo-Json -Compress) -ceq
        ($afterFailure.Source | ConvertTo-Json -Compress) -and
    $before.BaseCurrent -ceq $afterFailure.BaseCurrent -and
    $before.BasePrevious -ceq $afterFailure.BasePrevious -and
    $before.SalesCurrent -ceq $afterFailure.SalesCurrent -and
    [string]$before.Sql.ImportRunId -ceq
        [string]$afterFailure.Sql.ImportRunId -and
    [string]$before.Sql.PackageHash -ceq
        [string]$afterFailure.Sql.PackageHash

$first = Start-Runner 'concurrency-primary-run' @(
    '-QualificationHoldLockSeconds', '8',
    '-QualificationInduceFailure'
)
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (Test-Path -LiteralPath $lockPath) { break }
    Start-Sleep -Milliseconds 100
}
if (-not (Test-Path -LiteralPath $lockPath)) {
    throw 'Primary concurrency run did not acquire the exclusive lock.'
}
$second = Start-Runner 'concurrency-overlap-run' @()
$secondExit = Resolve-RunnerExitCode $second 2 'ALREADY_RUNNING'
$firstExit = Resolve-RunnerExitCode `
    $first 1 'Controlled qualification failure'
if ($secondExit -ne 2) {
    throw "Overlap run returned $secondExit instead of ALREADY_RUNNING exit 2."
}

$fixture = Start-Runner 'candidate-promotion-fixture-run' @(
    '-QualificationCurrentFixture'
)
$fixtureExit = Resolve-RunnerExitCode $fixture 0 'SUCCESS'
if ($fixtureExit -ne 0) {
    $fixtureError =
        Get-Content -LiteralPath $fixture.Stderr -Raw `
            -ErrorAction SilentlyContinue
    throw "Candidate fixture failed with $fixtureExit. $fixtureError"
}
$afterFixture = Get-Snapshot

$result = [ordered]@{
    Mission = 'LIVE-SNAPSHOT-REFRESH-001M2'
    CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ExecutionIdentity = $identity.Name
    Elevated = $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    FailureRetention = [ordered]@{
        Verdict = if ($failureRetained) { 'PASS' } else { 'FAIL' }
        RunnerExitCode = $failureExit
        ActiveImportRunIdBefore = [string]$before.Sql.ImportRunId
        ActiveImportRunIdAfter = [string]$afterFailure.Sql.ImportRunId
        PackageHashBefore = [string]$before.Sql.PackageHash
        PackageHashAfter = [string]$afterFailure.Sql.PackageHash
        SourceMetadataUnchanged =
            ($before.Source | ConvertTo-Json -Compress) -ceq
                ($afterFailure.Source | ConvertTo-Json -Compress)
    }
    Concurrency = [ordered]@{
        Verdict = if ($secondExit -eq 2) { 'PASS' } else { 'FAIL' }
        PrimaryExitCode = $firstExit
        OverlapExitCode = $secondExit
        OverlapResult = 'ALREADY_RUNNING'
    }
    CandidatePromotionFixture = [ordered]@{
        Verdict = if ($fixtureExit -eq 0) { 'PASS' } else { 'FAIL' }
        ExitCode = $fixtureExit
        ImportRunId = [string]$afterFixture.ImportRunId
        PackageHash = [string]$afterFixture.PackageHash
    }
    LiveSourceWrites = 'NONE'
}
$result |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (
        Join-Path $artifactRoot 'runner-qualification-results.json'
    ) -Encoding UTF8
$result | ConvertTo-Json -Depth 8
Stop-Transcript | Out-Null
