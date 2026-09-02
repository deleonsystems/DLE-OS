[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$fixturePath = Join-Path $repository 'Tools\SimRuntime\Scenarios\baseline.operations-center.v1.json'
$dataSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsDataStore.cs'
$endpointSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsEndpoints.cs'
$rendererSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimShellRenderer.cs'
$normalizerSource = Join-Path $repository 'SRC\modules\operations-center\operations-center-data-service.js'
$kittingSource = Join-Path $repository 'SRC\workspaces\kitting\kitting-workspace.js'
$registrySource = Join-Path $repository 'SRC\shell\workspace-registry.js'
$testPort = 5192
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\broader-read-only-qualification'
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
        $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 20
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

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: Phase 8 SIM build failed.' }
$checks.Add('Phase 8 SIM host builds')

$fixture = Get-Content $fixturePath -Raw | ConvertFrom-Json
$states = @($fixture.kittingReadStates)
$workOrderNumbers = @($fixture.workOrders.workOrderNumber)
$registryText = Read-Text $registrySource
$dataText = Read-Text $dataSource
$endpointText = Read-Text $endpointSource
$rendererText = Read-Text $rendererSource
$normalizerText = Read-Text $normalizerSource
$kittingText = Read-Text $kittingSource

Require ($fixture.synthetic -and $fixture.scenarioVersion -eq 5) 'baseline scenario advances deterministically to version 5'
Require ($states.Count -eq 3) 'fixture contains three authoritative Kitting read states'
Require (@($states.kittingReadStateId | Sort-Object -Unique).Count -eq 3) 'Kitting read-state identifiers are stable and unique'
Require (@($states.workOrderNumber | Where-Object { $_ -notin $workOrderNumbers }).Count -eq 0) 'Kitting states reference only Phase 6 Work Orders'
Require ((@($states.materialStatus.machineValue | Sort-Object) -join ',') -eq 'KIT_COMPLETE,KIT_SHORT,NEEDS_KITTING') 'fixture covers Needs Kitting, Kit Short, and Kit Complete exactly once'
Require (($states | Where-Object workOrderNumber -eq '9700001').materialStatus.machineValue -eq 'KIT_COMPLETE') 'Work Order 9700001 is the deterministic normal production-ready story'
Require (($states | Where-Object workOrderNumber -eq '9700002').materialStatus.machineValue -eq 'KIT_SHORT') 'Work Order 9700002 is the deterministic shortage and Purchasing story'
Require (($states | Where-Object workOrderNumber -eq '9700003').materialStatus.machineValue -eq 'NEEDS_KITTING') 'Work Order 9700003 is the deterministic not-yet-kitted story'
Require (@($states | Where-Object { -not $_.materialStatus.workOrderNumber -or $_.materialStatus.workOrderNumber -ne $_.workOrderNumber }).Count -eq 0) 'material projections have no orphan Work Order identity'
Require ($dataText -match 'CREATE TABLE KittingReadState' -and $dataText -match 'FOREIGN KEY\(WorkOrderNumber\) REFERENCES WorkOrder') 'SQLite adds one narrow Work Order-linked Kitting read-state table'
Require ($dataText -match 'SqliteOpenMode\.ReadOnly' -and $dataText -match 'AddEmbeddedKittingProjectionsAsync') 'business reads remain SQLite read-only and provide shared embedded projections'
Require ($endpointText -match '/api/kitting-cases/v1/work-orders/\{workOrderNumber\}') 'established Kitting Case read contract is implemented'
Require ($endpointText -match '\["kitting\.view"\]' -and $endpointText -match 'alternativePermissions') 'Kitting Home permission authorizes its required canonical Work Order reads'
Require ($normalizerText -match "source\.materialStatus" -and $normalizerText -match 'source\.materialStatusWorkOrderNumber') 'shared canonical normalization preserves authoritative embedded read projections'
Require ($kittingText -match 'resolveOpenQuantity' -and $kittingText -match 'record\?\.erpQuantityOpen') 'Kitting falls back to canonical ERP open quantity when optional operational enrichment is unavailable'
Require ($rendererText -match '#workOrderDashboardKitReleasedBom' -and $rendererText -match '#workOrderDashboardSetDisposition' -and $rendererText -match '#activeKittingSaveExit') 'SIM hides governed Kitting mutation controls'
foreach ($workspace in @('purchasing','kitting','production')) {
    Require ($registryText -match "id: `"$workspace`"[\s\S]*?home: Object\.freeze\([\s\S]*?requiredPermission: `"kitting\.view`"") "$workspace is a current Home-backed kitting.view workspace"
}
Require (-not (Test-Path (Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\sim-purchasing.js'))) 'no parallel SIM Purchasing frontend exists'
Require (-not (Test-Path (Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\sim-kitting.js'))) 'no parallel SIM Kitting frontend exists'
Require (-not (Test-Path (Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\sim-production.js'))) 'no parallel SIM Production frontend exists'

$pathNode = Get-Command node -ErrorAction SilentlyContinue
$nodeCandidates = @(
    $(if ($pathNode) { $pathNode.Source }),
    $env:DLE_OS_SIM_NODE_PATH,
    'C:\Program Files\nodejs\node.exe'
) + @(Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Join-Path $_.FullName '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
})
$node = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Require (Test-Path $node) 'Node.js is available for established shared workspace contract tests'
foreach ($script in @(
    'Tests\KittingHomeOperatorQueue001\run-tests.mjs',
    'Tests\PurchasingWorkspaceEntry001\run-tests.mjs',
    'Tests\ProductionWorkspace001\run-tests.mjs'
)) {
    & $node $script
    if ($LASTEXITCODE -ne 0) { throw "FAIL: established shared workspace test failed: $script" }
    $checks.Add("established shared workspace contract remains green: $script")
}

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'Phase 8 qualification port is free before startup'
$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.dll'
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($hostProcess.HasExited) { break }
        try {
            $probe = Invoke-RestMethod -Uri "$baseUri/api/sim/status" -TimeoutSec 1
            $ready = $probe.status -eq 'READY' -and $probe.homeOperationsData.health -eq 'READY' -and $probe.homeOperationsData.schemaVersion -eq 4
            if ($ready) { break }
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM starts with Phase 6-9 business data READY at schema version 4'

    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $sales = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=1&pageSize=200' $null
    Require ($sales.Status -eq 200 -and $sales.Body.totalItems -eq 7) 'Phase 6 Sales Order baseline remains seven lines'
    Require (@($sales.Body.items | Where-Object { -not $_.PSObject.Properties['materialStatus'] }).Count -eq 0) 'every Sales Order line carries explicit embedded projection fields'
    $projected = @($sales.Body.items | Where-Object { $_.materialStatusWorkOrderNumber })
    Require ($projected.Count -eq 3) 'exact governed relationships project three Kitting Work Orders'
    Require ((@($projected.materialStatus.machineValue | Sort-Object) -join ',') -eq 'KIT_COMPLETE,KIT_SHORT,NEEDS_KITTING') 'canonical read chain exposes all three required Kitting queues'

    $complete = Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700001' $null
    $short = Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700002' $null
    $needs = Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700003' $null
    Require ($complete.Status -eq 200 -and $complete.Body.kittingCase.state -eq 'KIT_COMPLETE' -and $complete.Body.readOnly) 'Kit Complete Kitting Case read is local, synthetic, and read-only'
    Require ($short.Status -eq 200 -and $short.Body.kittingCase.state -eq 'KIT_SHORT' -and $short.Body.kittingCase.synthetic) 'Kit Short Kitting Case read preserves synthetic case evidence'
    Require ($needs.Status -eq 200 -and $null -eq $needs.Body.kittingCase -and -not $needs.Body.hasPersistentKittingHistory) 'Needs Kitting read correctly has no invented persistent case'
    Require ((Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9799999' $null).Status -eq 404) 'missing Kitting read state returns HTTP 404'

    Select-Persona $session 'kitting-operator'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=1' $null).Status -eq 200) 'Kitting Operator can read the shared Sales Order source'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-order-work-order-relationships?pageSize=1' $null).Status -eq 200) 'Kitting Operator can read the supporting relationship contract'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/work-orders?pageSize=1' $null).Status -eq 200) 'Kitting Operator can read supporting canonical Work Orders'
    Require ((Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700002' $null).Status -eq 200) 'Kitting Operator can read material status evidence'
    $beforeMutation = (Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700002' $null).Body | ConvertTo-Json -Compress -Depth 20
    $unsupportedMutation = Invoke-SimHttp $session 'POST' '/api/kitting-cases/v1/work-orders/9700002/submit' @{}
    Require ($unsupportedMutation.Status -eq 501 -and $unsupportedMutation.Body.code -eq 'DLE_OS_SIM_BUSINESS_CONTRACT_UNAVAILABLE') 'authorized Kitting mutation fails locally with HTTP 501'
    $afterMutation = (Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700002' $null).Body | ConvertTo-Json -Compress -Depth 20
    Require ($afterMutation -eq $beforeMutation) 'failed Kitting mutation cannot alter the read baseline'

    Select-Persona $session 'read-only-viewer'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=1' $null).Status -eq 200) 'Read-Only Viewer can see Home-backed operational queues'
    Require ((Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700001' $null).Status -eq 200) 'Read-Only Viewer can inspect Kitting material state'
    $viewerMutation = Invoke-SimHttp $session 'PUT' '/api/kitting-cases/v1/work-orders/9700001/draft' @{}
    Require ($viewerMutation.Status -eq 403 -and $viewerMutation.Body.requiredPermission -eq 'kitting.disposition') 'Read-Only Viewer is denied Kitting mutation server-side'

    Select-Persona $session 'no-access'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=1' $null).Status -eq 403) 'No-Access User is denied Home queue source data'
    Require ((Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700001' $null).Status -eq 403) 'No-Access User is denied Kitting read state'

    Select-Persona $session 'administrator'
    $salesBefore = $sales.Body.items | ConvertTo-Json -Compress -Depth 20
    $invoicesBefore = (Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 20
    $statesBefore = @($complete.Body.kittingCase.state, $short.Body.kittingCase.state, $needs.Body.kittingCase) | ConvertTo-Json -Compress -Depth 20
    $generationBefore = [long](Invoke-SimHttp $session 'GET' '/api/sim/state' $null).Body.generation
    $reset = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{ confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString() }
    Require ($reset.Status -eq 200 -and [long]$reset.Body.generation -eq $generationBefore + 1) 'combined Phase 6-8 reset advances generation exactly once'
    $salesAfter = (Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 20
    $invoicesAfter = (Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200' $null).Body.items | ConvertTo-Json -Compress -Depth 20
    Require ($salesAfter -eq $salesBefore) 'reset reconstructs the exact Phase 6 Sales Order and Phase 8 projection baseline'
    Require ($invoicesAfter -eq $invoicesBefore) 'reset preserves the exact Phase 7 Invoice History baseline'
    $completeAfter = Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700001' $null
    $shortAfter = Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700002' $null
    $needsAfter = Invoke-SimHttp $session 'GET' '/api/kitting-cases/v1/work-orders/9700003' $null
    $statesAfter = @($completeAfter.Body.kittingCase.state, $shortAfter.Body.kittingCase.state, $needsAfter.Body.kittingCase) | ConvertTo-Json -Compress -Depth 20
    Require ($statesAfter -eq $statesBefore) 'reset reconstructs all Phase 8 material states exactly'
    Require ((Invoke-SimHttp $session 'GET' '/api/auth/me' $null).Body.personaId -eq 'administrator') 'combined reset returns the session to SIM Administrator'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit()
    }
}

Require ((Get-Item $stderr).Length -eq 0) 'Phase 8 qualification host writes no stderr diagnostics'
Write-Output "PASS: $($checks.Count) DLE-OS SIM broader read-only checks."
$checks | ForEach-Object { Write-Output "  - $_" }
