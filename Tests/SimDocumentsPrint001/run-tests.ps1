[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$documentSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimDocumentStore.cs'
$endpointSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimDocumentEndpoints.cs'
$programSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\Program.cs'
$dashboardSource = Join-Path $repository 'SRC\modules\work-order-dashboard\work-order-dashboard.js'
$fixture = Join-Path $repository 'Tools\SimRuntime\Scenarios\sim-wo-9700001-kit-summary.pdf'
$testPort = 5195
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\documents-print-qualification'
$stdout = Join-Path $testRoot 'host.stdout.log'
$stderr = Join-Path $testRoot 'host.stderr.log'
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if ($Condition -is [Array]) { throw "FAIL: non-Boolean test result for $Message" }
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function Get-ResponseContentType($Response) {
    if ($Response.Headers) { return [string]$Response.Headers['Content-Type'] }
    return [string]$Response.BaseResponse.Content.Headers.ContentType.MediaType
}

function Invoke-SimHttp {
    param([Microsoft.PowerShell.Commands.WebRequestSession] $Session,
        [string] $Method, [string] $Path, [object] $Body, [string] $OutFile = '')
    $parameters = @{ Uri = $baseUri + $Path; Method = $Method; WebSession = $Session;
        UseBasicParsing = $true; TimeoutSec = 5; ErrorAction = 'Stop' }
    if ($Body) { $parameters.ContentType = 'application/json'; $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 20 }
    if ($OutFile) { $parameters.OutFile = $OutFile; $parameters.PassThru = $true }
    try {
        $response = Invoke-WebRequest @parameters
        return [pscustomobject]@{ Status = [int]$response.StatusCode; ContentType = Get-ResponseContentType $response;
            Body = $(if ($OutFile -or [string]::IsNullOrWhiteSpace($response.Content)) { $null } else { $response.Content | ConvertFrom-Json }) }
    } catch {
        $response = $_.Exception.Response
        if ($null -eq $response) { throw }
        $text = [string]$_.ErrorDetails.Message
        return [pscustomobject]@{ Status = [int]$response.StatusCode; ContentType = Get-ResponseContentType $response;
            Body = $(if ([string]::IsNullOrWhiteSpace($text)) { $null } else { $text | ConvertFrom-Json }) }
    }
}

function Select-Persona($Session, [string] $PersonaId) {
    $result = Invoke-SimHttp $Session 'POST' '/api/sim/persona' @{ personaId = $PersonaId }
    Require ($result.Status -eq 200) "persona selection succeeds: $PersonaId"
}

function Reset-Sim($Session) {
    Invoke-SimHttp $Session 'POST' '/api/sim/reset' @{
        confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString()
    }
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: Phase 11 SIM build failed.' }
$checks.Add('Phase 11 SIM host builds')

$pathNode = Get-Command node -ErrorAction SilentlyContinue
$nodeCandidates = @(
    $(if ($pathNode) { $pathNode.Source }),
    $env:DLE_OS_SIM_NODE_PATH,
    'C:\Program Files\nodejs\node.exe'
) + @(Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Join-Path $_.FullName '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
})
$node = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Require (Test-Path $node) 'Node.js is available for shared Kit ID preview checks'
& $node (Join-Path $PSScriptRoot 'run-ui-contract-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'FAIL: shared Kit ID preview contracts failed.' }
$checks.Add('shared Kit ID label preview contracts remain green')

$documentText = [IO.File]::ReadAllText($documentSource)
$endpointText = [IO.File]::ReadAllText($endpointSource)
$programText = [IO.File]::ReadAllText($programSource)
$dashboardText = [IO.File]::ReadAllText($dashboardSource)
Require (Test-Path $fixture) 'tracked synthetic PDF fixture exists'
Require (([IO.File]::ReadAllBytes($fixture)[0..4] -join ',') -eq '37,80,68,70,45') 'tracked document has a PDF signature'
Require ($documentText -match 'ResolveStatePath' -and $documentText -match '"documents"' -and
    $documentText -match 'EnsureDescendant') 'runtime document path is confined beneath SIM state'
Require ($documentText -match 'SHA256.HashData' -and $documentText -match 'CopyFixtureAsync') 'document fixture copy is deterministic and integrity-addressed'
Require ($endpointText -match '/api/development/kitting-documents/v1/work-orders' -and $endpointText -match 'application/pdf') 'SIM preserves the current shared Kitted BOM contract'
Require ($endpointText -match 'persona.Can\("kitting.view"\)' -and $endpointText -match 'DLE_OS_PERMISSION_DENIED') 'document endpoint enforces existing Kitting permission'
Require ($programText -match 'simDocuments.RebuildAsync' -and $programText -match 'SimDocumentEndpoints.Map') 'document fixture participates in startup, reset, and routing'
Require ($dashboardText -match 'isSimKitIdLabelAvailable' -and $dashboardText -match 'printWorkOrderDashboardKittingKitIdLabel') 'Home-backed Kitting enables the existing shared Kit ID action in SIM'
Require ($dashboardText -notmatch 'sim-label\.js|sim-document-viewer\.js') 'no parallel SIM document or label UI exists'
Require ($endpointText -notmatch 'HttpClient|\\\\|DLE-OS-HOST|5054|5057') 'SIM document boundary has no external or DEV fallback'

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'Phase 11 qualification port is free before startup'
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
        try { $probe = Invoke-SimHttp $session 'GET' '/api/sim/status' $null; $ready = $probe.Status -eq 200; if ($ready) { break } }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM starts with local document fixture initialized'
    Require ((Reset-Sim $session).Status -eq 200) 'Phase 11 qualification starts from a reconstructed baseline'

    $evidence = Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700001' $null
    Require ($evidence.Status -eq 200 -and $evidence.Body.evidenceStatus -eq 'KIT_COMPLETE_EVIDENCE') 'WO 9700001 resolves Kit Complete evidence'
    Require ($evidence.Body.primaryDocument.synthetic -and $evidence.Body.primaryDocument.environment -eq 'SIM') 'resolved document is explicitly synthetic SIM evidence'
    Require ($evidence.Body.primaryDocument.folder -eq 'SIM-LOCAL/KIT-COMPLETE') 'document reports only its SIM-local folder label'
    Require ($evidence.Body.primaryDocument.openUrl -eq '/api/development/kitting-documents/v1/work-orders/9700001/documents/complete') 'document uses the unchanged shared open URL shape'
    Require ($evidence.Body.primaryDocument.sha256 -eq (Get-FileHash $fixture -Algorithm SHA256).Hash) 'runtime evidence hash matches the tracked fixture'

    $download = Join-Path $testRoot 'downloaded-kit-summary.pdf'
    $pdf = Invoke-SimHttp $session 'GET' $evidence.Body.primaryDocument.openUrl $null $download
    Require ($pdf.Status -eq 200 -and $pdf.ContentType -match 'application/pdf') "known synthetic document streams as a browser PDF (HTTP $($pdf.Status), $($pdf.ContentType))"
    Require ((Get-FileHash $download -Algorithm SHA256).Hash -eq (Get-FileHash $fixture -Algorithm SHA256).Hash) 'browser document bytes are deterministic'
    $pdfInfo = & pdfinfo $download 2>&1 | Out-String
    Require ($LASTEXITCODE -eq 0 -and $pdfInfo -match 'Pages:\s+1' -and $pdfInfo -match '612 x 792 pts') 'PDF is one unclipped letter-size preview page'

    $missing = Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700999' $null
    Require ($missing.Status -eq 200 -and $missing.Body.evidenceStatus -eq 'NO_KITTED_BOM_EVIDENCE' -and $null -eq $missing.Body.primaryDocument) 'missing Work Order document fails locally without fallback'
    $missingFile = Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700999/documents/complete' $null
    Require ($missingFile.Status -eq 404) 'missing document content returns local HTTP 404'
    $malformed = Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/not-a-work-order' $null
    Require ($malformed.Status -eq 400) 'malformed document reference returns HTTP 400'
    $badType = Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700001/documents/unknown' $null
    Require ($badType.Status -eq 400) 'unknown document type fails closed'

    Select-Persona $session 'kitting-operator'
    Require ((Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700001' $null).Status -eq 200) 'Kitting Operator can resolve the document'
    Select-Persona $session 'read-only-viewer'
    Require ((Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700001' $null).Status -eq 200) 'Read-Only Viewer retains current kitting.view access'
    Select-Persona $session 'no-access'
    $denied = Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700001' $null
    Require ($denied.Status -eq 403 -and $denied.Body.requiredPermission -eq 'kitting.view') 'No-Access User is denied document evidence'
    $deniedPdf = Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700001/documents/complete' $null
    Require ($deniedPdf.Status -eq 403) 'No-Access User is denied document bytes'

    Select-Persona $session 'administrator'
    $runtimeDocument = Join-Path $repository '.sim-state\documents\KIT-COMPLETE\9700001.pdf'
    $generatedSentinel = Join-Path $repository '.sim-state\generated\phase11-sentinel.txt'
    $tempSentinel = Join-Path $repository '.sim-state\temp\phase11-sentinel.txt'
    [IO.File]::WriteAllText($generatedSentinel, 'synthetic generated preview')
    [IO.File]::WriteAllText($tempSentinel, 'synthetic temp preview')
    [IO.File]::Delete($runtimeDocument)
    Require ((Invoke-SimHttp $session 'GET' '/api/development/kitting-documents/v1/work-orders/9700001/documents/complete' $null).Status -eq 404) 'missing runtime fixture has no source or network fallback during a request'
    $reset = Reset-Sim $session
    Require ($reset.Status -eq 200) 'reset succeeds after document preview activity'
    Require (-not (Test-Path $generatedSentinel) -and -not (Test-Path $tempSentinel)) 'reset clears generated and temp preview state'
    Require ((Test-Path $runtimeDocument) -and (Get-FileHash $runtimeDocument -Algorithm SHA256).Hash -eq (Get-FileHash $fixture -Algorithm SHA256).Hash) 'reset restores the exact baseline synthetic document'
    $status = Invoke-SimHttp $session 'GET' '/api/sim/status' $null
    Require ($status.Body.currentPersonaId -eq 'administrator' -and $status.Body.fault.faultId -eq 'none') 'reset restores administrator and no-fault state'
    $sales = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/sales-orders?pageSize=200' $null
    $invoices = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/invoice-history?pageSize=200' $null
    Require ($sales.Body.totalItems -eq 7 -and $invoices.Body.totalItems -eq 8) 'reset preserves Phase 6-10 business baselines'
    $history = Invoke-SimHttp $session 'GET' '/api/operations-center/v1/work-orders/9700001/verified-status-history' $null
    Require ($history.Body.records.Count -eq 1 -and $history.Body.records[0].statusText -eq 'Ready for production') 'reset preserves the Phase 9 status baseline'
} finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit(5000) | Out-Null
    }
}

$stderrText = if (Test-Path $stderr) { [IO.File]::ReadAllText($stderr).Trim() } else { '' }
Require ([string]::IsNullOrWhiteSpace($stderrText)) 'Phase 11 qualification host writes no stderr diagnostics'
Write-Output "PASS: $($checks.Count) DLE-OS SIM document/label/preview checks."
$checks | ForEach-Object { Write-Output "  - $_" }
