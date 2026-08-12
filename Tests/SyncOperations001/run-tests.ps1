$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$passed=0
function Read([string]$Path){Get-Content (Join-Path $repo $Path) -Raw}
function Check([string]$Name,[scriptblock]$Rule){&$Rule;$script:passed++;"PASS $Name"}
function Require([bool]$Value,[string]$Message){if(-not$Value){throw $Message}}

$center=Read 'Tools\LiveSnapshotRefresh\ControlHost\SyncOperationsCenter.cs'
$worker=Read 'Tools\SyncOperations\Invoke-SyncOperations.ps1'
$daily=Read 'Tools\DailyOperationsSync\Invoke-DailyOperationsSync.ps1'
$invoice=Read 'Tools\InvoiceHistory\Import-InvoiceHistoryRefresh.ps1'
$bff=Read 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DevelopmentCompatibilityProxy.cs'
$permission=Read 'Tools\LiveSnapshotRefresh\ControlHost\DevelopmentPermissionAuthorization.cs'
$ui=Read 'SRC\modules\operations-center\operations-center.html'
$uiJs=Read 'SRC\modules\operations-center\operations-center.js'
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
Check 'focused v1 excludes heavy datasets' {
    Require ($worker.Contains('Invoke-DailyOperationsSync.ps1')-and$worker.Contains('Invoke-InvoiceHistoryRefresh.ps1')) 'focused runners absent'
    Require (-not$worker.Contains('Force-Full')-and-not$worker.Contains('BOM')-and-not$worker.Contains('Inventory')-and-not$worker.Contains('GL')) 'heavy refresh leaked into worker'
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
Check 'operator UI uses sync versus reload terminology' {
    Require ($ui.Contains('Sync Operations')-and$ui.Contains('Reload View')) 'operator terminology absent'
    Require ($uiJs.Contains('startSyncOperations')-and$uiJs.Contains('elapsedSeconds')) 'operator lifecycle view absent'
}
"PASS $passed Sync Operations contract checks"
