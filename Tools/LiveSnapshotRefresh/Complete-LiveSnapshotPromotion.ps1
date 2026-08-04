[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $RunId,
    [switch] $QualificationCurrentFixture
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    -not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Local snapshot promotion requires the elevated approved DLE-OS identity.'
}
if ($RunId -notmatch '^LIVEREFRESH-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$') {
    throw 'Promotion run ID was rejected.'
}

$runsRoot = 'C:\DLE-OS\Canonical\LiveMirror\RefreshRuns'
$runRoot = Join-Path $runsRoot $RunId
if (
    [IO.Path]::GetFullPath($runRoot).TrimEnd('\') -ine
        (Join-Path $runsRoot $RunId).TrimEnd('\') -or
    -not (Test-Path -LiteralPath $runRoot -PathType Container)
) {
    throw 'Promotion run root is outside the fixed local boundary.'
}
$refreshRoot = 'C:\DLE-OS\Canonical\LiveMirror\Refresh'
$baseRoot = 'C:\DLE-OS\Canonical\LiveMirror'
$baseCurrent = Join-Path $baseRoot 'Current'
$basePrevious = Join-Path $baseRoot 'Previous'
$salesRoot = Join-Path $baseRoot 'Platform002'
$salesCurrent = Join-Path $salesRoot 'Current'
$salesPrevious = Join-Path $salesRoot 'Previous'
$rollbackRoot = Join-Path $runRoot 'Rollback'
$importer =
    'C:\DLE-OS\Repositories\DLE-OS-Server\DleOs.PlatformImporter\bin\Release\net8.0\DleOs.PlatformImporter.dll'
$salesImporter =
    'C:\DLE-OS\Repositories\DLE-OS-Server\Tools\Import-Platform002SalesOrders.ps1'
$promoter =
    Join-Path $refreshRoot 'Promote-QualifiedSnapshotBoundary.ps1'
$launcher =
    'C:\DLE-OS\Repositories\DLE-OS-Server\DleOs.PlatformApi.Tests\Start-LiveCanonicalApiAsDedicatedIdentity.ps1'
$dotnet = 'C:\Program Files\dotnet\dotnet.exe'
$resultPath = Join-Path $runRoot 'promotion-result.json'
$errorPath = Join-Path $runRoot 'promotion-error.log'
$statusPath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json'

function Restore-DirectorySnapshot {
    param([string] $Backup, [string] $Target)
    if ($Target -notin @(
        $baseCurrent, $basePrevious, $salesCurrent, $salesPrevious
    )) {
        throw 'A package restoration target is outside the approved slots.'
    }
    if (Test-Path -LiteralPath $Target) {
        Remove-Item -LiteralPath $Target -Recurse -Force
    }
    if (Test-Path -LiteralPath $Backup -PathType Container) {
        New-Item -ItemType Directory -Path $Target -Force | Out-Null
        Copy-Item -Path (Join-Path $Backup '*') `
            -Destination $Target -Recurse -Force
    }
}

function Promote-SalesCandidate {
    $candidate = Join-Path $runRoot 'SalesOrderCandidate'
    if (-not (Test-Path -LiteralPath (Join-Path $candidate 'manifest.json'))) {
        throw 'The staged Sales Order candidate is incomplete.'
    }
    if (Test-Path -LiteralPath $salesPrevious) {
        Remove-Item -LiteralPath $salesPrevious -Recurse -Force
    }
    if (Test-Path -LiteralPath $salesCurrent) {
        Move-Item -LiteralPath $salesCurrent -Destination $salesPrevious
    }
    Move-Item -LiteralPath $candidate -Destination $salesCurrent
}

function Get-CurrentCanonicalPackageHash {
    $connectionString =
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Connect Timeout=5;Application Name=DLE-OS Snapshot Promotion'
    $connection =
        [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT PackageHash
FROM liveapi.SnapshotMetadata;
'@
        $value = $command.ExecuteScalar()
        if ($null -eq $value -or [string]$value -notmatch '^[0-9A-F]{64}$') {
            throw 'Current LIVE package hash is unavailable.'
        }
        return [string]$value
    }
    finally {
        $connection.Dispose()
    }
}

function Invoke-Importer {
    param([switch] $AllowFreshIdenticalPackage)

    $command = 'import'
    if ($AllowFreshIdenticalPackage) {
        $manifestPath = Join-Path $baseCurrent 'manifest.json'
        $manifest =
            Get-Content -LiteralPath $manifestPath -Raw |
            ConvertFrom-Json
        $currentHash = Get-CurrentCanonicalPackageHash
        if ([string]$manifest.package_hash -ceq $currentHash) {
            $command = 'refresh-import'
        }
    }

    & $dotnet $importer $command --profile LIVE
    if ($LASTEXITCODE -ne 0) {
        throw (
            "Canonical LIVE $command returned $LASTEXITCODE."
        )
    }
    & $salesImporter | Out-Null
}

function Get-LiveSnapshotOperationalState {
    $connectionString =
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Connect Timeout=5;Application Name=DLE-OS Snapshot Status'
    $connection =
        [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT
    snapshot.ImportRunId,
    snapshot.MirrorRunId,
    snapshot.PackageHash,
    snapshot.SnapshotTimestampUtc,
    status.SourceCheckedAtUtc,
    status.QualificationCompletedAtUtc,
    status.SourceIndicatorFingerprint,
    status.LastFullExtractionRunId,
    status.LastForceFullIntent
FROM liveapi.SnapshotMetadata AS snapshot
LEFT JOIN liveapi.SnapshotOperationalStatus AS status
    ON status.ImportRunId = snapshot.ImportRunId;
'@
        $table = [System.Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        if ($table.Rows.Count -ne 1) {
            throw 'LIVE operational state did not return exactly one row.'
        }
        return $table.Rows[0]
    }
    finally {
        $connection.Dispose()
    }
}

function Write-LiveFullQualification {
    param(
        [Guid] $ImportRunId,
        [string] $MirrorRunId,
        [string] $PackageHash,
        [DateTime] $SnapshotAsOfUtc,
        [DateTime] $SourceCheckedAtUtc,
        [DateTime] $QualificationCompletedAtUtc,
        [string] $SourceIndicatorFingerprint,
        [string] $FullExtractionRunId,
        [bool] $ForceFullIntent
    )
    $connectionString =
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Connect Timeout=5;Application Name=DLE-OS Full Qualification'
    $connection =
        [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandType =
            [System.Data.CommandType]::StoredProcedure
        $command.CommandText = 'platform.RecordLiveFullQualification'
        [void]$command.Parameters.AddWithValue(
            '@ImportRunId', $ImportRunId)
        [void]$command.Parameters.AddWithValue(
            '@MirrorRunId', $MirrorRunId)
        [void]$command.Parameters.AddWithValue(
            '@PackageHash', $PackageHash)
        $snapshotParameter = $command.Parameters.Add(
            '@SnapshotAsOfUtc', [Data.SqlDbType]::DateTime2)
        $snapshotParameter.Scale = 7
        $snapshotParameter.Value = $SnapshotAsOfUtc
        $sourceCheckedParameter = $command.Parameters.Add(
            '@SourceCheckedAtUtc', [Data.SqlDbType]::DateTime2)
        $sourceCheckedParameter.Scale = 7
        $sourceCheckedParameter.Value = $SourceCheckedAtUtc
        $qualificationParameter = $command.Parameters.Add(
            '@QualificationCompletedAtUtc', [Data.SqlDbType]::DateTime2)
        $qualificationParameter.Scale = 7
        $qualificationParameter.Value = $QualificationCompletedAtUtc
        [void]$command.Parameters.AddWithValue(
            '@SourceIndicatorFingerprint',
            $SourceIndicatorFingerprint)
        [void]$command.Parameters.AddWithValue(
            '@FullExtractionRunId', $FullExtractionRunId)
        [void]$command.Parameters.AddWithValue(
            '@ForceFullIntent', $ForceFullIntent)
        [void]$command.ExecuteNonQuery()
    }
    finally {
        $connection.Dispose()
    }
}

function Stop-LiveApi {
    $listener =
        Get-NetTCPConnection -State Listen -LocalPort 5042 `
            -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $listener) { return }
    $process =
        Get-CimInstance Win32_Process -Filter (
            "ProcessId=$($listener.OwningProcess)"
        )
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
    if (
        "$($owner.Domain)\$($owner.User)" -ine
            'DLE-OS-HOST\DLE-OS-LIVE-API' -or
        [string]$process.CommandLine -notlike
            '*C:\Program Files\DLE-OS\LiveCanonicalApi\DLE-OS-Server.dll*'
    ) {
        throw 'Port 5042 is owned by an unqualified process.'
    }
    Stop-Process -Id $listener.OwningProcess -Force
}

function Start-LiveApi {
    $logRoot = 'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\Logs'
    $launcherProcess = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-NoLogo', '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-File', "`"$launcher`""
        ) `
        -WindowStyle Hidden `
        -RedirectStandardOutput (
            Join-Path $logRoot 'live-launcher.log'
        ) `
        -RedirectStandardError (
            Join-Path $logRoot 'live-launcher.error.log'
        ) `
        -PassThru
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $readiness =
                Invoke-RestMethod `
                    -Uri (
                        'http://DLE-OS-HOST:5042/' +
                        'api/platform/live/v1/readiness'
                    ) `
                    -TimeoutSec 2
            if ($readiness.readinessVerdict -eq 'Ready') { return }
        }
        catch {
            $launcherProcess.Refresh()
            if ($launcherProcess.HasExited) {
                $detail =
                    Get-Content (
                        Join-Path $logRoot 'live-launcher.error.log'
                    ) -Raw -ErrorAction SilentlyContinue
                throw "LIVE launcher exited before readiness. $detail"
            }
        }
    }
    throw 'LIVE API did not reach readiness after local promotion.'
}

