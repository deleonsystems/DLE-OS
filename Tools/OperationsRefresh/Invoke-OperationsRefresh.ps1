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
        Name = 'Recent Invoice / Shipment History'
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
$currentStepNumber = 0
$currentDataset = ''
$currentPhase = ''
$recordsProcessed = $null
$recordsExpected = $null
$lastProgressAt = $nowUtc

function Get-LastCompletedRunDurationSeconds {
    if (-not (Test-Path -LiteralPath $historyPath -PathType Leaf)) {
        return $null
    }
    $lines = @(Get-Content -LiteralPath $historyPath |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    for ($index = $lines.Count - 1; $index -ge 0; $index--) {
        try {
            $prior = $lines[$index] | ConvertFrom-Json
            $priorStateProperty = @(
                $prior.PSObject.Properties['OverallStatus'],
                $prior.PSObject.Properties['OverallState']
            ) | Where-Object { $null -ne $_ } | Select-Object -First 1
            if (
                $null -eq $priorStateProperty -or
                [string]$priorStateProperty.Value -notin @(
                    'Completed', 'NoSourceChanges',
                    'PartialSuccess', 'Failed')
            ) {
                continue
            }
            $startedProperty = @(
                $prior.PSObject.Properties['StartedAt'],
                $prior.PSObject.Properties['StartedAtUtc']
            ) | Where-Object {
                $null -ne $_ -and
                -not [string]::IsNullOrWhiteSpace([string]$_.Value)
            } | Select-Object -First 1
            $completedProperty = @(
                $prior.PSObject.Properties['CompletedAt'],
                $prior.PSObject.Properties['CompletedAtUtc']
            ) | Where-Object {
                $null -ne $_ -and
                -not [string]::IsNullOrWhiteSpace([string]$_.Value)
            } | Select-Object -First 1
            $startedText = if ($null -ne $startedProperty) {
                $startedProperty.Value
            } else { $null }
            $completedText = if ($null -ne $completedProperty) {
                $completedProperty.Value
            } else { $null }
            if ($null -ne $startedText -and $null -ne $completedText) {
                $priorStarted = [DateTimeOffset]::Parse([string]$startedText)
                $priorCompleted = [DateTimeOffset]::Parse([string]$completedText)
                return [long][Math]::Max(
                    0, [Math]::Round(
                        ($priorCompleted - $priorStarted).TotalSeconds))
            }
        }
        catch {
            continue
        }
    }
    return $null
}

$lastCompletedRunDurationSeconds =
    Get-LastCompletedRunDurationSeconds

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
    $statusNow = [DateTimeOffset]::UtcNow
    $value = [ordered]@{
        ContractVersion = 'operations-refresh-v1'
        OperationsRefreshRunId = $runId
        OverallStatus = $State
        CurrentStepNumber = $currentStepNumber
        TotalSteps = $steps.Count
        CurrentDataset = $currentDataset
        CurrentPhase = $currentPhase
        RecordsProcessed = $recordsProcessed
        RecordsExpected = $recordsExpected
        StartedAt = $nowUtc.ToString('O')
        LastProgressAt = $lastProgressAt.ToString('O')
        ElapsedSeconds = [long][Math]::Max(
            0, [Math]::Floor(($statusNow - $nowUtc).TotalSeconds))
        LastCompletedRunDurationSeconds = $lastCompletedRunDurationSeconds
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
    $currentStepNumber = 1
    $currentDataset = $steps[0].Name
    $currentPhase = 'Starting'
    Write-OperationsStatus 'Running' 'customer-master' $null
    for ($stepIndex = 0; $stepIndex -lt $steps.Count; $stepIndex++) {
        $step = $steps[$stepIndex]
        $currentStepNumber = $stepIndex + 1
        $currentDataset = $step.Name
        $currentPhase = 'Starting'
        $recordsProcessed = $null
        $recordsExpected = $null
        $lastProgressAt = [DateTimeOffset]::UtcNow
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
        $afterImportCandidates = @(
            @(
                Get-JsonProperty $state @(
                    'Details','Import','CustomerMasterImportRunId')
                Get-JsonProperty $state @(
                    'Details','Import','SalesOrderExtensionRunId')
                Get-JsonProperty $state @(
                    'Details','Import','InvoiceHistoryImportRunId')
            ) | Where-Object { $null -ne $_ }
        )
        $afterImportRunId = if ($afterImportCandidates.Count -gt 0) {
            [string]$afterImportCandidates[0]
        } else {
            $null
        }
        $stepCompleted = [DateTimeOffset]::UtcNow
        $stepResults.Add([ordered]@{
            Dataset = $step.Id
            StartedAtUtc = $stepStarted.ToString('O')
            CompletedAtUtc = $stepCompleted.ToString('O')
            DurationMilliseconds = [long](
                ($stepCompleted - $stepStarted).TotalMilliseconds)
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
        $currentPhase = 'Complete'
        $lastProgressAt = $stepCompleted
        Write-OperationsStatus 'Running' $step.Id $null
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
    $currentStepNumber = 0
    $currentDataset = ''
    $currentPhase = 'Complete'
    $recordsProcessed = $null
    $recordsExpected = $null
    $lastProgressAt = $completed
    $lastCompletedRunDurationSeconds = [long][Math]::Max(
        0, [Math]::Round(($completed - $nowUtc).TotalSeconds))
    Write-OperationsStatus $overall '' $completed
    $final = Read-Json $statusPath
    $final | ConvertTo-Json -Depth 14 -Compress |
        Add-Content -LiteralPath $historyPath -Encoding UTF8
    $final | ConvertTo-Json -Depth 14
    if ($overall -in @('Failed', 'PartialSuccess')) { exit 1 }
}
catch {
    $failedAt = [DateTimeOffset]::UtcNow
    $currentPhase = 'Failed'
    $lastProgressAt = $failedAt
    $lastCompletedRunDurationSeconds = [long][Math]::Max(
        0, [Math]::Round(($failedAt - $nowUtc).TotalSeconds))
    Write-OperationsStatus 'Failed' $steps[
        [Math]::Max(0, $currentStepNumber - 1)].Id $failedAt
    $failedStatus = Read-Json $statusPath
    $failedStatus | ConvertTo-Json -Depth 14 -Compress |
        Add-Content -LiteralPath $historyPath -Encoding UTF8
    throw
}
finally {
    if ($lock) { $lock.Dispose() }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
