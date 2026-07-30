[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $RunId,
    [Parameter(Mandatory)]
    [string] $BaseMirrorRunId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine 'DLE-OS-HOST\DLE-OS') {
    throw (
        'Qualified promotion resume requires DLE-OS-HOST\DLE-OS; actual ' +
        "identity is $identity."
    )
}
if (
    $RunId -notmatch
        '^LIVEREFRESH-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$' -or
    $BaseMirrorRunId -notmatch
        '^LIVEMIRROR001-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$'
) {
    throw 'Qualified run identity was rejected.'
}

$baseRoot = 'C:\DLE-OS\Canonical\LiveMirror'
$runsRoot = Join-Path $baseRoot 'RefreshRuns'
$runRoot = Join-Path $runsRoot $RunId
$expectedRunRoot =
    [IO.Path]::GetFullPath((Join-Path $runsRoot $RunId)).TrimEnd('\')
if (
    [IO.Path]::GetFullPath($runRoot).TrimEnd('\') -ine
        $expectedRunRoot -or
    -not (Test-Path -LiteralPath $runRoot -PathType Container)
) {
    throw 'Qualified promotion run root is outside the fixed boundary.'
}
foreach ($lock in @(
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\refresh.lock',
    (Join-Path $baseRoot 'Configuration\run.lock')
)) {
    if (Test-Path -LiteralPath $lock) {
        throw "Promotion resume refused while a lock exists: $lock"
    }
}

$resultPath = Join-Path $runRoot 'sales-order-refresh-result.json'
$runtimeVerdict =
    Join-Path $runRoot 'SalesOrderRuntime\RUNTIME_VERDICT.txt'
$passSummary =
    Join-Path $runRoot 'SalesOrderRuntime\SOURCE_PASS_SUMMARY.csv'
$archivedManifest =
    Join-Path $baseRoot "Manifests\$BaseMirrorRunId.json"
$baseLog = Join-Path $baseRoot "Logs\$BaseMirrorRunId.jsonl"
$rollbackRoot = Join-Path $runRoot 'Rollback'
$rollbackBaseCurrent = Join-Path $rollbackRoot 'BaseCurrent'
$rollbackBasePrevious = Join-Path $rollbackRoot 'BasePrevious'
$rollbackSalesCurrent = Join-Path $rollbackRoot 'SalesCurrent'
$rollbackSalesPrevious = Join-Path $rollbackRoot 'SalesPrevious'

foreach ($required in @(
    $resultPath,
    $runtimeVerdict,
    $passSummary,
    $archivedManifest,
    $baseLog,
    (Join-Path $rollbackBaseCurrent 'manifest.json'),
    (Join-Path $rollbackSalesCurrent 'manifest.json')
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Qualified resume evidence is absent: $required"
    }
}

$salesResult =
    Get-Content -LiteralPath $resultPath -Raw |
    ConvertFrom-Json
if (
    $salesResult.result -ne 'PASS' -or
    -not [bool]$salesResult.sourceIdentityMatch -or
    @($salesResult.passComparison.PSObject.Properties).Count -ne 5 -or
    @($salesResult.passComparison.PSObject.Properties |
        Where-Object { -not [bool]$_.Value.semanticMatch }).Count -ne 0 -or
    [long]$salesResult.passComparison.'WOE03_FULL.csv'.recordCount -ne
        370689
) {
    throw 'Sales Order two-pass qualification evidence is not PASS.'
}
$verdictText = Get-Content -LiteralPath $runtimeVerdict -Raw
foreach ($requiredVerdict in @(
    'two_complete_passes=PASS',
    'source_open_mode=O_RDONLY',
    'live_source_writes=NONE',
    'qualification_verdict=PASS'
)) {
    if ($verdictText -notmatch [regex]::Escape($requiredVerdict)) {
        throw "Runtime verdict is missing: $requiredVerdict"
    }
}
$summary = Import-Csv -LiteralPath $passSummary
if (
    $summary.Count -ne 10 -or
    @($summary | Where-Object {
        $_.source_open_mode -ne 'O_RDONLY' -or
        $_.identity_status -ne 'PASS' -or
        $_.key_order_status -ne 'PASS'
    }).Count -ne 0 -or
    @($summary | Where-Object {
        $_.source_file -eq 'WOE-03' -and
        [long]$_.actual_record_count -eq 370689
    }).Count -ne 2
) {
    throw 'The ten-row source pass summary is not qualified.'
}

$baseManifest =
    Get-Content -LiteralPath $archivedManifest -Raw |
    ConvertFrom-Json
if (
    $baseManifest.run_id -cne $BaseMirrorRunId -or
    $baseManifest.package_state -ne 'COMMITTED' -or
    $baseManifest.run_outcome -ne 'SUCCESS' -or
    $baseManifest.contract_version -ne 'V1.2' -or
    [string]$baseManifest.package_hash -notmatch '^[0-9A-F]{64}$' -or
    [long]$baseManifest.entity_counts.BillOfMaterial -ne 1290 -or
    [long]$baseManifest.entity_counts.InventoryItem -ne 28662 -or
    [long]$baseManifest.entity_counts.WorkOrder -ne 12113 -or
    [long]$baseManifest.entity_counts.GeneralLedgerAccount -ne 257
) {
    throw 'The archived successful base-mirror manifest is not qualified.'
}
$baseEvents =
    Get-Content -LiteralPath $baseLog |
    ForEach-Object { $_ | ConvertFrom-Json }
$runStarted =
    @($baseEvents |
        Where-Object { $_.event_code -eq 'RUN_STARTED' })[0]
$stagingValidated =
    @($baseEvents |
        Where-Object { $_.event_code -eq 'STAGING_VALIDATED' })[0]
$runCommitted =
    @($baseEvents |
        Where-Object { $_.event_code -eq 'RUN_COMMITTED' })[0]
if (
    $null -eq $runStarted -or
    $null -eq $stagingValidated -or
    $null -eq $runCommitted -or
    [string]$stagingValidated.detail.package_hash -cne
        [string]$baseManifest.package_hash -or
    [string]$runCommitted.detail.package_hash -cne
        [string]$baseManifest.package_hash
) {
    throw 'Base-mirror validation and commit events are incomplete.'
}

$baseCandidate = Join-Path $runRoot 'BaseCandidate'
$salesCandidate = Join-Path $runRoot 'SalesOrderCandidate'
foreach ($candidate in @($baseCandidate, $salesCandidate)) {
    if (Test-Path -LiteralPath $candidate) {
        throw "Resume candidate already exists: $candidate"
    }
}
New-Item -ItemType Directory -Path $baseCandidate | Out-Null
Copy-Item -Path (Join-Path $rollbackBaseCurrent '*') `
    -Destination $baseCandidate -Recurse -Force
Copy-Item -LiteralPath $archivedManifest `
    -Destination (Join-Path $baseCandidate 'manifest.json') -Force

$sourceIdentityPath =
    Join-Path $baseCandidate 'Evidence\source_identity.json'
$sourceIdentity =
    Get-Content -LiteralPath $sourceIdentityPath -Raw |
    ConvertFrom-Json
$sourceIdentity.before.captured_at_utc =
    [string]$runStarted.timestamp_utc
$sourceIdentity.after.captured_at_utc =
    [string]$stagingValidated.timestamp_utc
$sourceIdentity |
    Add-Member -NotePropertyName reconstruction -NotePropertyValue (
        [ordered]@{
            method = 'QUALIFIED_LOCAL_PACKAGE_RECONSTRUCTION_V1'
            reason =
                'Original validated candidate was removed by fail-closed rollback after the importer no-op mismatch.'
            base_mirror_run_id = $BaseMirrorRunId
            run_started_event_utc = [string]$runStarted.timestamp_utc
            staging_validated_event_utc =
                [string]$stagingValidated.timestamp_utc
            run_committed_event_utc = [string]$runCommitted.timestamp_utc
            deterministic_package_hash =
                [string]$baseManifest.package_hash
            source_access_performed = $false
        }
    ) -Force
$sourceIdentityJson = $sourceIdentity | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText(
    $sourceIdentityPath,
    $sourceIdentityJson + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))

$hashesPath = Join-Path $baseCandidate 'hashes.csv'
$hashRows = Import-Csv -LiteralPath $hashesPath
$identityRow =
    @($hashRows |
        Where-Object {
            $_.relative_path -eq 'Evidence/source_identity.json'
        })
if ($identityRow.Count -ne 1) {
    throw 'Base package source-identity hash row is not unique.'
}
$identityItem = Get-Item -LiteralPath $sourceIdentityPath
$identityRow[0].size_bytes = [string]$identityItem.Length
$identityRow[0].sha256 =
    (Get-FileHash -Algorithm SHA256 `
        -LiteralPath $sourceIdentityPath).Hash
$hashCsv = $hashRows | ConvertTo-Csv -NoTypeInformation
[IO.File]::WriteAllLines(
    $hashesPath,
    [string[]]$hashCsv,
    [Text.UTF8Encoding]::new($false))

$python =
    'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\python\python.exe'
$builder =
    'C:\DLE-OS\Canonical\LiveMirror\Refresh\Assets\' +
    'build_sales_order_package.py'
& $python $builder `
    --runtime-root (Join-Path $runRoot 'SalesOrderRuntime') `
    --base-package $baseCandidate `
    --output $salesCandidate `
    --run-id $RunId `
    --snapshot-year 2026
if ($LASTEXITCODE -ne 0) {
    throw 'Local Sales Order candidate reconstruction failed.'
}

$baseCurrent = Join-Path $baseRoot 'Current'
$basePrevious = Join-Path $baseRoot 'Previous'
$currentManifest =
    Get-Content -LiteralPath (
        Join-Path $baseCurrent 'manifest.json'
    ) -Raw |
    ConvertFrom-Json
$rollbackManifest =
    Get-Content -LiteralPath (
        Join-Path $rollbackBaseCurrent 'manifest.json'
    ) -Raw |
    ConvertFrom-Json
if (
    $currentManifest.run_id -cne $rollbackManifest.run_id -or
    $currentManifest.package_hash -cne $rollbackManifest.package_hash
) {
    throw 'Current base slot differs from the retained rollback boundary.'
}

$initialResult = Join-Path $runRoot 'promotion-result.json'
$initialError = Join-Path $runRoot 'promotion-error.log'
$initialHostOut = Join-Path $runRoot 'promotion-host.stdout.log'
$initialHostErr = Join-Path $runRoot 'promotion-host.stderr.log'
$attemptRoot = Join-Path $runRoot 'PromotionAttempts\InitialFailure'
New-Item -ItemType Directory -Path $attemptRoot -Force | Out-Null
foreach ($path in @(
    $initialResult,
    $initialError,
    $initialHostOut,
    $initialHostErr
)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Move-Item -LiteralPath $path -Destination (
            Join-Path $attemptRoot ([IO.Path]::GetFileName($path))
        ) -Force
    }
}

$basePromoted = $false
try {
    if (Test-Path -LiteralPath $basePrevious) {
        Remove-Item -LiteralPath $basePrevious -Recurse -Force
    }
    Move-Item -LiteralPath $baseCurrent -Destination $basePrevious
    Move-Item -LiteralPath $baseCandidate -Destination $baseCurrent
    $basePromoted = $true

    $uri =
        'http://localhost:5044/api/platform/refresh/v1/promote?' +
        'runId=' + [Uri]::EscapeDataString($RunId) +
        '&fixture=false'
    $response =
        Invoke-RestMethod -Uri $uri -Method Post `
            -UseDefaultCredentials -TimeoutSec 10
    if ($response.status -ne 'PROMOTION_STARTED') {
        throw 'The elevated promotion broker rejected the local resume.'
    }
    for ($attempt = 0; $attempt -lt 3600; $attempt++) {
        if (Test-Path -LiteralPath $initialResult -PathType Leaf) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $initialResult -PathType Leaf)) {
        throw 'Resumed promotion did not complete within 15 minutes.'
    }
    $promotion =
        Get-Content -LiteralPath $initialResult -Raw |
        ConvertFrom-Json
    if ($promotion.Verdict -ne 'PASS') {
        throw (
            'Resumed promotion failed: ' +
            [string]$promotion.Failure +
            ' Recovery: ' +
            [string]$promotion.Recovery
        )
    }
}
catch {
    if ($basePromoted -and
        -not (Test-Path -LiteralPath $initialResult -PathType Leaf)) {
        if (Test-Path -LiteralPath $baseCurrent) {
            Remove-Item -LiteralPath $baseCurrent -Recurse -Force
        }
        if (Test-Path -LiteralPath $basePrevious) {
            Remove-Item -LiteralPath $basePrevious -Recurse -Force
        }
        New-Item -ItemType Directory -Path $baseCurrent | Out-Null
        Copy-Item -Path (Join-Path $rollbackBaseCurrent '*') `
            -Destination $baseCurrent -Recurse -Force
        if (Test-Path -LiteralPath $rollbackBasePrevious) {
            New-Item -ItemType Directory -Path $basePrevious | Out-Null
            Copy-Item -Path (Join-Path $rollbackBasePrevious '*') `
                -Destination $basePrevious -Recurse -Force
        }
    }
    throw
}

$evidence = [ordered]@{
    Verdict = 'PASS'
    RunId = $RunId
    BaseMirrorRunId = $BaseMirrorRunId
    ResumedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ExecutionIdentity = $identity
    SourceAccessPerformed = $false
    XDriveWrites = 0
    Woe03Pass1Count = 370689
    Woe03Pass2Count = 370689
    TwoPassSemanticMatch = $true
    BasePackageHash = [string]$baseManifest.package_hash
    SalesPackageHash =
        (Get-Content -LiteralPath (
            Join-Path (
                'C:\DLE-OS\Canonical\LiveMirror\Platform002\Current'
            ) 'package.sha256'
        ) -Raw).Trim()
    PromotionVerdict = 'PASS'
}
$evidence |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath (
        Join-Path $runRoot 'qualified-resume-result.json'
    ) -Encoding UTF8
$evidence | ConvertTo-Json -Depth 6
