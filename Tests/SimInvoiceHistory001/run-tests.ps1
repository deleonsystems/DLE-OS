[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$fixturePath = Join-Path $repository 'Tools\SimRuntime\Scenarios\baseline.operations-center.v1.json'
$dataSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsDataStore.cs'
$endpointSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsEndpoints.cs'
$programSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\Program.cs'
$invoiceSource = Join-Path $repository 'SRC\modules\invoice-history\invoice-history.js'
$registrySource = Join-Path $repository 'SRC\shell\workspace-registry.js'
$pathNode = Get-Command node -ErrorAction SilentlyContinue
$nodeCandidates = @(
    $(if ($pathNode) { $pathNode.Source }),
    $env:DLE_OS_SIM_NODE_PATH,
    'C:\Program Files\nodejs\node.exe'
) + @(Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Join-Path $_.FullName '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
})
$node = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$testPort = 5191
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\invoice-history-qualification'
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
        $parameters.Body = $Body | ConvertTo-Json -Compress
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

function Sum-Extended($Items) {
    [decimal]$total = 0
    foreach ($item in @($Items)) { $total += [decimal]$item.extendedPrice }
    return $total
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM Invoice History build failed.' }
$checks.Add('SIM Invoice History host builds')

$fixture = Get-Content $fixturePath -Raw | ConvertFrom-Json
$dataText = Read-Text $dataSource
$endpointText = Read-Text $endpointSource
$programText = Read-Text $programSource
$invoiceText = Read-Text $invoiceSource
$registryText = Read-Text $registrySource
$invoiceLines = @($fixture.invoiceHistoryLines)

Require ($fixture.synthetic -and $fixture.scenarioVersion -eq 5) 'baseline scenario advances deterministically to version 5'
Require (@($fixture.invoiceHeaders).Count -eq 6 -and $invoiceLines.Count -eq 8) 'fixture contains six invoices and eight invoice lines'
Require (@($invoiceLines.invoiceHistoryLineId | Sort-Object -Unique).Count -eq 8) 'invoice line identifiers are stable and unique'
Require (@($invoiceLines | Group-Object invoiceNumber | Where-Object Count -gt 1).Count -eq 2) 'fixture contains two multi-line invoices'
Require (@($invoiceLines | Where-Object { [decimal]$_.quantityShipped -lt 0 -and [decimal]$_.extendedPrice -lt 0 }).Count -eq 1) 'fixture contains one signed credit line'
Require ((Sum-Extended $invoiceLines) -eq [decimal]7789.50) 'fixture signed extended-price total is exactly 7789.50'
Require (@($invoiceLines | Where-Object { $_.customerName -notmatch '^SIM ' }).Count -eq 0) 'all invoice customers are unmistakably synthetic'
Require (@($invoiceLines | Where-Object { $_.salesOrderNumber -notin $fixture.salesOrderLines.salesOrderNumber }).Count -eq 0) 'invoice lines reference the existing Operations Center sales-order world'
Require ($dataText -match 'CREATE TABLE InvoiceHeader' -and $dataText -match 'CREATE TABLE InvoiceHistoryLine' -and $dataText -match 'CREATE TABLE InvoiceHistoryMetadata') 'SQLite schema adds only narrow invoice header, line, and metadata tables'
Require ($dataText -match 'SqliteOpenMode\.ReadOnly' -and $programText -notmatch 'HttpClient|IHttpClientFactory|Process\.Start') 'invoice reads cannot introduce external access or worker launch'
Require ($endpointText -match '/api/platform/live/v1/invoice-history/metadata' -and $endpointText -match '/api/platform/live/v1/invoice-history/\{invoiceHistoryLineId\}') 'established metadata, list, and detail contracts are implemented'
Require ($endpointText -match 'INVOICE_HISTORY_EXECUTION_DISABLED' -and $endpointText -match 'UNAVAILABLE_IN_SIM') 'refresh status is synthetic and refresh execution fails closed'
Require ($registryText -match 'requiredPermission: "sync.operations"' -and $registryText -match 'id: "invoice-history"') 'Invoice History retains the current sync.operations Home permission mapping'
Require ($invoiceText -match 'getCanonicalInvoiceHistory' -and $invoiceText -match 'invoiceDateFrom' -and $invoiceText -match 'invoiceDateTo') 'shared workspace retains its established canonical year-bounded client path'
Require ($invoiceText -match 'rowSearchText' -and $invoiceText -match 'summarizeRows' -and $invoiceText -match 'selectMonth') 'shared search, month selection, and signed summary behavior remain authoritative'
Require ($invoiceText -match 'await loadRows\(\);\s*await loadSyncStatus\(\);' -and $invoiceText -notmatch 'Promise\.all\(\[loadRows\(\), loadSyncStatus\(\)\]\)') 'initial refresh evidence waits for committed row provenance'
Require ($programText -match 'invoiceHistoryData = operationsData\.StatusContract\(\)') 'SIM status explicitly reports Invoice History data health'
Require (-not (Test-Path (Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\sim-invoice-history.js'))) 'no parallel SIM Invoice History frontend exists'

Require (Test-Path $node) 'bundled Node.js runtime is available for shared frontend contract checks'
& $node Tests\InvoiceHistoryPlatform001\run-invoice-history-frontend-tests.mjs
if ($LASTEXITCODE -ne 0) { throw 'FAIL: established Invoice History API client contract test failed.' }
$checks.Add('established Invoice History API client contract remains green')
& $node Tests\InvoiceHistoryWorkspace001\run-tests.mjs
if ($LASTEXITCODE -ne 0) { throw 'FAIL: established Invoice History workspace contract test failed.' }
$checks.Add('established Invoice History shared workspace contract remains green')

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'Invoice History qualification port is free before startup'

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
            $ready = $probe.status -eq 'READY' -and $probe.operationsCenterData.health -eq 'READY' -and $probe.invoiceHistoryData.health -eq 'READY'
            if ($ready) { break }
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM starts with the combined Operations Center and Invoice History database READY'

    $databasePath = Join-Path $repository '.sim-state\data\dle-os-sim.db'
    Require (Test-Path $databasePath) 'combined SQLite database remains under .sim-state'
    & git check-ignore --quiet -- $databasePath
    Require ($LASTEXITCODE -eq 0) 'combined SQLite database remains ignored by Git'

    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $page1 = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?page=1&pageSize=3&invoiceDateFrom=2026-01-01&invoiceDateTo=2026-12-31' $null
    $page2 = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?page=2&pageSize=3&invoiceDateFrom=2026-01-01&invoiceDateTo=2026-12-31' $null
    $page3 = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?page=3&pageSize=3&invoiceDateFrom=2026-01-01&invoiceDateTo=2026-12-31' $null
    Require ($page1.Status -eq 200 -and $page1.Body.totalItems -eq 8 -and $page1.Body.totalPages -eq 3) 'invoice list reports eight lines across three pages'
    Require (@($page1.Body.items).Count -eq 3 -and @($page2.Body.items).Count -eq 3 -and @($page3.Body.items).Count -eq 2) 'invoice paging terminates deterministically as 3/3/2'
    Require ($page1.Body.hasNextPage -and $page1.Body.hasMore -and $page2.Body.hasPreviousPage -and -not $page3.Body.hasNextPage -and -not $page3.Body.hasMore) 'canonical previous, next, and hasMore flags are consistent'
    $pagedIds = @($page1.Body.items.invoiceHistoryLineId) + @($page2.Body.items.invoiceHistoryLineId) + @($page3.Body.items.invoiceHistoryLineId)
    Require (($pagedIds -join ',') -eq 'SIM-IHL-0007,SIM-IHL-0008,SIM-IHL-0006,SIM-IHL-0005,SIM-IHL-0004,SIM-IHL-0002,SIM-IHL-0003,SIM-IHL-0001') 'invoice ordering is newest invoice first and line-stable'
    Require ($page1.Body.totalItems -eq $page2.Body.totalItems -and $page1.Body.generation -eq $page3.Body.generation) 'invoice totals and generation remain stable across pages'

    $all = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?page=1&pageSize=200&invoiceDateFrom=2026-01-01&invoiceDateTo=2026-12-31' $null
    Require ((Sum-Extended $all.Body.items) -eq [decimal]7789.50) 'API signed financial total is exactly 7789.50'
    $september = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200&invoiceDateFrom=2026-09-01&invoiceDateTo=2026-09-30' $null
    Require ($september.Body.totalItems -eq 3 -and (Sum-Extended $september.Body.items) -eq [decimal]997.00) 'inclusive September range returns three lines totaling 997.00'
    $customer = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200&customerNumber=990001' $null
    Require ($customer.Body.totalItems -eq 4 -and @($customer.Body.items | Where-Object customerName -ne 'SIM Aeronautics Lab').Count -eq 0) 'customer-number filter returns four matching lines'
    $invoice = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200&invoiceNumber=9600002' $null
    Require ($invoice.Body.totalItems -eq 2 -and (Sum-Extended $invoice.Body.items) -eq [decimal]2560.00) 'multi-line invoice filter returns two lines totaling 2560.00'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?salesOrderNumber=9800001' $null).Body.totalItems -eq 4) 'Sales Order filter preserves cross-slice references'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?itemNumber=SIM-HOUSING-C' $null).Body.totalItems -eq 2) 'item filter uses exact trimmed semantics'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?workOrderNumber=9700001' $null).Body.totalItems -eq 2) 'Work Order filter returns its two historical invoice lines'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?invoiceDateFrom=2026-09-02&invoiceDateTo=2026-09-02' $null).Body.totalItems -eq 2) 'date boundaries are inclusive'

    $badDate = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?invoiceDateFrom=09-01-2026' $null
    Require ($badDate.Status -eq 400 -and $badDate.Body.code -eq 'DLE_OS_SIM_QUERY_INVALID') 'malformed invoice date fails with structured HTTP 400'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=0' $null).Status -eq 400) 'invalid invoice page size fails with HTTP 400'
    $detail = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history/SIM-IHL-0006' $null
    Require ($detail.Status -eq 200 -and [decimal]$detail.Body.quantityShipped -eq -2 -and [decimal]$detail.Body.extendedPrice -eq -430) 'detail contract preserves the signed credit exactly'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history/SIM-IHL-9999' $null).Status -eq 404) 'missing invoice detail returns HTTP 404'

    $metadata = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history/metadata' $null
    Require ($metadata.Status -eq 200 -and $metadata.Body.customerInvoiceCount -eq 6 -and $metadata.Body.customerInvoiceLineCount -eq 8) 'metadata reconciles six headers and eight lines'
    Require ([decimal]$metadata.Body.signedExtendedPriceTotal -eq [decimal]7789.50 -and $metadata.Body.minimumInvoiceDate -eq '2026-01-20' -and $metadata.Body.maximumInvoiceDate -eq '2026-09-02') 'metadata exposes deterministic date range and signed total'
    Require ($metadata.Body.synthetic -and $metadata.Body.source -eq 'SIM_SYNTHETIC_BASELINE' -and $metadata.Body.generation -eq $all.Body.generation) 'metadata is clearly synthetic and generation-aligned'

    $refreshStatus = Invoke-SimHttp $session 'GET' '/api/platform/refresh/invoice-history/v1/status' $null
    Require ($refreshStatus.Status -eq 200 -and -not $refreshStatus.Body.running -and $refreshStatus.Body.status -eq 'UNAVAILABLE_IN_SIM') 'refresh status is read-only and explicitly unavailable in SIM'
    $refreshRun = Invoke-SimHttp $session 'POST' '/api/platform/refresh/invoice-history/v1/run' @{}
    Require ($refreshRun.Status -eq 501 -and $refreshRun.Body.code -eq 'INVOICE_HISTORY_EXECUTION_DISABLED') 'refresh execution fails locally without launching a worker'
    $afterRefresh = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?page=1&pageSize=200' $null
    Require (($all.Body.items | ConvertTo-Json -Compress -Depth 20) -eq ($afterRefresh.Body.items | ConvertTo-Json -Compress -Depth 20)) 'refresh attempt cannot mutate Invoice History data'

    Select-Persona $session 'operations-manager'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=1' $null).Status -eq 200) 'Operations Manager can read Invoice History'
    Select-Persona $session 'read-only-viewer'
    $viewerResult = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=1' $null
    Require ($viewerResult.Status -eq 403 -and $viewerResult.Body.requiredPermission -eq 'sync.operations') 'Read-Only Viewer remains restricted by the current ambiguous sync.operations mapping'
    Select-Persona $session 'no-access'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=1' $null).Status -eq 403) 'No-Access User is denied Invoice History'
    Select-Persona $session 'administrator'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=1' $null).Status -eq 200) 'SIM Administrator can read Invoice History'

    $operationsBefore = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=1&pageSize=200' $null
    $invoicesBefore = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?page=1&pageSize=200' $null
    $relationshipsBefore = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=200' $null
    $reset = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{ confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString() }
    Require ($reset.Status -eq 200 -and $reset.Body.generation -eq ([long]$invoicesBefore.Body.generation + 1)) 'combined reset advances the SIM generation exactly once'
    $operationsAfter = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=1&pageSize=200' $null
    $invoicesAfter = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?page=1&pageSize=200' $null
    $relationshipsAfter = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=200' $null
    Require (($operationsBefore.Body.items | ConvertTo-Json -Compress -Depth 20) -eq ($operationsAfter.Body.items | ConvertTo-Json -Compress -Depth 20)) 'reset preserves the exact Phase 6 sales-order baseline'
    Require (($relationshipsBefore.Body.items | ConvertTo-Json -Compress -Depth 20) -eq ($relationshipsAfter.Body.items | ConvertTo-Json -Compress -Depth 20)) 'reset preserves the exact Phase 6 relationship baseline'
    Require (($invoicesBefore.Body.items | ConvertTo-Json -Compress -Depth 20) -eq ($invoicesAfter.Body.items | ConvertTo-Json -Compress -Depth 20)) 'reset reconstructs the exact Phase 7 invoice baseline'
    Require ((Invoke-SimHttp $session 'GET' '/api/auth/me' $null).Body.personaId -eq 'administrator') 'combined reset returns the session to SIM Administrator'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit()
    }
}

Require ($hostProcess.HasExited) 'Invoice History qualification host stops cleanly'

Write-Host "PASS: $($checks.Count) DLE-OS SIM Invoice History checks."
$checks | ForEach-Object { Write-Host "  - $_" }
