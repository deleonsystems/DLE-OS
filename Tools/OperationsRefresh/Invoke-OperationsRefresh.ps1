[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Manual', 'Scheduled')]
    [string] $Trigger,
    [switch] $QuietWindowReady,
    [ValidateSet('', 'customer-master', 'sales-order', 'invoice-history')]
    [string] $QualificationFailStep = ''
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
    throw "Operations Refresh requires non-elevated $approvedIdentity."
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$root = 'C:\DLE-OS\Canonical\OperationsRefresh'
$stateRoot = Join-Path $root 'State'
$runsRoot = Join-Path $root 'Runs'
$statusPath = Join-Path $stateRoot 'status.json'
$historyPath = Join-Path $stateRoot 'runs.jsonl'
$lockPath = Join-Path $stateRoot 'operations-refresh.lock'
$customerStatus =
    'C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\status.json'
$salesStatus =
    'C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\status.json'
$invoiceStatus =
    'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json'
$steps = @(
    [ordered]@{
        Id = 'customer-master'
        Name = 'Customer Master'
        Runner = Join-Path $repo (
            'Tools\OperationsRefresh\Invoke-CustomerMasterRoutineRefresh.ps1')
        Status = $customerStatus
    },
    [ordered]@{
        Id = 'sales-order'
        Name = 'Open Sales Orders'
        Runner = Join-Path $repo (
            'Tools\OperationsRefresh\Invoke-OpenSalesOrderRoutineRefresh.ps1')
        Status = $salesStatus
    },
    [ordered]@{
        Id = 'invoice-history'
        Name = 'Invoice History'
        Runner = Join-Path $repo (
            'Tools\InvoiceHistory\Invoke-InvoiceHistoryRefresh.ps1')
        Status = $invoiceStatus
    }
)
foreach ($step in $steps) {
    if (-not (Test-Path -LiteralPath $step.Runner -PathType Leaf)) {
        throw "Allowlisted Operations runner is unavailable: $($step.Id)"
    }
}

$pacific = [TimeZoneInfo]::FindSystemTimeZoneById('Pacific Standard Time')
$nowUtc = [DateTimeOffset]::UtcNow
$nowPacific = [TimeZoneInfo]::ConvertTime($nowUtc, $pacific)
$weekday = $nowPacific.DayOfWeek -notin @(
    [DayOfWeek]::Saturday, [DayOfWeek]::Sunday)
$insideApprovedWindow =
    $weekday -and $nowPacific.TimeOfDay -ge [TimeSpan]::Zero -and
    $nowPacific.TimeOfDay -lt [TimeSpan]::FromHours(6)
$insideScheduledStartWindow =
    $weekday -and $nowPacific.TimeOfDay -ge [TimeSpan]::Zero -and
    $nowPacific.TimeOfDay -le [TimeSpan]::FromHours(4.5)
if ($Trigger -ceq 'Scheduled' -and -not $insideScheduledStartWindow) {
    $missed = [ordered]@{
        Result = 'Blocked'
        Code = 'MissedQuietWindow'
        Trigger = $Trigger
        EvaluatedAtUtc = $nowUtc.ToString('O')
        EvaluatedAtPacific = $nowPacific.ToString('O')
        SourceReadsStarted = $false
    }
    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    $missed | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $statusPath -Encoding UTF8
    $missed | ConvertTo-Json -Depth 8 -Compress |
        Add-Content -LiteralPath $historyPath -Encoding UTF8
    $missed | ConvertTo-Json -Depth 8
    exit 3
}
if (
    $Trigger -ceq 'Manual' -and
    -not $insideApprovedWindow -and
    -not $QuietWindowReady
) {
    throw 'Manual Operations Refresh requires quiet-window acknowledgement.'
}

New-Item -ItemType Directory -Path $stateRoot, $runsRoot -Force | Out-Null
$incompatibleStates = @(
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json',
    $customerStatus,
    $salesStatus,
    $invoiceStatus
)
foreach ($path in $incompatibleStates) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $existing = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $runningProperty = $existing.PSObject.Properties['Running']
    $stateProperty = @(
        $existing.PSObject.Properties['OverallState'],
        $existing.PSObject.Properties['Status'],
        $existing.PSObject.Properties['Result']
    ) | Where-Object { $null -ne $_ } | Select-Object -First 1
    if (
        ($null -ne $runningProperty -and $runningProperty.Value -eq $true) -or
        ($null -ne $stateProperty -and
            [string]$stateProperty.Value -ieq 'RUNNING')
    ) {
        [pscustomobject]@{ Result = 'ALREADY_RUNNING'; BlockingState = $path } |
            ConvertTo-Json
        exit 2
    }
}
try {
    $lock = [IO.File]::Open(
        $lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
        [IO.FileShare]::None)
}
catch [IO.IOException] {
    [pscustomobject]@{ Result = 'ALREADY_RUNNING' } | ConvertTo-Json
    exit 2
}

$runId = 'OPERATIONSREFRESH-' +
    $nowUtc.ToString('yyyyMMddTHHmmssZ') + '-' +
    ([Guid]::NewGuid().ToString('N')[0..7] -join '').ToUpperInvariant()
