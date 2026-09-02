[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$faultSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimFaultStore.cs'
$endpointSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsEndpoints.cs'
$dataSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsDataStore.cs'
$rendererSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimShellRenderer.cs'
$stateSource = Join-Path $repository 'SRC\modules\operations-center\operations-center-state.js'
$viewModelSource = Join-Path $repository 'SRC\modules\operations-center\operations-center-view-model.js'
$tableSource = Join-Path $repository 'SRC\modules\operations-center\operations-center-table.js'
$testPort = 5194
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\workflow-failure-qualification'
$stdout = Join-Path $testRoot 'host.stdout.log'
$stderr = Join-Path $testRoot 'host.stderr.log'
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if ($Condition -is [Array]) { throw "FAIL: non-Boolean test result for $Message" }
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function Read-Text([string] $Path) { [IO.File]::ReadAllText($Path) }

function Invoke-SimHttp {
    param(
        [Microsoft.PowerShell.Commands.WebRequestSession] $Session,
        [string] $Method,
        [string] $Path,
        [object] $Body
    )
    $parameters = @{
        Uri = $baseUri + $Path
        Method = $Method
        WebSession = $Session
        UseBasicParsing = $true
        TimeoutSec = 5
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 30
    }
    try {
        $response = Invoke-WebRequest @parameters
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body = $(if ([string]::IsNullOrWhiteSpace($response.Content)) { $null } else { $response.Content | ConvertFrom-Json })
        }
    }
    catch {
        $response = $_.Exception.Response
        if ($null -eq $response) { throw }
        $text = [string]$_.ErrorDetails.Message
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body = $(if ([string]::IsNullOrWhiteSpace($text)) { $null } else { $text | ConvertFrom-Json })
        }
    }
}

function Select-Persona($Session, [string] $PersonaId) {
    $result = Invoke-SimHttp $Session 'POST' '/api/sim/persona' @{ personaId = $PersonaId }
    Require ($result.Status -eq 200 -and $result.Body.selectedPersonaId -eq $PersonaId) "persona selection succeeds: $PersonaId"
}

function Select-Fault($Session, [string] $FaultId) {
    Invoke-SimHttp $Session 'POST' '/api/sim/fault' @{ faultId = $FaultId }
}

function Reset-Sim($Session) {
    Invoke-SimHttp $Session 'POST' '/api/sim/reset' @{
        confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString()
    }
}

function Get-StatusLatest($Session) {
    Invoke-SimHttp $Session 'POST' '/api/operations-center/v1/work-orders/verified-statuses/latest' @{
        workOrderNumbers = @('9700001')
    }
}

function Get-StatusHistory($Session) {
    Invoke-SimHttp $Session 'GET' '/api/operations-center/v1/work-orders/9700001/verified-status-history' $null
}

