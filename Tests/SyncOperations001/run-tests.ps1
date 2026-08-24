$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$passed=0
function Read([string]$Path){Get-Content (Join-Path $repo $Path) -Raw}
function Check([string]$Name,[scriptblock]$Rule){&$Rule;$script:passed++;"PASS $Name"}
function Require([bool]$Value,[string]$Message){if(-not$Value){throw $Message}}

$center=Read 'Tools\LiveSnapshotRefresh\ControlHost\SyncOperationsCenter.cs'
$statusSnapshot=Read 'Tools\LiveSnapshotRefresh\ControlHost\SyncOperationsStatusSnapshot.cs'
$worker=Read 'Tools\SyncOperations\Invoke-SyncOperations.ps1'
$daily=Read 'Tools\DailyOperationsSync\Invoke-DailyOperationsSync.ps1'
$invoice=Read 'Tools\InvoiceHistory\Import-InvoiceHistoryRefresh.ps1'
$invoiceRunner=Read 'Tools\InvoiceHistory\Invoke-InvoiceHistoryRefresh.ps1'
$invoiceWait=Read 'Tools\InvoiceHistory\InvoiceHistoryVProWait.ps1'
$invoiceBuilder=Read 'Tools\InvoiceHistory\build_invoice_history_refresh_package.py'
$bff=Read 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DevelopmentCompatibilityProxy.cs'
$permission=Read 'Tools\LiveSnapshotRefresh\ControlHost\DevelopmentPermissionAuthorization.cs'
$ui=Read 'SRC\modules\operations-center\operations-center.html'
$uiJs=Read 'SRC\modules\operations-center\operations-center.js'
$operatorHeader=Read 'SRC\shell\operator-header.js'
$devApi=Read 'Tools\DevelopmentRuntime\DleOs.DevelopmentApi\Program.cs'
$readiness=Read 'Tools\PlatformFreshnessCache\ServerOverlay\Data\Platform\LivePlatformStatusRepository.cs'
$readinessOptions=Read 'Tools\PlatformFreshnessCache\ServerOverlay\Options\LiveApiOptions.cs'

