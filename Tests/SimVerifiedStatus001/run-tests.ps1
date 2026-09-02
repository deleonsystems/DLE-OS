[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$fixturePath = Join-Path $repository 'Tools\SimRuntime\Scenarios\baseline.operations-center.v1.json'
$dataSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsDataStore.cs'
$endpointSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsEndpoints.cs'
$rendererSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimShellRenderer.cs'
$sharedDataSource = Join-Path $repository 'SRC\modules\operations-center\operations-center-data-service.js'
$testPort = 5193
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\verified-status-qualification'
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
        [object] $Body,
        [string] $RawBody
    )
    $parameters = @{
        Uri = $baseUri + $Path
        Method = $Method
        WebSession = $Session
        UseBasicParsing = $true
        TimeoutSec = 5
        ErrorAction = 'Stop'
    }
    if ($PSBoundParameters.ContainsKey('RawBody')) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $RawBody
    }
    elseif ($null -ne $Body) {
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
            Body = $(if ([string]::IsNullOrWhiteSpace($text)) { $null } else {
                try { $text | ConvertFrom-Json } catch { $text }
            })
        }
    }
}

function Select-Persona($Session, [string] $PersonaId) {
    $result = Invoke-SimHttp $Session 'POST' '/api/sim/persona' @{ personaId = $PersonaId }
    Require ($result.Status -eq 200 -and $result.Body.selectedPersonaId -eq $PersonaId) "persona selection succeeds: $PersonaId"
}

function Read-Latest($Session, [string] $WorkOrder) {
    Invoke-SimHttp $Session 'POST' '/api/operations-center/v1/work-orders/verified-statuses/latest' @{
        workOrderNumbers = @($WorkOrder)
    }
}