function Append-Status($Session, [string] $Status, [string] $Correlation) {
    Invoke-SimHttp $Session 'POST' '/api/operations-center/v1/work-orders/9700001/verified-status-events' @{
        statusText = $Status
        evidenceSnapshot = @{ workOrder = '9700001'; source = 'SIM_PHASE_10_QUALIFICATION' }
        requestCorrelationId = $Correlation
    }
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: Phase 10 SIM build failed.' }
$checks.Add('Phase 10 SIM host builds')

$faultText = Read-Text $faultSource
$endpointText = Read-Text $endpointSource
$dataText = Read-Text $dataSource
$rendererText = Read-Text $rendererSource
$stateText = Read-Text $stateSource
$viewModelText = Read-Text $viewModelSource
$tableText = Read-Text $tableSource

Require ($faultText -match 'verified-status-response-lost' -and $faultText -match 'NEXT_SUCCESS_ONCE') 'lost-response fault is explicit and one-shot'
Require ($faultText -match 'verified-status-write-unavailable' -and $faultText -match 'VERIFIED_STATUS_WRITE_PRECOMMIT') 'storage fault is narrowly pre-commit scoped'
Require ($faultText -match 'verified-status-read-unavailable' -and $faultText -match 'VERIFIED_STATUS_READ') 'read fault is narrowly Verified Status scoped'
Require ($faultText -match 'localOnly = true' -and $faultText -match 'deterministic = true') 'fault metadata declares deterministic local-only behavior'
Require ($endpointText -match 'DLE_OS_SIM_VERIFIED_STATUS_RESPONSE_LOST' -and $endpointText -match 'ConsumeOnce') 'lost response is injected only after a new committed append'
Require ($dataText -match 'failBeforeCommit\?\.Invoke' -and $dataText -match 'DLE_OS_SIM_VERIFIED_STATUS_WRITE_UNAVAILABLE') 'storage failure occurs after validation and before ordinal allocation'
Require ($stateText -match 'state\.verifiedStatusByKey = \{\}' -and $stateText -match 'state\.workOrderVerifiedStatusByNumber = \{\}') 'verified read failure clears stale status maps'
Require ($viewModelText -match 'verifiedStatusError' -and $tableText -match 'Verified Status unavailable') 'shared UI distinguishes unavailable service from no recorded status'
Require ($rendererText -match 'dleSimFaultControl' -and $rendererText -match '/api/sim/fault') 'SIM controls expose a restrained fault selector'
Require (-not (Test-Path (Join-Path $repository 'SRC\modules\operations-center\sim-faults.js'))) 'no fault logic is added to normal business routes or a parallel UI'

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'Phase 10 qualification port is free before startup'
$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.dll'
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($hostProcess.HasExited) { break }
        try {
            $probe = Invoke-SimHttp $session 'GET' '/api/sim/status' $null
            $ready = $probe.Status -eq 200 -and $probe.Body.operationsCenterData.health -eq 'READY'
            if ($ready) { break }
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM starts with healthy Phase 6-9 state'

    $initialReset = Reset-Sim $session
    Require ($initialReset.Status -eq 200) 'Phase 10 qualification starts from a reconstructed no-fault baseline'

    $catalog = Invoke-SimHttp $session 'GET' '/api/sim/faults' $null
    Require ($catalog.Status -eq 200 -and $catalog.Body.activeFaultId -eq 'none' -and $catalog.Body.profiles.Count -eq 4) 'fault catalog starts at none with exactly three bounded profiles'
    $invalid = Select-Fault $session 'random-chaos'
    Require ($invalid.Status -eq 400 -and $invalid.Body.code -eq 'DLE_OS_SIM_FAULT_UNKNOWN') 'unknown and random fault IDs fail closed'

    Select-Persona $session 'operations-manager'
    $lostSelection = Select-Fault $session 'verified-status-response-lost'
    Require ($lostSelection.Status -eq 200 -and $lostSelection.Body.state.status -eq 'ARMED' -and $lostSelection.Body.state.remainingOccurrences -eq 1) 'lost-response fault arms exactly one occurrence'
    Select-Persona $session 'read-only-viewer'
    $deniedUnderFault = Append-Status $session 'Unauthorized ambiguity' '93000000-0000-4000-8000-000000000001'
    Require ($deniedUnderFault.Status -eq 403 -and $deniedUnderFault.Body.requiredPermission -eq 'operations-center.verified-status.write') 'fault injection does not bypass write authorization'
    $stillArmed = Invoke-SimHttp $session 'GET' '/api/sim/faults' $null
    Require ($stillArmed.Body.state.status -eq 'ARMED' -and $stillArmed.Body.state.triggerCount -eq 0) 'unauthorized request does not trigger or consume the fault'

    Select-Persona $session 'operations-manager'
    $lostCorrelation = '93000000-0000-4000-8000-000000000002'
    $lost = Append-Status $session 'In final inspection under ambiguity' $lostCorrelation
    Require ($lost.Status -eq 503 -and $lost.Body.code -eq 'DLE_OS_SIM_VERIFIED_STATUS_RESPONSE_LOST' -and $lost.Body.outcome -eq 'UNKNOWN_TO_CALLER') 'lost-response request returns a deterministic ambiguous HTTP 503 after commit'
    Require ($lost.Body.fault.status -eq 'CONSUMED' -and $lost.Body.fault.triggerCount -eq 1 -and $lost.Body.fault.remainingOccurrences -eq 0) 'one-shot fault reports consumed state explicitly'
    $lostHistory = Get-StatusHistory $session
    Require ($lostHistory.Body.records.Count -eq 2 -and $lostHistory.Body.records[0].statusText -eq 'In final inspection under ambiguity') 'ambiguous response still committed exactly one history event'
    $lostEvent = $lostHistory.Body.records[0]
    Require ($lostEvent.eventSequence -eq 4 -and $lostEvent.requestCorrelationId -eq $lostCorrelation) 'committed ambiguous event has deterministic ordinal and original correlation'
    $retry = Append-Status $session 'In final inspection under ambiguity' $lostCorrelation
    Require ($retry.Status -eq 201 -and $retry.Body.duplicate -and $retry.Body.record.eventId -eq $lostEvent.eventId) 'explicit retry returns the original committed event'
    Require ((Get-StatusHistory $session).Body.records.Count -eq 2) 'retry creates no duplicate event'

    $resetAfterLost = Reset-Sim $session
    Require ($resetAfterLost.Status -eq 200) 'reset succeeds after committed-response ambiguity'
    $afterLostReset = Invoke-SimHttp $session 'GET' '/api/sim/faults' $null
    Require ($afterLostReset.Body.activeFaultId -eq 'none' -and $afterLostReset.Body.state.status -eq 'INACTIVE') 'reset clears consumed fault state to none'
    Require ((Get-StatusHistory $session).Body.records.Count -eq 1) 'reset removes the ambiguous mutation history'

    Select-Persona $session 'operations-manager'
    $writeA = Append-Status $session 'In final inspection' '93000000-0000-4000-8000-000000000010'
    $writeB = Append-Status $session 'Ready to ship' '93000000-0000-4000-8000-000000000011'
    Require ($writeA.Status -eq 201 -and $writeB.Status -eq 201 -and -not $writeA.Body.duplicate -and -not $writeB.Body.duplicate) 'two closely ordered distinct writes each commit exactly once'
    Require ($writeA.Body.record.eventSequence -eq 4 -and $writeB.Body.record.eventSequence -eq 5) 'serialized append produces deterministic contiguous ordinals 4 and 5'
    $orderedHistory = Get-StatusHistory $session
    Require ($orderedHistory.Body.records.Count -eq 3 -and $orderedHistory.Body.records[0].statusText -eq 'Ready to ship' -and $orderedHistory.Body.records[1].statusText -eq 'In final inspection') 'history preserves both transitions in deterministic latest-first order'
    Require ((Get-StatusLatest $session).Body.records[0].statusText -eq 'Ready to ship') 'last committed event is the current status projection'

    Require ((Reset-Sim $session).Status -eq 200) 'reset succeeds after closely ordered writes'
    Select-Persona $session 'operations-manager'
    $storageSelection = Select-Fault $session 'verified-status-write-unavailable'
    Require ($storageSelection.Status -eq 200 -and $storageSelection.Body.state.status -eq 'ARMED') 'pre-commit storage fault arms successfully'
    $beforeStorageHistory = (Get-StatusHistory $session).Body | ConvertTo-Json -Compress -Depth 20
    $beforeStorageLatest = (Get-StatusLatest $session).Body | ConvertTo-Json -Compress -Depth 20
    $storageCorrelation = '93000000-0000-4000-8000-000000000020'
    $storageFailure = Append-Status $session 'Should fail before commit' $storageCorrelation
    Require ($storageFailure.Status -eq 503 -and $storageFailure.Body.code -eq 'DLE_OS_SIM_VERIFIED_STATUS_WRITE_UNAVAILABLE') 'storage fault returns a clear safe HTTP 503'
    Require (((Get-StatusHistory $session).Body | ConvertTo-Json -Compress -Depth 20) -eq $beforeStorageHistory) 'pre-commit failure adds no partial history event'
    Require (((Get-StatusLatest $session).Body | ConvertTo-Json -Compress -Depth 20) -eq $beforeStorageLatest) 'pre-commit failure leaves current status unchanged'
    $storageState = Invoke-SimHttp $session 'GET' '/api/sim/faults' $null
    Require ($storageState.Body.state.status -eq 'TRIGGERED' -and $storageState.Body.state.triggerCount -eq 1) 'persistent storage fault reports its occurrence count'
    Require ((Select-Fault $session 'none').Status -eq 200) 'storage fault can be removed without damaging state'
    $storageRetry = Append-Status $session 'Should fail before commit' $storageCorrelation
    Require ($storageRetry.Status -eq 201 -and $storageRetry.Body.record.eventSequence -eq 4) 'retry after removing storage fault succeeds without an ordinal gap'

    Require ((Reset-Sim $session).Status -eq 200) 'reset succeeds after storage-failure qualification'
    Select-Persona $session 'operations-manager'
    $readSelection = Select-Fault $session 'verified-status-read-unavailable'
    Require ($readSelection.Status -eq 200 -and $readSelection.Body.state.status -eq 'ARMED') 'Verified Status read fault arms successfully'
    $readFailure = Get-StatusLatest $session
    Require ($readFailure.Status -eq 503 -and $readFailure.Body.code -eq 'DLE_OS_SIM_VERIFIED_STATUS_READ_UNAVAILABLE') 'Verified Status latest read fails with an explicit scoped error'
    $canonical = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=200' $null
    Require ($canonical.Status -eq 200 -and $canonical.Body.totalItems -eq 7) 'canonical Operations Center rows remain available during status read failure'
    $invoice = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200' $null
    Require ($invoice.Status -eq 200 -and $invoice.Body.totalItems -eq 8) 'Invoice History remains healthy during scoped status read failure'
    $kitting = Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700001' $null
    Require ($kitting.Status -eq 200 -and $kitting.Body.kittingCase.state -eq 'KIT_COMPLETE') 'Kitting and Production source state remains healthy during scoped read failure'

    $generationBefore = [long](Invoke-SimHttp $session 'GET' '/api/sim/state' $null).Body.generation
    $finalReset = Reset-Sim $session
    Require ($finalReset.Status -eq 200 -and [long]$finalReset.Body.generation -eq $generationBefore + 1) 'final reset advances generation exactly once'
    $finalFault = Invoke-SimHttp $session 'GET' '/api/sim/faults' $null
    Require ($finalFault.Body.activeFaultId -eq 'none' -and $finalFault.Body.state.triggerCount -eq 0) 'final reset restores fault none with zero occurrences'
    Require ((Get-StatusLatest $session).Body.records[0].statusText -eq 'Ready for production') 'final reset restores the Phase 9 baseline current status'
    Require ((Get-StatusHistory $session).Body.records.Count -eq 1) 'final reset restores baseline-only status history'
    Require ((Invoke-SimHttp $session 'GET' '/api/auth/me' $null).Body.personaId -eq 'administrator') 'final reset restores SIM Administrator'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=200' $null).Body.totalItems -eq 7) 'final reset preserves Phase 6 and Phase 8 baseline data'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200' $null).Body.totalItems -eq 8) 'final reset preserves Phase 7 baseline data'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit()
    }
}

Require ((Get-Item $stderr).Length -eq 0) 'Phase 10 qualification host writes no stderr diagnostics'
Write-Output "PASS: $($checks.Count) DLE-OS SIM workflow/failure checks."
$checks | ForEach-Object { Write-Output "  - $_" }
