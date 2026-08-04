[CmdletBinding()]
param(
    [switch] $QualificationInduceFailure,
    [switch] $CandidateOnly,
    [string] $BasePackage,
    [ValidateRange(0, 30)]
    [int] $QualificationHoldLockSeconds = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine $approvedIdentity -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw "Open Sales Order refresh requires non-elevated $approvedIdentity."
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$root = 'C:\DLE-OS\Canonical\OpenSalesOrders\Refresh'
$runs = Join-Path $root 'Runs'
$stateRoot = Join-Path $root 'State'
$lockPath = Join-Path $stateRoot 'open-sales-order-refresh.lock'
$statusPath = Join-Path $stateRoot 'status.json'
$platformRoot = 'C:\DLE-OS\Canonical\LiveMirror\Platform002'
$current = Join-Path $platformRoot 'Current'
$previous = Join-Path $platformRoot 'Previous'
$extractor = Join-Path $repo 'Tools\OperationsRefresh\focused_sales_order_refresh.py'
$comparer = Join-Path $repo 'Tools\OperationsRefresh\compare_packages.py'
$importer =
    'C:\DLE-OS\Repositories\DLE-OS-Server\Tools\Import-Platform002SalesOrders.ps1'
$python =
    'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\python\python.exe'
foreach ($path in @($extractor, $comparer, $importer, $python, $current)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required fixed Open Sales Order path is unavailable: $path"
    }
}
New-Item -ItemType Directory -Path $runs, $stateRoot -Force | Out-Null
try {
    $lock = [IO.File]::Open(
        $lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
        [IO.FileShare]::None)
}
catch [IO.IOException] {
    [pscustomobject]@{ Result = 'ALREADY_RUNNING' } | ConvertTo-Json
    exit 2
}

$runId = 'OPENSALESREFRESH-' +
    [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' +
    ([Guid]::NewGuid().ToString('N')[0..7] -join '').ToUpperInvariant()
$runRoot = Join-Path $runs $runId
$candidate = Join-Path $runRoot 'Package'
$started = [DateTimeOffset]::UtcNow

function Write-Status(
    [string] $Result,
    [string] $Message,
    [object] $Details,
    [string] $CurrentPhase = '',
    [object] $RecordsProcessed = $null,
    [object] $RecordsExpected = $null
) {
    $value = [ordered]@{
        Result = $Result
        Message = $Message
        RefreshRunId = $runId
        StartedAtUtc = $started.ToString('O')
        UpdatedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        ExecutionIdentity = $identity.Name
        Elevated = $false
        SourceOpenMode = 'O_RDONLY'
        SourceWrites = 0
        SourceLocksRequested = 0
        CurrentPhase = $CurrentPhase
        RecordsProcessed = $RecordsProcessed
        RecordsExpected = $RecordsExpected
        Details = $Details
    }
    $stage = Join-Path $stateRoot ".$runId.status"
    [IO.File]::WriteAllText(
        $stage, (($value | ConvertTo-Json -Depth 12) + "`n"),
        [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $stage -Destination $statusPath -Force
}

$rollback = Join-Path $platformRoot ".RoutineRollback-$runId"
try {
    Write-Status 'RUNNING' 'Reading focused Open Sales Order sources.' $null `
        'Reading Open Orders'
    if ($QualificationHoldLockSeconds -gt 0) {
        Start-Sleep -Seconds $QualificationHoldLockSeconds
    }
    New-Item -ItemType Directory -Path $runRoot | Out-Null
    $extractArguments = @('--run-id', $runId, '--run-root', $runRoot)
    if (-not [string]::IsNullOrWhiteSpace($BasePackage)) {
        $extractArguments += @('--base-package', $BasePackage)
    }
    $extraction = & $python $extractor @extractArguments |
        ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $extraction.result -cne 'PASS') {
        throw 'Focused Open Sales Order extraction did not pass.'
    }
    $openLineCount = [long]$extraction.qualifyingLinePrefixCount
    Write-Status 'RUNNING' 'Comparing focused Open Sales Orders.' $null `
        'Comparing Sales Orders' $openLineCount $openLineCount
    $comparison = & $python $comparer --dataset sales-order `
        --candidate $candidate --current $current | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) {
        throw 'Open Sales Order package comparison failed.'
    }
    if ($CandidateOnly) {
        $result = [ordered]@{
            Result = 'CANDIDATE_READY'
            RefreshRunId = $runId
            PackagePath = $candidate
            PackageSha256 = (
                Get-Content -LiteralPath (Join-Path $candidate 'package.sha256') -Raw
            ).Trim()
            Extraction = $extraction
            Counts = $comparison
            RecordCount = $openLineCount
            RelationshipCount = [long]$extraction.woe03RelationshipCount
            Promoted = $false
            PriorDataRetained = $true
        }
        Write-Status $result.Result 'Open Sales Order candidate is ready for coordinated promotion.' $result `
            'Candidate Ready' $openLineCount $openLineCount
        $result | ConvertTo-Json -Depth 12
        exit 0
    }
    if ($comparison.result -ceq 'NO_SOURCE_CHANGES') {
        $result = [ordered]@{
            Result = 'NO_SOURCE_CHANGES'
            Extraction = $extraction
            Counts = $comparison
            PriorDataRetained = $true
        }
        Write-Status $result.Result 'Open Sales Orders are unchanged.' $result `
            'Complete' $openLineCount $openLineCount
        $result | ConvertTo-Json -Depth 12
        exit 0
    }

    # The fixed legacy importer accepts only Platform002\Current. This swap is
    # a private staging activation; API data remains SQL-backed. On any import
    # failure it is restored before this runner returns.
    Move-Item -LiteralPath $current -Destination $rollback
    Move-Item -LiteralPath $candidate -Destination $current
    try {
        Write-Status 'RUNNING' 'Updating Open Sales Orders.' $null `
            'Updating Sales Orders' $openLineCount $openLineCount
        $importArgs = @{}
        if ($QualificationInduceFailure) {
            $importArgs.QualificationInduceFailure = $true
        }
        $importResult = & $importer @importArgs | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) {
            throw "Sales Order importer returned $LASTEXITCODE."
        }
    }
    catch {
        Move-Item -LiteralPath $current -Destination $candidate
        Move-Item -LiteralPath $rollback -Destination $current
        throw
    }
    if (Test-Path -LiteralPath $previous) {
        Remove-Item -LiteralPath $previous -Recurse -Force
    }
    Move-Item -LiteralPath $rollback -Destination $previous
    $result = [ordered]@{
        Result = 'SUCCESS'
        Extraction = $extraction
        Import = $importResult
        Counts = $comparison
        PriorDataRetained = $true
    }
    Write-Status $result.Result 'Open Sales Order refresh completed.' $result `
        'Complete' $openLineCount $openLineCount
    $result | ConvertTo-Json -Depth 12
}
catch {
    if (Test-Path -LiteralPath $rollback) {
        if (Test-Path -LiteralPath $current) {
            Move-Item -LiteralPath $current -Destination $candidate -Force
        }
        Move-Item -LiteralPath $rollback -Destination $current
    }
    $failure = [ordered]@{
        Result = 'FAILED'
        FailureReason = $_.Exception.Message
        PriorDataRetained = $true
    }
    Write-Status $failure.Result 'Open Sales Order refresh failed; prior data retained.' $failure
    $failure | ConvertTo-Json -Depth 10
    exit 1
}
finally {
    if ($lock) { $lock.Dispose() }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
