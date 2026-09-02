[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$fixturePath = Join-Path $repository 'Tools\SimRuntime\Scenarios\baseline.operations-center.v1.json'
$dataSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsDataStore.cs'
$endpointSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimOperationsEndpoints.cs'
$rendererSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimShellRenderer.cs'
$operationsSource = Join-Path $repository 'SRC\modules\operations-center\operations-center.js'
$testPort = 5194
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\operations-center-qualification'
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

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM Operations Center build failed.' }
$checks.Add('SIM Operations Center host builds')

$projectText = Read-Text $project
$dataText = Read-Text $dataSource
$endpointText = Read-Text $endpointSource
$rendererText = Read-Text $rendererSource
$operationsText = Read-Text $operationsSource
$fixture = Get-Content $fixturePath -Raw | ConvertFrom-Json

Require ($projectText -match 'Microsoft.Data.Sqlite" Version="8\.0\.29"' -and $projectText -notmatch 'SqlClient') 'SIM uses the pinned local SQLite provider and no external SQL client'
Require ($fixture.schema -eq 'dle-os-sim.operations-center-fixture.v1' -and $fixture.synthetic -and $fixture.scenarioVersion -eq 5) 'tracked fixture is explicitly synthetic and scenario-versioned'
Require (@($fixture.salesOrderLines).Count -eq 7 -and @($fixture.salesOrderLines.salesOrderNumber | Sort-Object -Unique).Count -eq 3) 'fixture contains seven lines across three synthetic sales orders'
Require (@($fixture.workOrders).Count -eq 4 -and @($fixture.relationships).Count -eq 7) 'fixture contains representative work orders and one relationship per sales line'
Require (@($fixture.salesOrderLines | Where-Object { $_.customerName -notmatch '^SIM ' }).Count -eq 0) 'fixture customer identities are unmistakably synthetic'
Require ($dataText -match 'SqliteOpenMode\.ReadOnly' -and $dataText -match 'dle-os-sim\.db' -and $dataText -match 'FixtureSha256') 'SQLite reads are read-only and validate tracked fixture provenance'
Require ($endpointText -match '/api/platform/live/v1/sales-orders' -and $endpointText -match '/api/platform/live/v1/work-orders' -and $endpointText -match '/api/platform/live/v1/sales-order-work-order-relationships') 'existing canonical Operations Center routes are implemented'
Require ($rendererText -match 'SIM_STATEFUL_VERIFIED_STATUS' -and $operationsText -match 'CANONICAL_READ_ONLY') 'shared Operations Center enables only the Phase 9 stateful Verified Status mode in SIM'
Require ($operationsText -match 'refreshOperationsCenterOperationalEnrichment' -and $operationsText -match 'return false') 'unavailable operational enrichment does not enter a SIM retry loop'
Require (-not (Test-Path (Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\sim-operations-center.js'))) 'no parallel SIM Operations Center frontend exists'

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'Operations Center qualification port is free before startup'

$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.dll'
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue

    $available = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($hostProcess.HasExited) { break }
        try {
            $probe = Invoke-RestMethod -Uri "$baseUri/api/sim/status" -TimeoutSec 1
            $available = $true
            if ($probe.status -eq 'READY') { break }
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $available 'SIM starts for Operations Center qualification'
    Require ($probe.status -eq 'READY' -and $probe.operationsCenterData.health -eq 'READY') 'SIM and Operations Center data report READY'
    Require ($probe.operationsCenterData.database -eq 'data/dle-os-sim.db' -and $probe.operationsCenterData.externalProviders.Count -eq 0) 'status exposes only the clone-local SQLite database'
    $databasePath = Join-Path $repository '.sim-state\data\dle-os-sim.db'
    Require (Test-Path $databasePath) 'SQLite database exists under the ignored SIM state root'
    & git check-ignore --quiet -- $databasePath
    Require ($LASTEXITCODE -eq 0) 'SQLite database is excluded from source control'

    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $page1 = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=1&pageSize=3' $null
    $page2 = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=2&pageSize=3' $null
    $page3 = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=3&pageSize=3' $null
    Require ($page1.Status -eq 200 -and $page1.Body.totalItems -eq 7 -and $page1.Body.totalPages -eq 3 -and $page1.Body.hasNextPage) 'sales-order first page has stable totals and continuation'
    Require (@($page1.Body.items).Count -eq 3 -and @($page2.Body.items).Count -eq 3 -and @($page3.Body.items).Count -eq 1 -and -not $page3.Body.hasNextPage) 'sales-order paging terminates with 3/3/1 records'
    $pagedIds = @($page1.Body.items.salesOrderLineId) + @($page2.Body.items.salesOrderLineId) + @($page3.Body.items.salesOrderLineId)
    Require (($pagedIds -join ',') -eq 'SIM-SOL-0001,SIM-SOL-0002,SIM-SOL-0003,SIM-SOL-0004,SIM-SOL-0005,SIM-SOL-0006,SIM-SOL-0007') 'sales-order paging order is deterministic and duplicate-free'
    Require ($page1.Body.generation -eq $page2.Body.generation -and $page2.Body.generation -eq $page3.Body.generation -and $page2.Body.totalItems -eq 7) 'all sales-order pages share one generation and total'

    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?customerNumber=990002' $null).Body.totalItems -eq 3) 'customer-number filter is exact'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?customerName=Orbital' $null).Body.totalItems -eq 3) 'customer-name filter supports canonical contains matching'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?salesOrderNumber=9800001' $null).Body.totalItems -eq 2) 'sales-order-number filter is exact'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?itemNumber=SIM-HOUSING-C' $null).Body.totalItems -eq 2) 'item-number filter returns the related synthetic lines'
    $negative = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?negativeQuantity=true' $null
    Require ($negative.Body.totalItems -eq 1 -and $negative.Body.items[0].salesOrderLineId -eq 'SIM-SOL-0007') 'negative-quantity filter exposes its edge case'
    $unresolved = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?unresolvedWorkOrder=true' $null
    Require ($unresolved.Body.totalItems -eq 1 -and $unresolved.Body.items[0].salesOrderLineId -eq 'SIM-SOL-0006') 'unresolved-work-order filter exposes its edge case'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?workOrderNumber=9700003' $null).Body.totalItems -eq 3) 'work-order filter includes exact and candidate relationships'
    $invalidPage = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=201' $null
    Require ($invalidPage.Status -eq 400 -and $invalidPage.Body.code -eq 'DLE_OS_SIM_QUERY_INVALID') 'invalid paging fails with a structured HTTP 400'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders/SIM-SOL-0001' $null).Body.customerName -eq 'SIM Aeronautics Lab') 'sales-order-line record lookup returns the canonical record'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders/SIM-SOL-9999' $null).Status -eq 404) 'missing sales-order-line lookup returns HTTP 404'

    $workOrders = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/work-orders?page=1&pageSize=200' $null
    Require ($workOrders.Status -eq 200 -and $workOrders.Body.totalItems -eq 4 -and (($workOrders.Body.items.workOrderNumber -join ',') -eq '9700001,9700002,9700003,9700004')) 'work-order collection is deterministic and complete'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/work-orders?status=OPEN' $null).Body.totalItems -eq 2) 'work-order status filter is exact'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/work-orders?itemNumber=SIM-HOUSING-C' $null).Body.totalItems -eq 1) 'work-order item filter uses canonical item semantics'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/work-orders/9700001' $null).Body.itemNumber -eq 'SIM-ACTUATOR-A') 'work-order record lookup returns the canonical record'

    $relationships = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=200' $null
    Require ($relationships.Status -eq 200 -and $relationships.Body.totalItems -eq 7) 'relationship collection covers every sales-order line'
    $relationshipKeys = @($relationships.Body.items | ForEach-Object { "$($_.customerNumber)/$($_.salesOrderNumber)/$($_.salesOrderLineNumber)" })
    Require (@($relationshipKeys | Sort-Object -Unique).Count -eq 7) 'relationship identities are unique'
    Require (@($relationships.Body.items | Where-Object { $_.resolutionStatus -eq 'EXACT_LINE_UNIQUE' }).Count -eq 3) 'relationship data includes exact line matches'
    Require (@($relationships.Body.items | Where-Object { $_.resolutionStatus -eq 'AMBIGUOUS' -and $_.candidateCount -eq 2 }).Count -eq 1) 'relationship data includes a two-candidate ambiguity'
    Require (@($relationships.Body.items | Where-Object { $_.resolutionStatus -eq 'UNRESOLVED' -and $_.candidateCount -eq 0 }).Count -eq 1) 'relationship data includes an unresolved line'
    Require (@($relationships.Body.items | Where-Object { $_.resolutionStatus -eq 'EXACT_LINE_UNIQUE' -and [string]::IsNullOrWhiteSpace($_.actionableWorkOrderNumber) }).Count -eq 0) 'every exact relationship has an actionable work order'
    Require (@($relationships.Body.items | Where-Object { $_.resolutionStatus -ne 'EXACT_LINE_UNIQUE' -and -not [string]::IsNullOrWhiteSpace($_.actionableWorkOrderNumber) }).Count -eq 0) 'non-exact relationships never become actionable'

    Select-Persona $session 'operations-manager'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=1' $null).Status -eq 200) 'Operations Manager can read synthetic sales orders'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-order-work-order-relationships?pageSize=1' $null).Status -eq 200) 'Operations Manager can read relationships'
    Select-Persona $session 'read-only-viewer'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=1' $null).Status -eq 200) 'Read-Only Viewer can use the canonical sales read contract'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/work-orders?pageSize=1' $null).Status -eq 200) 'Read-Only Viewer can use the canonical work-order read contract'
    Select-Persona $session 'no-access'
    $deniedSales = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=1' $null
    $deniedWork = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/work-orders?pageSize=1' $null
    Require ($deniedSales.Status -eq 403 -and $deniedSales.Body.requiredPermission -eq 'kitting.view') 'No-Access User is denied sales-order reads server-side'
    Require ($deniedWork.Status -eq 403 -and $deniedWork.Body.requiredPermission -eq 'work_orders.view') 'No-Access User is denied work-order reads server-side'

    Select-Persona $session 'administrator'
    $beforeWrite = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=1&pageSize=200' $null
    $writeAttempt = Invoke-SimHttp $session 'POST' '/api/platform/live/v1/sales-orders' @{ salesOrderNumber = '9999999' }
    $afterWrite = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=1&pageSize=200' $null
    Require ($writeAttempt.Status -eq 501 -and $writeAttempt.Body.code -eq 'DLE_OS_SIM_BUSINESS_CONTRACT_UNAVAILABLE') 'business mutation is unavailable even to the SIM Administrator'
    Require (($beforeWrite.Body.items | ConvertTo-Json -Compress -Depth 20) -eq ($afterWrite.Body.items | ConvertTo-Json -Compress -Depth 20)) 'failed mutation leaves the synthetic baseline unchanged'

    $baselineSales = $beforeWrite.Body.items | ConvertTo-Json -Compress -Depth 20
    $baselineRelationships = $relationships.Body.items | ConvertTo-Json -Compress -Depth 20
    $generationBefore = [long]$beforeWrite.Body.generation
    Select-Persona $session 'operations-manager'
    $reset = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{ confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString() }
    Require ($reset.Status -eq 200 -and $reset.Body.generation -eq ($generationBefore + 1)) 'reset advances the generation while rebuilding SQLite'
    $identityAfterReset = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    Require ($identityAfterReset.Body.personaId -eq 'administrator') 'reset clears persona sessions to SIM Administrator'
    $salesAfterReset = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?page=1&pageSize=200' $null
    $relationshipsAfterReset = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=200' $null
    Require (($salesAfterReset.Body.items | ConvertTo-Json -Compress -Depth 20) -eq $baselineSales) 'reset reconstructs the exact sales-order baseline'
    Require (($relationshipsAfterReset.Body.items | ConvertTo-Json -Compress -Depth 20) -eq $baselineRelationships) 'reset reconstructs the exact relationship baseline'
    Require ($salesAfterReset.Body.generation -eq $reset.Body.generation) 'rebuilt reads expose the new reset generation'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit()
    }
}

Require ($hostProcess.HasExited) 'Operations Center qualification host stops cleanly'

Write-Host "PASS: $($checks.Count) DLE-OS SIM Operations Center checks."
$checks | ForEach-Object { Write-Host "  - $_" }