$runRoot = Join-Path $runsRoot $runId
New-Item -ItemType Directory -Path $runRoot | Out-Null
$stepResults = [Collections.Generic.List[object]]::new()

function Read-Json([string] $Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    return $null
}

function Get-JsonProperty([object] $Value, [string[]] $Names) {
    $current = $Value
    foreach ($name in $Names) {
        if ($null -eq $current) { return $null }
        $property = $current.PSObject.Properties[$name]
        if ($null -eq $property) { return $null }
        $current = $property.Value
    }
    return $current
}

function Write-OperationsStatus(
    [string] $State,
    [string] $CurrentStep,
    [Nullable[DateTimeOffset]] $CompletedAt
) {
    $value = [ordered]@{
        ContractVersion = 'operations-refresh-v1'
        OperationsRefreshRunId = $runId
        TriggerType = $Trigger
        RequestedBy = $identity.Name
        QuietWindowStatus = if ($insideApprovedWindow) {
            'InsideApprovedWindow'
        } else {
            'OperatorAcknowledged'
        }
        StartedAtUtc = $nowUtc.ToString('O')
        CompletedAtUtc = if ($null -ne $CompletedAt) {
            $CompletedAt.ToString('O')
        } else { $null }
        OverallState = $State
        CurrentStep = $CurrentStep
        StepResults = @($stepResults)
        NextScheduledRun = $null
    }
    $stage = Join-Path $stateRoot ".$runId.status"
    [IO.File]::WriteAllText(
        $stage, (($value | ConvertTo-Json -Depth 14) + "`n"),
        [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $stage -Destination $statusPath -Force
}

try {
    Write-OperationsStatus 'Running' 'customer-master' $null
    foreach ($step in $steps) {
        Write-OperationsStatus 'Running' $step.Id $null
        $stepStarted = [DateTimeOffset]::UtcNow
        $log = Join-Path $runRoot "$($step.Id).log"
        $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-File', $step.Runner)
        if ($QualificationFailStep -ceq $step.Id) {
            $arguments += '-QualificationInduceFailure'
        }
        & powershell.exe @arguments *>&1 |
            Set-Content -LiteralPath $log -Encoding UTF8
        $exitCode = $LASTEXITCODE
        $state = Read-Json $step.Status
        $result = if ($null -ne $state -and $state.Result) {
            [string]$state.Result
        } elseif ($exitCode -eq 0) {
            'SUCCESS'
        } else {
            'FAILED'
        }
        $afterImportRunId = @(
            Get-JsonProperty $state @(
                'Details','Import','CustomerMasterImportRunId')
            Get-JsonProperty $state @(
                'Details','Import','SalesOrderExtensionRunId')
            Get-JsonProperty $state @(
                'Details','Import','InvoiceHistoryImportRunId')
        ) | Where-Object { $null -ne $_ } | Select-Object -First 1
        $stepResults.Add([ordered]@{
            Dataset = $step.Id
            StartedAtUtc = $stepStarted.ToString('O')
            CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
            DurationMilliseconds = [long](
                ([DateTimeOffset]::UtcNow - $stepStarted).TotalMilliseconds)
            Result = $result
            ExitCode = $exitCode
            BeforeImportRunId = $null
            AfterImportRunId = $afterImportRunId
            Inserted = Get-JsonProperty $state @('Details','Counts','inserted')
            Updated = Get-JsonProperty $state @('Details','Counts','updated')
            Unchanged = Get-JsonProperty $state @('Details','Counts','unchanged')
            Missing = Get-JsonProperty $state @('Details','Counts','missing')
            PriorDataRetained = if ($null -ne (
                Get-JsonProperty $state @('Details','PriorDataRetained')
            )) {
                Get-JsonProperty $state @('Details','PriorDataRetained')
            } else { $true }
            EvidenceIdentity = $step.Status
            FailureReason =
                Get-JsonProperty $state @('Details','FailureReason')
        })
    }
    $failed = @($stepResults | Where-Object Result -in @('FAILED', 'BLOCKED'))
    $successful = @($stepResults | Where-Object Result -in @(
        'SUCCESS', 'NO_SOURCE_CHANGES'))
    $changed = @($stepResults | Where-Object Result -eq 'SUCCESS')
    $overall = if ($failed.Count -gt 0 -and $successful.Count -gt 0) {
        'PartialSuccess'
    } elseif ($failed.Count -eq $steps.Count) {
        'Failed'
    } elseif ($changed.Count -eq 0) {
        'NoSourceChanges'
    } else {
        'Completed'
    }
    $completed = [DateTimeOffset]::UtcNow
    Write-OperationsStatus $overall '' $completed
    $final = Read-Json $statusPath
    $final | ConvertTo-Json -Depth 14 -Compress |
        Add-Content -LiteralPath $historyPath -Encoding UTF8
    $final | ConvertTo-Json -Depth 14
    if ($overall -in @('Failed', 'PartialSuccess')) { exit 1 }
}
finally {
    if ($lock) { $lock.Dispose() }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
