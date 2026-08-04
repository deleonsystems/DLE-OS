[CmdletBinding()]
param(
    [switch] $QualificationInduceFailure,
    [switch] $CandidateOnly,
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
    throw "Customer refresh requires non-elevated $approvedIdentity."
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$root = 'C:\DLE-OS\Canonical\CustomerMaster\Refresh'
$runs = Join-Path $root 'Runs'
$stateRoot = Join-Path $root 'State'
$current = Join-Path $root 'Current'
$previous = Join-Path $root 'Previous'
$lockPath = Join-Path $stateRoot 'customer-master-refresh.lock'
$statusPath = Join-Path $stateRoot 'status.json'
$qualifier = Join-Path $repo (
    'Tools\CustomerMaster\Invoke-CustomerMasterSourceQualification.ps1')
$builder = Join-Path $repo 'Tools\CustomerMaster\build_customer_master_package.py'
$comparer = Join-Path $repo 'Tools\OperationsRefresh\compare_packages.py'
$importer = Join-Path $repo 'Tools\CustomerMaster\Import-CustomerMasterBaseline.ps1'
$python =
    'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\python\python.exe'
$baseline = Join-Path $repo (
    'Artifacts\CustomerMasterPlatform001\' +
    'CUSTOMERMASTERPLATFORM001-20260729T170951Z\BaselinePackage')

foreach ($path in @($qualifier, $builder, $comparer, $importer, $python, $baseline)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required fixed Customer refresh path is unavailable: $path"
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

$runId = 'CUSTOMERREFRESH-' +
    [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' +
    ([Guid]::NewGuid().ToString('N')[0..7] -join '').ToUpperInvariant()
$runRoot = Join-Path $runs $runId
$package = Join-Path $runRoot 'Package'
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

try {
    Write-Status 'RUNNING' (
        'Reading the complete qualified Customer Master.') $null `
        'Reading Customers'
    if ($QualificationHoldLockSeconds -gt 0) {
        Start-Sleep -Seconds $QualificationHoldLockSeconds
    }
    & $qualifier -RunId $runId -RoutineRefresh
    if ($LASTEXITCODE -ne 0) {
        throw "Customer qualifier returned $LASTEXITCODE."
    }
    $qualified = Join-Path $runRoot 'Evidence\QualifiedSource'
    & $python $builder --source $qualified --output $package --source-run-id $runId
    if ($LASTEXITCODE -ne 0) {
        throw "Customer package builder returned $LASTEXITCODE."
    }
    $packageMetadata =
        Get-Content -LiteralPath (Join-Path $package 'metadata.json') -Raw |
        ConvertFrom-Json
    $customerRecordCount =
        [long]$packageMetadata.counts.Customer +
        [long]$packageMetadata.counts.CustomerAddress
    Write-Status 'RUNNING' 'Comparing Customer Master package.' $null `
        'Comparing Customers' $customerRecordCount $customerRecordCount
    $comparisonRoot = if (Test-Path -LiteralPath $current) {
        $current
    } else {
        $baseline
    }
    $comparison = (
        & $python $comparer --dataset customer --candidate $package `
            --current $comparisonRoot | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) {
        throw "Customer package comparison returned $LASTEXITCODE."
    }
    if ($CandidateOnly) {
        $result = [ordered]@{
            Result = 'CANDIDATE_READY'
            RefreshRunId = $runId
            PackagePath = $package
            PackageSha256 = (
                Get-Content -LiteralPath (Join-Path $package 'package.sha256') -Raw
            ).Trim()
            Counts = $comparison
            RecordCount = $customerRecordCount
            Promoted = $false
            PriorDataRetained = $true
        }
        Write-Status $result.Result 'Customer Master candidate is ready for coordinated promotion.' $result `
            'Candidate Ready' $customerRecordCount $customerRecordCount
        $result | ConvertTo-Json -Depth 10
        exit 0
    }
    if ($comparison.result -ceq 'NO_SOURCE_CHANGES') {
        $result = [ordered]@{
            Result = 'NO_SOURCE_CHANGES'
            PackageSha256 = (
                Get-Content -LiteralPath (Join-Path $package 'package.sha256') -Raw
            ).Trim()
            Counts = $comparison
            PriorDataRetained = $true
        }
        Write-Status $result.Result 'Customer Master is unchanged.' $result `
            'Complete' $customerRecordCount $customerRecordCount
        $result | ConvertTo-Json -Depth 10
        exit 0
    }
    $importArgs = @{ PackageRoot = $package }
    if ($QualificationInduceFailure) {
        $importArgs.QualificationInduceFailure = $true
    }
    Write-Status 'RUNNING' 'Updating Customer Master.' $null `
        'Updating Customer Master' $customerRecordCount $customerRecordCount
    $importResult = & $importer @importArgs | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) {
        throw "Customer importer returned $LASTEXITCODE."
    }
    if (Test-Path -LiteralPath $previous) {
        Remove-Item -LiteralPath $previous -Recurse -Force
    }
    if (Test-Path -LiteralPath $current) {
        Move-Item -LiteralPath $current -Destination $previous
    }
    Move-Item -LiteralPath $package -Destination $current
    $result = [ordered]@{
        Result = 'SUCCESS'
        Import = $importResult
        Counts = $comparison
        PriorDataRetained = $true
    }
    Write-Status $result.Result 'Customer Master refresh completed.' $result `
        'Complete' $customerRecordCount $customerRecordCount
    $result | ConvertTo-Json -Depth 10
}
catch {
    $failure = [ordered]@{
        Result = 'FAILED'
        FailureReason = $_.Exception.Message
        PriorDataRetained = $true
    }
    Write-Status $failure.Result 'Customer refresh failed; prior data retained.' $failure
    $failure | ConvertTo-Json -Depth 10
    exit 1
}
finally {
    if ($lock) { $lock.Dispose() }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
