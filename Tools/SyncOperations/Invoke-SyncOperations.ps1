[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^SYNCOPS-[A-Z0-9-]+$')][string] $RunId,
    [Parameter(Mandatory)][string] $RequestedBy,
    [Parameter(Mandatory)][string] $StatePath,
    [Parameter(Mandatory)][string] $CurrentPath,
    [Parameter(Mandatory)][string] $LeasePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
$runRoot = Join-Path (Split-Path $StatePath -Parent) `
    ([IO.Path]::GetFileNameWithoutExtension($StatePath))
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
[ordered]@{
    EnteredAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ProcessId = $PID
    Identity = $identity
    AdministratorRole = $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    Script = $PSCommandPath
} | ConvertTo-Json -Depth 4 | Set-Content `
    (Join-Path $runRoot 'worker-entry.json') -Encoding UTF8
if ($identity -ine 'DLE-OS-HOST\DLE-OS') {
    throw "Sync Operations requires DLE-OS-HOST\DLE-OS; actual identity is $identity."
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$dailyScript = Join-Path $repo 'Tools\DailyOperationsSync\Invoke-DailyOperationsSync.ps1'
$invoiceScript = Join-Path $repo 'Tools\InvoiceHistory\Invoke-InvoiceHistoryRefresh.ps1'
$started = [DateTimeOffset]::UtcNow
$env:DLE_OS_SYNC_OPERATIONS_RUN_ID = $RunId
$daily = $null
$invoice = $null
$readiness = $null
$status = 'RUNNING'
$step = 'Starting governed synchronization'
$result = $null

function Write-AtomicJson([string]$Path, [object]$Value) {
    $stage = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($stage, (($Value | ConvertTo-Json -Depth 20) + "`n"),
        [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $stage -Destination $Path -Force
}

function Write-RunState {
    $now = [DateTimeOffset]::UtcNow
    $state = [ordered]@{
        RunId=$RunId; Operation='FOCUSED_OPERATIONAL_SYNC_V1'; Status=$status
        CurrentStep=$step; RequestedBy=$RequestedBy; RequestedAtUtc=$started.ToString('O')
        StartedAtUtc=$started.ToString('O'); CompletedAtUtc=if($status -eq 'RUNNING'){$null}else{$now.ToString('O')}
        HeartbeatAtUtc=$now.ToString('O'); ElapsedSeconds=[long]($now-$started).TotalSeconds
        OwnerProcessId=$PID; ExecutionIdentity=$identity
        DailyOperations=$daily; InvoiceHistory=$invoice; CanonicalReadiness=$readiness
        Result=$result
    }
    Write-AtomicJson $StatePath $state
    Write-AtomicJson $CurrentPath $state
    if (Test-Path -LiteralPath $LeasePath) {
        $lease = Get-Content -LiteralPath $LeasePath -Raw | ConvertFrom-Json
        if ($lease.RunId -cne $RunId) { throw 'The synchronization lease owner changed unexpectedly.' }
        $lease.HeartbeatAtUtc = $now.ToString('O')
        $lease.Status = $status
        if ($lease.PSObject.Properties.Name -notcontains 'CurrentStep') {
            $lease | Add-Member NoteProperty CurrentStep $step
        } else { $lease.CurrentStep = $step }
        Write-AtomicJson $LeasePath $lease
    }
}

function Invoke-GovernedChild(
    [string]$Name, [string]$Script, [string[]]$Arguments,
    [string]$ChildStatusPath, [string]$InitialStep) {
    $stdout = Join-Path $runRoot "$Name.stdout.log"
    $stderr = Join-Path $runRoot "$Name.stderr.log"
    $launchedAt = [DateTimeOffset]::UtcNow
    $argumentList = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$Script) + $Arguments
    $process = Start-Process powershell.exe -ArgumentList $argumentList -WindowStyle Hidden `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    while (-not $process.WaitForExit(2000)) {
        $script:step = $InitialStep
        if (Test-Path -LiteralPath $ChildStatusPath) {
            try {
                $childState = Get-Content -LiteralPath $ChildStatusPath -Raw | ConvertFrom-Json
                $phase = @($childState.CurrentComponent, $childState.CurrentPhase) |
                    Where-Object { $_ } | Select-Object -First 1
                if ($phase) { $script:step = "$InitialStep - $phase" }
            } catch {}
        }
        Write-RunState
    }
    $exitCode = $process.ExitCode
    if ($null -ne $exitCode -and [int]$exitCode -ne 0) {
        $detail = Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue
        throw "$Name failed with exit code $exitCode. $detail"
    }
    if (-not (Test-Path -LiteralPath $ChildStatusPath)) {
        throw "$Name completed without durable status evidence."
    }
    if ((Get-Item -LiteralPath $ChildStatusPath).LastWriteTimeUtc -lt $launchedAt.UtcDateTime) {
        throw "$Name completed without fresh durable status evidence."
    }
    return Get-Content -LiteralPath $ChildStatusPath -Raw | ConvertFrom-Json
}

try {
    Write-RunState
    $daily = Invoke-GovernedChild 'daily-operations' $dailyScript `
        @('-Trigger','SyncOperations','-CanonicalApiOnlyFinalization') `
        'C:\DLE-OS\Canonical\DailyOperationsSync\State\status.json' `
        'Synchronizing Customer Master, Work Orders, Open Sales Orders, and relationships'
    if ($daily.OverallStatus -cne 'PASSED_PROMOTED_READY') {
        throw "Daily operational synchronization returned $($daily.OverallStatus)."
    }

    $step = 'Synchronizing 45-day Invoice History'
    Write-RunState
    $invoice = Invoke-GovernedChild 'invoice-history' $invoiceScript @() `
        'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json' $step
    if ($invoice.Result -notin @('SUCCESS','SUCCESS_WITH_CLARIFICATIONS','NO_SOURCE_CHANGES')) {
        throw "Invoice History synchronization returned $($invoice.Result)."
    }

    $step = 'Verifying canonical API 5052 readiness and visibility'
    Write-RunState
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    do {
        try {
            $readiness = Invoke-RestMethod -UseDefaultCredentials -TimeoutSec 10 `
                'http://dle-os-host:5052/api/platform/live/v1/readiness'
        } catch { $readiness = $null }
        if ($readiness -and $readiness.readinessState -ceq 'ReadyFresh' -and
            ([Guid]$readiness.currentImportRunId) -eq ([Guid]$daily.ImportRunId)) { break }
        Start-Sleep -Seconds 2
        Write-RunState
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if (-not $readiness -or $readiness.readinessState -cne 'ReadyFresh' -or
        ([Guid]$readiness.currentImportRunId) -ne ([Guid]$daily.ImportRunId)) {
        $status = 'PROMOTED_BUT_NOT_VISIBLE'
        throw 'Canonical SQL promotion completed, but API 5052 did not expose the promoted generation.'
    }

    $status = 'SUCCEEDED'
    $step = 'Complete'
    $result = 'Focused operational synchronization committed and is visible through API 5052.'
    Write-RunState
}
catch {
    if ($status -eq 'RUNNING') { $status = 'FAILED' }
    $result = $_.Exception.Message
    Write-RunState
    Write-Error $result
    exit 1
}
finally {
    if (Test-Path -LiteralPath $LeasePath) {
        try {
            $lease = Get-Content -LiteralPath $LeasePath -Raw | ConvertFrom-Json
            if ($lease.RunId -ceq $RunId) { Remove-Item -LiteralPath $LeasePath -Force }
        } catch {}
    }
    Remove-Item Env:\DLE_OS_SYNC_OPERATIONS_RUN_ID -ErrorAction SilentlyContinue
}
