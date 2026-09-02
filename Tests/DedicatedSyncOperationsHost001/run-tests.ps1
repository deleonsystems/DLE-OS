[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectRoot = Join-Path $repo (
    'Tools\DevelopmentRuntime\DleOs.SyncOperationsControlHost')
$results = [Collections.Generic.List[object]]::new()

function Text([string] $Path) {
    Get-Content -LiteralPath (Join-Path $repo $Path) -Raw
}
function Check([string] $Name, [scriptblock] $Rule) {
    try { & $Rule; $results.Add([pscustomobject]@{ Test=$Name; Result='PASS'; Detail='' }) }
    catch { $results.Add([pscustomobject]@{ Test=$Name; Result='FAIL'; Detail=$_.Exception.Message }) }
}
function Require([bool] $Value, [string] $Message) {
    if (-not $Value) { throw $Message }
}

$program = Text 'Tools\DevelopmentRuntime\DleOs.SyncOperationsControlHost\Program.cs'
$config = Text 'Tools\DevelopmentRuntime\DleOs.SyncOperationsControlHost\ControlHostRuntimeConfiguration.cs'
$project = Text 'Tools\DevelopmentRuntime\DleOs.SyncOperationsControlHost\DleOs.SyncOperationsControlHost.csproj'
$center = Text 'Tools\LiveSnapshotRefresh\ControlHost\SyncOperationsCenter.cs'
$identity = Text 'Tools\LiveSnapshotRefresh\ControlHost\TrustedDevelopmentIdentity.cs'
$permission = Text 'Tools\LiveSnapshotRefresh\ControlHost\DevelopmentPermissionAuthorization.cs'
$preflight = Text 'Tools\DevelopmentRuntime\DleOs.SyncOperationsControlHost\WorkerIdentityPreflight.cs'
$manifestPath = Join-Path $projectRoot 'worker-dependencies.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

Check 'dedicated 5056 boundary' {
    Require $config.Contains('http://dle-os-host:5056') '5056 prefix absent'
    Require $config.Contains('DLE_OS_SECURITY_DEV') 'DEV security database absent'
    Require $config.Contains('DLE-OS-HOST\DLE-OS') 'runtime identity gate absent'
    Require $config.Contains('DLE_OS_ENVIRONMENT=Development') 'DEV environment gate absent'
}
Check 'only Sync Operations routes are mapped' {
    Require (($program | Select-String 'MapSyncOperations' -AllMatches).Matches.Count -eq 1) `
        'Sync Operations route mapping absent or duplicated'
    foreach ($forbidden in @('MapWorkOrderApprovals','MapKitting','MapRma','MapShipment',
        'MapPlatformRefresh','MapOperationsRefresh','MapDailyOperationsSync')) {
        Require (-not $program.Contains($forbidden)) "forbidden route mapper compiled: $forbidden"
    }
    foreach ($route in @('/api/sync/operations','/api/sync/operations/current',
        '/api/sync/operations/runs/{runId}','/api/sync/operations/runs')) {
        Require $center.Contains($route) "missing route $route"
    }
}
Check 'real execution is fail closed during qualification' {
    Require $program.Contains('SYNC_OPERATIONS_EXECUTION_DISABLED') 'execution-disabled response absent'
    Require $config.Contains('APPROVED_LIVE_RUN') 'explicit execution approval value absent'
    Require $program.Contains('!ControlHostRuntimeConfiguration.ExecutionEnabled') `
        'POST does not fail closed when execution is disabled'
}
Check 'trusted frontend and assertion validation are retained' {
    Require $program.Contains('DLE-OS-HOST\DLE-OS-DEV-FRONTEND') 'trusted frontend caller absent'
    foreach ($value in @('Es256IdentityAssertionValidator','OperationalAudience',
        'DevelopmentEnvironment','DLE_OS_IDENTITY_ASSERTION_REPLAYED','X-DLE-OS-Correlation-ID')) {
        Require $identity.Contains($value) "identity assertion control missing: $value"
    }
}
Check 'downstream sync.operations permission remains enforced' {
    Require $program.Contains('UseDevelopmentPermissionAuthorization') 'permission middleware absent'
    Require $permission.Contains('path.StartsWith("/api/sync/operations"') 'Sync route permission mapping absent'
    Require $permission.Contains('new("sync.operations"') 'sync.operations requirement absent'
    Require $permission.Contains('DLE_OS_SECURITY_UNAVAILABLE') 'security failure does not fail closed'
}
Check 'lease admission and recovery implementation retained' {
    foreach ($value in @('FileMode.CreateNew','ALREADY_RUNNING','ExistingCanonicalChangingLock',
        'ABANDONED_STALE_OWNER','RecoverOrphanedCurrent','OwnerProcessStartedAtUtc')) {
        Require $center.Contains($value) "lease/admission control missing: $value"
    }
}
Check 'normal-user worker launch retained' {
    foreach ($value in @('SaferLevelNormalUser','SaferComputeTokenFromLevel','CreateProcessAsUser',
        'DLE-OS-HOST\DLE-OS')) {
        Require $center.Contains($value) "worker launch control missing: $value"
    }
}
Check 'reattached worker preflight is fail closed without ExitCode' {
    Require (-not $preflight.Contains('process.ExitCode')) `
        'preflight still reads ExitCode from a reattached Process'
    Require $preflight.Contains('[Environment]::NewLine') `
        'preflight JSON does not use a real platform newline'
    Require (-not $preflight.Contains("+'`n'")) `
        'preflight JSON still appends a literal PowerShell newline token'
    foreach ($value in @('WaitForExit(30_000)','!File.Exists(path)',
        'JsonSerializer.Deserialize<WorkerIdentityEvidence>',
        'RequiredWorkerIdentity','evidence.AdministratorRole')) {
        Require $preflight.Contains($value) "preflight fail-closed check missing: $value"
    }
}
Check 'worker dependency manifest is exact' {
    Require ($manifest.schema -ceq 'dle-os.sync-operations-worker-dependencies.v1') `
        'worker manifest schema differs'
    Require (@($manifest.dependencies).Count -ge 15) 'worker dependency manifest is incomplete'
    foreach ($entry in $manifest.dependencies) {
        Require (Test-Path -LiteralPath $entry.path) "dependency absent: $($entry.path)"
        $actual = (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash
        Require ($actual -ceq $entry.sha256) "dependency hash mismatch: $($entry.path)"
    }
}
Check 'protected 5054 excludes Sync Operations' {
    $protected = Text 'Tools\DevelopmentRuntime\DleOs.DevOperationalControlHost\DleOs.DevOperationalControlHost.csproj'
    Require (-not $protected.Contains('SyncOperationsCenter.cs')) `
        'protected 5054 unexpectedly compiles Sync Operations'
    Require $protected.Contains('synchronization') '5054 exclusion declaration absent'
}
Check 'project links only required shared host sources' {
    foreach ($value in @('SyncOperationsCenter.cs','SyncOperationsStatusSnapshot.cs',
        'TrustedDevelopmentIdentity.cs','DevelopmentPermissionAuthorization.cs')) {
        Require $project.Contains($value) "required linked source absent: $value"
    }
    foreach ($value in @('KittingCaseCenter.cs','PlatformRefreshCenter.cs',
        'OperationsRefreshCenter.cs','DailyOperationsSyncCenter.cs')) {
        Require (-not $project.Contains($value)) "broad host source linked: $value"
    }
}

$results | Format-Table -AutoSize | Out-String | Write-Output
$failed = @($results | Where-Object Result -eq 'FAIL')
[pscustomobject]@{
    Total = $results.Count
    Passed = $results.Count - $failed.Count
    Failed = $failed.Count
} | ConvertTo-Json
if ($failed.Count) { exit 1 }