$packagesChanged = -not $QualificationCurrentFixture
$operationalBefore = Get-LiveSnapshotOperationalState
try {
    if ($packagesChanged) {
        Promote-SalesCandidate
    }
    Stop-LiveApi
    Invoke-Importer -AllowFreshIdenticalPackage
    & $promoter | Out-Null
    if ($packagesChanged) {
        $candidateStatus =
            Get-Content -LiteralPath $statusPath -Raw |
            ConvertFrom-Json
        if (
            [string]$candidateStatus.CandidateSourceIndicatorFingerprint `
                -notmatch '^[0-9A-F]{64}$' -or
            $null -eq $candidateStatus.CandidateSourceCheckedAtUtc
        ) {
            throw 'Qualified source-check candidate metadata is absent.'
        }
        $sqlAfter = Get-LiveSnapshotOperationalState
        $candidateCheckedAt = (
            [DateTimeOffset](
                [string]$candidateStatus.CandidateSourceCheckedAtUtc)
        ).UtcDateTime
        $candidateFingerprint =
            [string]$candidateStatus.CandidateSourceIndicatorFingerprint
        $candidateForceFull =
            [bool]$candidateStatus.ForceFullExtraction
        Write-LiveFullQualification `
            -ImportRunId ([Guid]$sqlAfter.ImportRunId) `
            -MirrorRunId ([string]$sqlAfter.MirrorRunId) `
            -PackageHash ([string]$sqlAfter.PackageHash) `
            -SnapshotAsOfUtc ([DateTime]$sqlAfter.SnapshotTimestampUtc) `
            -SourceCheckedAtUtc $candidateCheckedAt `
            -QualificationCompletedAtUtc ([DateTime]::UtcNow) `
            -SourceIndicatorFingerprint $candidateFingerprint `
            -FullExtractionRunId $RunId `
            -ForceFullIntent $candidateForceFull
    }
    Start-LiveApi
    [ordered]@{
        Verdict = 'PASS'
        RunId = $RunId
        QualifiedFixture = [bool]$QualificationCurrentFixture
        PromotedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        ExecutionIdentity = $identity.Name
        XDriveAccessed = $false
    } |
        ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath $resultPath -Encoding UTF8
}
catch {
    $failure = $_.Exception.Message
    $recovery = 'NOT_REQUIRED'
    try {
        if ($packagesChanged) {
            Restore-DirectorySnapshot (
                Join-Path $rollbackRoot 'BaseCurrent'
            ) $baseCurrent
            Restore-DirectorySnapshot (
                Join-Path $rollbackRoot 'BasePrevious'
            ) $basePrevious
            Restore-DirectorySnapshot (
                Join-Path $rollbackRoot 'SalesCurrent'
            ) $salesCurrent
            Restore-DirectorySnapshot (
                Join-Path $rollbackRoot 'SalesPrevious'
            ) $salesPrevious
            Invoke-Importer
            & $promoter | Out-Null
            if (
                $operationalBefore.SourceCheckedAtUtc -ne [DBNull]::Value
            ) {
                $priorQualificationCompletedAt =
                    [DateTime]$operationalBefore.QualificationCompletedAtUtc
                $priorFingerprint =
                    [string]$operationalBefore.SourceIndicatorFingerprint
                $priorFullExtractionRunId =
                    [string]$operationalBefore.LastFullExtractionRunId
                $priorForceFull =
                    [bool]$operationalBefore.LastForceFullIntent
                Write-LiveFullQualification `
                    -ImportRunId (
                        [Guid]$operationalBefore.ImportRunId) `
                    -MirrorRunId (
                        [string]$operationalBefore.MirrorRunId) `
                    -PackageHash (
                        [string]$operationalBefore.PackageHash) `
                    -SnapshotAsOfUtc (
                        [DateTime]$operationalBefore.SnapshotTimestampUtc) `
                    -SourceCheckedAtUtc (
                        [DateTime]$operationalBefore.SourceCheckedAtUtc) `
                    -QualificationCompletedAtUtc (
                        $priorQualificationCompletedAt) `
                    -SourceIndicatorFingerprint $priorFingerprint `
                    -FullExtractionRunId $priorFullExtractionRunId `
                    -ForceFullIntent $priorForceFull
            }
            $recovery = 'PREVIOUS_SNAPSHOT_RESTORED'
        }
        Start-LiveApi
    }
    catch {
        $recovery = 'RESTORATION_FAILED: ' + $_.Exception.Message
    }
    [ordered]@{
        Verdict = 'FAIL'
        RunId = $RunId
        Failure = $failure
        Recovery = $recovery
        XDriveAccessed = $false
    } |
        ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath $resultPath -Encoding UTF8
    "$failure`nRecovery: $recovery" |
        Set-Content -LiteralPath $errorPath -Encoding UTF8
    exit 1
}