Check 'semantic BFF and 5054 routes' {
    foreach($value in @('/api/sync/operations','/api/sync/operations/current','/api/sync/operations/runs/{runId}')){
        Require ($center.Contains($value)-or$bff.Contains($value)) "missing $value"
    }
    Require ($bff.Contains('operational, "/api/sync/operations");')) 'exact POST root mapping absent'
    Require ($bff.Contains('new ByteArrayContent(body.ToArray())')) 'POST body is not replayable across Windows authentication challenge'
}
Check 'permission is enforced end to end' {
    Require ($bff.Contains('sync.operations')-and$permission.Contains('sync.operations')) 'permission boundary absent'
}
Check 'browser-independent governed worker' {
    Require ($center.Contains('SaferLevelNormalUser')-and
        $center.Contains('CreateProcessAsUser')-and
        $center.Contains('DLE-OS-HOST\DLE-OS')) 'normal-user detached execution boundary absent'
    Require ($worker.Contains('$identity -ine ''DLE-OS-HOST\DLE-OS''')) 'worker identity gate absent'
    Require ($worker.Contains('$null -ne $exitCode') -and
        $worker.Contains('without fresh durable status evidence')) `
        'asynchronous child completion is not guarded by fresh durable evidence'
}
Check 'durable lease and stale recovery' {
    foreach($value in @('lease.json','FileMode.CreateNew','ALREADY_RUNNING','ABANDONED_STALE_OWNER','OwnerProcessStartedAtUtc')){
        Require $center.Contains($value) "lease contract missing $value"
    }
    Require ($center.Contains('FileSystemRights.Modify') -and
        $center.Contains('DLE-OS-HOST\DLE-OS')) 'normal-user worker cannot update durable state'
    Require ($center.Contains('RecoverOrphanedCurrent')) 'active-looking state without a lease is not recoverable'
}
Check 'mutable status responses use immutable bounded snapshots' {
    Require (-not$center.Contains('Results.File(CurrentPath')) `
        'current status still returns a deferred mutable file'
    Require (-not$center.Contains('Results.File(RunPath')) `
        'per-run status still returns a deferred mutable file'
    Require ($center.Contains('Results.Bytes(snapshot, "application/json")')) `
        'status endpoints do not return immutable captured bytes'
    foreach($value in @('MaximumAttempts = 8','RetryDelay = TimeSpan.FromMilliseconds(10)',
        'File.ReadAllBytes','JsonDocument.Parse')) {
        Require $statusSnapshot.Contains($value) "snapshot contract missing $value"
    }
}
Check 'normal sync does not launch Invoice History or depend on its outcome' {
    Require $worker.Contains('Invoke-DailyOperationsSync.ps1') 'Daily Operations runner absent'
    foreach($value in @('Invoke-InvoiceHistoryRefresh.ps1','invoice-history','InvoiceHistory=')) {
        Require (-not$worker.Contains($value)) "normal sync still contains Invoice History coupling: $value"
    }
    Require (-not$worker.Contains('Invoice History synchronization returned')) `
        'an Invoice History result can still fail normal Sync Operations'
    Require (-not$worker.Contains('Force-Full')-and-not$worker.Contains('BOM')-and-not$worker.Contains('Inventory')-and-not$worker.Contains('GL')) 'heavy refresh leaked into worker'
}
Check 'Daily success and exact-generation 5052 readiness define success' {
    $dailyCall=$worker.IndexOf("Invoke-GovernedChild 'daily-operations'")
    $readinessStep=$worker.IndexOf('Verifying canonical API 5052 readiness and visibility')
    $success=$worker.IndexOf("`$status = 'SUCCEEDED'")
    Require ($dailyCall -ge 0-and$readinessStep -gt $dailyCall-and$success -gt $readinessStep) `
        'normal sync terminal sequence is not Daily Operations, readiness, success'
    Require ($worker.Contains("`$daily.OverallStatus -cne 'PASSED_PROMOTED_READY'")) `
        'Daily Operations success contract absent'
    Require ($worker.Contains('currentImportRunId')-and$worker.Contains("readinessState -ceq 'ReadyFresh'")) `
        'worker does not verify the exact promoted 5052 generation'
    Require ($worker.Contains('Current operational demand successfully synchronized and is visible through API 5052.')) `
        'success wording does not describe the operational-demand boundary'
}
Check 'Daily Operations failure remains terminal' {
    Require ($worker.Contains('Daily operational synchronization returned')) `
        'Daily Operations failure is not propagated'
}
Check 'routine source is UNC and no X drive' {
    foreach($path in @('Tools\DailyOperationsSync\Invoke-DailyOperationsSync.ps1','Tools\DailyOperationsSync\focused_work_order_refresh.py','Tools\OperationsRefresh\focused_sales_order_refresh.py','Tools\InvoiceHistory\Invoke-InvoiceHistoryRefresh.ps1')){
        $text=Read $path
        Require $text.Contains('\\deleon-server\Add-ON') "$path lacks UNC"
        $runtimeAssignments=@($text -split "`n" | Where-Object {
            $_ -match '^(SOURCE|SOURCES|\$sourcePaths|\s*\$vpro.*,.*X:)' }) -join "`n"
        Require (-not$runtimeAssignments.Contains('X:\AON\ADATA')) "$path retains a routine X assignment"
    }
}
Check '5052 visibility failure is explicit' {
    Require ($daily.Contains('PROMOTED_BUT_NOT_VISIBLE')-and$worker.Contains('PROMOTED_BUT_NOT_VISIBLE')) 'visibility state absent'
    Require ($daily.Contains('currentImportRunId')-and$daily.Contains('ReadyFresh')) 'generation readiness check absent'
    Require ($worker.Contains('Canonical SQL promotion completed, but API 5052 did not expose the promoted generation.')) `
        'worker readiness failure is not terminal and explicit'
}
Check '5052 DEV accepts only self-qualified operational generations' {
    Require ($devApi.Contains('AcceptLatestQualifiedOperationalSnapshot') -and
        $readiness.Contains('DAILY_OPERATIONS_SYNC_QUALIFIED') -and
        $readiness.Contains('selfQualifiedOperationalSnapshot')) 'DEV self-qualified readiness policy absent'
    Require ($readinessOptions.Contains('AcceptLatestQualifiedOperationalSnapshot { get; init; }')) `
        'production-safe false default absent'
}
Check 'invoice changes create a new dataset generation' {
    foreach($value in @('INSERT platform.InvoiceHistoryImportRun','@NextImportRunId=@RefreshRunId','CustomerInvoiceCount','CustomerInvoiceLineCount','ActivatedAtUtc')){
        Require $invoice.Contains($value) "invoice generation update missing $value"
    }
}
Check 'independent Invoice History progress workflow remains governed' {
    Require ($invoiceRunner.Contains('$noProgressTimeoutSeconds = 180')) 'Invoice History no-progress timeout changed'
    Require ($invoiceRunner.Contains('$absoluteTimeoutSeconds = 600')) 'Invoice History absolute timeout changed'
    foreach($value in @('Wait-InvoiceHistoryVProExtraction','Stop-StartedSourceProcess')) {
        Require $invoiceRunner.Contains($value) "Invoice History runner missing $value"
    }
    foreach($value in @('NO_PROGRESS','ABSOLUTE_LIMIT','LastObservedProgressAtUtc','open_mode,O_RDONLY')) {
        Require $invoiceWait.Contains($value) "Invoice History wait contract missing $value"
    }
    Require ($invoiceBuilder.Contains('source identity changed during extraction')) `
        'Invoice History source-identity guard absent'
}
Check 'worker lease cleanup remains ownership-aware' {
    Require ($worker.Contains("`$lease.RunId -ceq `$RunId")-and
        $worker.Contains('Remove-Item -LiteralPath $LeasePath -Force')) `
        'worker no longer limits lease cleanup to its own run'
}
Check 'operator UI uses sync versus reload terminology' {
    Require ($operatorHeader.Contains('Sync Operations')-and$ui.Contains('Reload View')) 'operator terminology absent'
    Require ($uiJs.Contains('startSyncOperations')-and$uiJs.Contains('elapsedSeconds')) 'operator lifecycle view absent'
    Require ($uiJs.Contains('refreshOperationsCenterAfterSuccessfulSync')-and
        $uiJs.Contains('refreshOperationsCenterCanonicalData();')) `
        'successful Sync Operations no longer reuses Reload View behavior'
    Require (-not$uiJs.Contains('45-day Invoice History window')-and
        -not$uiJs.Contains('invoice changes:')) 'operator UI still implies normal Sync includes Invoice History'
    Require ($uiJs.Contains('verifies the promoted generation through API 5052')) `
        'operator confirmation does not state the normal sync boundary'
    Require ($uiJs.Contains("syncValue(state, 'result') || syncValue(state, 'currentStep')")) `
        'terminal result wording is hidden behind the generic Complete step'
}
"PASS $passed Sync Operations contract checks"