function Read-History($Session, [string] $WorkOrder) {
    Invoke-SimHttp $Session 'GET' "/api/operations-center/v1/work-orders/$WorkOrder/verified-status-history" $null
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: Phase 9 SIM build failed.' }
$checks.Add('Phase 9 SIM host builds')

$fixture = Get-Content $fixturePath -Raw | ConvertFrom-Json
$events = @($fixture.workOrderVerifiedStatusEvents)
$workOrders = @($fixture.workOrders.workOrderNumber)
$dataText = Read-Text $dataSource
$endpointText = Read-Text $endpointSource
$rendererText = Read-Text $rendererSource
$sharedDataText = Read-Text $sharedDataSource

Require ($fixture.synthetic -and $fixture.scenarioVersion -eq 5) 'baseline scenario advances deterministically to version 5'
Require ($events.Count -eq 3) 'fixture contains three baseline Work Order Verified Status events'
Require (@($events.eventId | Sort-Object -Unique).Count -eq 3) 'baseline event IDs are stable and unique'
Require (@($events.requestCorrelationId | Sort-Object -Unique).Count -eq 3) 'baseline correlation IDs are stable and unique'
Require ((@($events.eventSequence | Sort-Object) -join ',') -eq '1,2,3') 'baseline event sequence is deterministic and contiguous'
Require (@($events.workOrderNumber | Where-Object { $_ -notin $workOrders }).Count -eq 0) 'baseline status events reference only established Work Orders'
Require (($events | Where-Object workOrderNumber -eq '9700001').statusText -eq 'Ready for production') 'Work Order 9700001 has the selected deterministic baseline status'
Require ($dataText -match 'CREATE TABLE WorkOrderVerifiedStatusEvent' -and $dataText -match 'PreviousStatusText' -and $dataText -match 'RequestCorrelationId TEXT NOT NULL UNIQUE') 'SQLite has one narrow append-only status event table with previous value and idempotency key'
Require ($dataText -match 'OpenReadWrite' -and $dataText -match 'SqliteOpenMode\.ReadWrite' -and $dataText -match 'await gate\.WaitAsync') 'the local write path is serialized and confined to clone-local SQLite'
Require ($dataText -match 'DeterministicGuid' -and $dataText -match 'DeterministicClockStartUtc\.AddMinutes') 'event identity and timestamps use the deterministic SIM foundation'
Require ($endpointText -match '/api/operations-center/v1/work-orders/\{workOrderNumber\}/verified-status-events' -and $endpointText -match 'Status201Created') 'the existing Work Order append contract returns HTTP 201'
Require ($endpointText -match 'operations-center\.verified-status\.write') 'the exact repository-defined write permission is enforced by the endpoint'
Require ($endpointText -match '/api/operations-center/v1/work-orders/verified-statuses/latest' -and $endpointText -match 'verified-status-history') 'existing batch-latest and history read contracts are implemented'
Require ($rendererText -match 'SIM_STATEFUL_VERIFIED_STATUS') 'SIM opts into only the stateful Verified Status Operations Center mode'
Require ($sharedDataText -match 'hasEmbeddedGovernedProjections' -and $sharedDataText -match "hasOwnProperty\.call\(row, 'materialStatus'\)") 'shared Operations Center accepts complete authoritative embedded projections'
Require (-not (Test-Path (Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\sim-verified-status.js'))) 'no parallel SIM status editor exists'

$pathNode = Get-Command node -ErrorAction SilentlyContinue
$nodeCandidates = @(
    $(if ($pathNode) { $pathNode.Source }),
    $env:DLE_OS_SIM_NODE_PATH,
    'C:\Program Files\nodejs\node.exe'
) + @(Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Join-Path $_.FullName '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
})
$node = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Require (Test-Path $node) 'Node.js is available for established shared Verified Status tests'
foreach ($script in @(
    'Tests\OperationsCenterWorkOrderStatus001\run-tests.mjs',
    'Tests\OperationsCenterManagerTable001\run-tests.mjs'
)) {
    & $node $script
    if ($LASTEXITCODE -ne 0) { throw "FAIL: established shared test failed: $script" }
    $checks.Add("established shared contract remains green: $script")
}

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'Phase 9 qualification port is free before startup'
$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.dll'
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue

    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $reachable = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($hostProcess.HasExited) { break }
        try {
            $probe = Invoke-SimHttp $session 'GET' '/api/sim/state' $null
            $reachable = $probe.Status -in @(200,409)
            if ($reachable) { break }
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $reachable 'SIM starts locally for Phase 9 qualification'

    $stateProbe = Invoke-SimHttp $session 'GET' '/api/sim/state' $null
    if ($stateProbe.Status -ne 200 -or $stateProbe.Body.scenarioVersion -ne 5) {
        $bootstrapReset = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{
            confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString()
        }
        Require ($bootstrapReset.Status -eq 200) 'incompatible prior phase state upgrades through the qualified reset path'
    }
    $ready = Invoke-SimHttp $session 'GET' '/api/sim/status' $null
    Require ($ready.Status -eq 200 -and $ready.Body.operationsCenterData.health -eq 'READY' -and $ready.Body.operationsCenterData.schemaVersion -eq 4) 'SIM business state is READY at schema version 4'

    $baselineLatest = Read-Latest $session '9700001'
    $baselineHistory = Read-History $session '9700001'
    Require ($baselineLatest.Status -eq 200 -and $baselineLatest.Body.records.Count -eq 1 -and $baselineLatest.Body.records[0].statusText -eq 'Ready for production') 'batch-latest returns the baseline Work Order status'
    Require ($baselineHistory.Status -eq 200 -and $baselineHistory.Body.records.Count -eq 1 -and $baselineHistory.Body.records[0].eventSequence -eq 1) 'history returns the deterministic baseline event'
    $allLatest = Invoke-SimHttp $session 'POST' '/api/operations-center/v1/work-orders/verified-statuses/latest' @{ workOrderNumbers = @('9700001','9700002','9700003') }
    Require ($allLatest.Status -eq 200 -and $allLatest.Body.records.Count -eq 3) 'batch-latest returns all three baseline Work Order statuses'
    Require ((Invoke-SimHttp $session 'POST' '/api/operations-center/v1/verified-statuses/latest' @{ masterRecordKeys = @('990001|9800001|001') }).Body.records.Count -eq 0) 'line latest contract returns an explicit empty read model without enabling line mutation'

    $salesBefore = (Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 30
    $invoicesBefore = (Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 30
    $kittingBefore = (Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700001' $null).Body | ConvertTo-Json -Compress -Depth 30

    Select-Persona $session 'operations-manager'
    $correlation = '92000000-0000-4000-8000-000000000099'
    $appendBody = @{
        statusText = 'In final inspection'
        evidenceSnapshot = @{ workOrder = '9700001'; source = 'SIM_BROWSER_COMPATIBLE_TEST' }
        requestCorrelationId = $correlation
    }
    $append = Invoke-SimHttp $session 'POST' '/api/operations-center/v1/work-orders/9700001/verified-status-events' $appendBody
    Require ($append.Status -eq 201 -and -not $append.Body.duplicate) 'Operations Manager can append a Work Order Verified Status'
    Require ($append.Body.record.statusText -eq 'In final inspection' -and $append.Body.record.workOrderNumber -eq '9700001') 'append response matches the established record shape'
    Require ($append.Body.record.recordedBy -eq 'sim.operations') 'successful append records the synthetic authenticated actor'
    Require ($append.Body.record.eventSequence -eq 4 -and $append.Body.record.requestCorrelationId -eq $correlation) 'first mutation receives deterministic ordinal 4 and preserves its correlation ID'

    $latestAfter = Read-Latest $session '9700001'
    $historyAfter = Read-History $session '9700001'
    Require ($latestAfter.Body.records[0].statusText -eq 'In final inspection') 'latest read model updates immediately without host restart'
    Require ($historyAfter.Body.records.Count -eq 2) 'one successful mutation produces exactly one additional history event'
    Require ($historyAfter.Body.records[0].eventId -eq $append.Body.record.eventId -and $historyAfter.Body.records[1].statusText -eq 'Ready for production') 'history distinguishes current and prior status append-only'
    Require (($historyAfter.Body | ConvertTo-Json -Compress -Depth 20) -eq ((Read-History $session '9700001').Body | ConvertTo-Json -Compress -Depth 20)) 'repeated history read is deterministic'

    $retry = Invoke-SimHttp $session 'POST' '/api/operations-center/v1/work-orders/9700001/verified-status-events' $appendBody
    Require ($retry.Status -eq 201 -and $retry.Body.duplicate -and $retry.Body.record.eventId -eq $append.Body.record.eventId) 'same correlation retry returns the original event idempotently'
    Require ((Read-History $session '9700001').Body.records.Count -eq 2) 'idempotent retry creates no duplicate history event'

    $invalid = Invoke-SimHttp $session 'POST' '/api/operations-center/v1/work-orders/9700001/verified-status-events' @{
        statusText = '   '; requestCorrelationId = '92000000-0000-4000-8000-000000000101'
    }
    Require ($invalid.Status -eq 400 -and $invalid.Body.code -eq 'verified_status_text_required') 'blank status is rejected with the established structured validation error'
    $missing = Invoke-SimHttp $session 'POST' '/api/operations-center/v1/work-orders/9799999/verified-status-events' @{
        statusText = 'Should not exist'; requestCorrelationId = '92000000-0000-4000-8000-000000000102'
    }
    Require ($missing.Status -eq 404 -and $missing.Body.code -eq 'work_order_not_found') 'missing Work Order mutation returns structured HTTP 404'
    $malformed = Invoke-SimHttp -Session $session -Method 'POST' -Path '/api/operations-center/v1/work-orders/9700001/verified-status-events' -Body $null -RawBody '{'
    Require ($malformed.Status -eq 400) 'malformed JSON request is rejected with HTTP 400'
    $lineWrite = Invoke-SimHttp $session 'POST' '/api/operations-center/v1/lines/990001%7C9800001%7C001/verified-status-events' @{
        statusText = 'Not in Phase 9'; requestCorrelationId = '92000000-0000-4000-8000-000000000103'
    }
    Require ($lineWrite.Status -eq 501 -and $lineWrite.Body.code -eq 'DLE_OS_SIM_BUSINESS_CONTRACT_UNAVAILABLE') 'individual-line mutation remains outside the Phase 9 write scope'
    Require ((Read-History $session '9700001').Body.records.Count -eq 2) 'validation and unsupported paths add no history'

    foreach ($deniedPersona in @('read-only-viewer','no-access','disabled')) {
        Select-Persona $session $deniedPersona
        $denied = Invoke-SimHttp $session 'POST' '/api/operations-center/v1/work-orders/9700001/verified-status-events' @{
            statusText = "Denied $deniedPersona"; requestCorrelationId = [guid]::NewGuid().ToString()
        }
        Require ($denied.Status -eq 403) "$deniedPersona is denied Verified Status mutation server-side"
        if ($deniedPersona -eq 'disabled') {
            Require ($denied.Body.code -eq 'DLE_OS_USER_DISABLED') 'disabled account status overrides assigned capabilities'
        }
        else {
            Require ($denied.Body.requiredPermission -eq 'operations-center.verified-status.write') "$deniedPersona denial reports the exact required permission"
        }
    }

    Select-Persona $session 'administrator'
    Require ((Read-History $session '9700001').Body.records.Count -eq 2) 'denied requests do not mutate state or append history'
    $adminAppend = Invoke-SimHttp $session 'POST' '/api/operations-center/v1/work-orders/9700001/verified-status-events' @{
        statusText = 'Released from final inspection'
        evidenceSnapshot = @{ workOrder = '9700001'; source = 'SIM_ADMIN_TEST' }
        requestCorrelationId = '92000000-0000-4000-8000-000000000104'
    }
    Require ($adminAppend.Status -eq 201 -and $adminAppend.Body.record.recordedBy -eq 'sim.admin' -and $adminAppend.Body.record.eventSequence -eq 5) 'SIM Administrator can append the same governed status event type'
    Require ((Read-Latest $session '9700001').Body.records[0].statusText -eq 'Released from final inspection') 'Administrator mutation becomes the current read projection'
    Require (((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 30) -eq $salesBefore) 'Verified Status mutation does not alter Sales Orders or Kitting projections'
    Require (((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 30) -eq $invoicesBefore) 'Verified Status mutation does not alter Invoice History'
    Require (((Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700001' $null).Body | ConvertTo-Json -Compress -Depth 30) -eq $kittingBefore) 'Verified Status mutation does not alter Kitting state'

    $generationBefore = [long](Invoke-SimHttp $session 'GET' '/api/sim/state' $null).Body.generation
    $reset = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{
        confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString()
    }
    Require ($reset.Status -eq 200 -and [long]$reset.Body.generation -eq $generationBefore + 1) 'Phase 9 reset advances generation exactly once'
    $resetLatest = Read-Latest $session '9700001'
    $resetHistory = Read-History $session '9700001'
    Require ($resetLatest.Body.records[0].statusText -eq 'Ready for production') 'reset restores the exact baseline current status'
    Require ($resetHistory.Body.records.Count -eq 1 -and $resetHistory.Body.records[0].eventSequence -eq 1) 'reset removes mutation history and reconstructs only baseline history'
    Require ((Invoke-SimHttp $session 'GET' '/api/auth/me' $null).Body.personaId -eq 'administrator') 'reset returns the session to SIM Administrator'
    Require (((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 30) -eq $salesBefore) 'reset preserves the exact Phase 6 and Phase 8 read baseline'
    Require (((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 30) -eq $invoicesBefore) 'reset preserves the exact Phase 7 baseline'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit()
    }
}

Require ((Get-Item $stderr).Length -eq 0) 'Phase 9 qualification host writes no stderr diagnostics'
Write-Output "PASS: $($checks.Count) DLE-OS SIM Verified Status checks."
$checks | ForEach-Object { Write-Output "  - $_" }
