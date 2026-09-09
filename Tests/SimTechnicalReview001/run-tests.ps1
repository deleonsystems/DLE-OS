[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$testPort = 5191
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\technical-review-qualification'
$stdout = Join-Path $testRoot 'host.stdout.log'
$stderr = Join-Path $testRoot 'host.stderr.log'
$buildRoot = Join-Path $testRoot 'build'
$datasetPath = Join-Path $repository '.sim-state\data\rfq-intakes.json'
$datasetBackup = Join-Path $testRoot 'rfq-intakes.before-test.json'
$runtimeMetadataPath = Join-Path $repository '.sim-state\runtime\runtime.json'
$savedRuntimeMetadata = if (Test-Path $runtimeMetadataPath) { [IO.File]::ReadAllText($runtimeMetadataPath) } else { $null }
$datasetExisted = Test-Path $datasetPath
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function Invoke-SimHttp([Microsoft.PowerShell.Commands.WebRequestSession] $Session,
    [string] $Method, [string] $Path, [object] $Body) {
    $parameters = @{ Uri = $baseUri + $Path; Method = $Method; WebSession = $Session;
        UseBasicParsing = $true; TimeoutSec = 5; ErrorAction = 'Stop' }
    if ($null -ne $Body) { $parameters.ContentType = 'application/json'; $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 16 }
    try { $response = Invoke-WebRequest @parameters; return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $response.Content | ConvertFrom-Json } }
    catch { return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Body = ([string]$_.ErrorDetails.Message | ConvertFrom-Json) } }
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
if ($datasetExisted) { Copy-Item -LiteralPath $datasetPath -Destination $datasetBackup -Force }
& dotnet build $project --nologo --verbosity quiet -p:UseAppHost=false -p:OutputPath="$buildRoot\bin\"
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM host build failed.' }
$checks.Add('SIM host builds with Technical Review persistence')
& node (Join-Path $PSScriptRoot 'run-ui-contract-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'FAIL: Technical Review UI contract failed.' }
$checks.Add('Technical Review UI contracts pass')

$existing = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existing) 'qualification port is free'
$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $buildRoot 'bin\DleOs.SimHost.dll'
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        try { if ((Invoke-RestMethod "$baseUri/api/sim/status" -TimeoutSec 1).status -eq 'READY') { $ready = $true; break } }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM starts and reports READY'
    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $payload = @{
        intakeType = 'NEW_QUOTE_REQUEST'
        customer = @{ customerId = 'SIM-CUSTOMER-ABBOTT'; customerNumber = '990100'; customerName = 'Abbott'; resolutionSource = 'sim-canonical-customer-directory' }
        assemblyCount = 1
        assemblies = @(@{ lineNumber = 1; assemblyNumber = 'B11283-17'; revision = 'B'; quantity = 25 })
        deLeonScope = 'MATERIAL_AND_LABOR'
        technicalFilesProvided = $true
        technicalFiles = @(
            @{ name = 'B11283-17_Assembly_Drawing_Rev_B.pdf'; size = 1024; type = 'application/pdf'; lastModified = 1 },
            @{ name = 'B11283-17_BOM_Rev_B.xlsx'; size = 2048; type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; lastModified = 2 },
            @{ name = 'B11283-17_Gerbers_Rev_B.zip'; size = 4096; type = 'application/zip'; lastModified = 3 },
            @{ name = 'B11283-17_Subassembly_Spec.pdf'; size = 768; type = 'application/pdf'; lastModified = 4 }
        )
        customerRequirements = @('PRICE', 'LEAD_TIME')
        createdBy = 'SIM Intake User'
        requestCorrelationId = [guid]::NewGuid().ToString()
    }
    $created = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    Require ($created.Status -eq 201 -and $created.Body.record.handoffTarget -eq 'Technical Review') 'Intake submits to Technical Review without starting review'
    $intakeId = $created.Body.record.intakeId
    $queue = Invoke-SimHttp $session 'GET' '/api/sim/technical-reviews' $null
    $queued = $queue.Body.items | Where-Object intakeId -EQ $intakeId
    Require ($queue.Status -eq 200 -and $queued.reviewTypeLabel -eq 'RFQ Review' -and $queued.reviewStatusLabel -eq 'Needs Technical Review') 'Abbott appears in the queue as RFQ Review needing Technical Review'
    Require ($queued.customer.customerName -eq 'Abbott' -and $queued.assembly.assemblyNumber -eq 'B11283-17' -and $queued.assembly.revision -eq 'B' -and $queued.assembly.quantity -eq 25) 'queue preserves Abbott assembly identity and quantity'
    Require ($queued.documentPreservationState -eq 'METADATA_PRESERVED_SOURCE_PLACEMENT_REQUIRED') 'queue remains truthful about metadata-only document preservation'
    $detail = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$intakeId" $null
    Require ($detail.Status -eq 200 -and $detail.Body.record.deLeonScope -eq 'MATERIAL_AND_LABOR') 'review detail opens the persisted Intake record'

    $missingGerbers = @{
        assemblyType = 'PCB_ASSEMBLY'; assemblyDrawingFile = 'B11283-17_Assembly_Drawing_Rev_B.pdf'; bomFile = 'B11283-17_BOM_Rev_B.xlsx'
        gerbersRequired = $true; gerberFiles = @(); subAssemblyDocuments = @(); materialResponsibility = 'FULL_TURNKEY'
        customerSuppliedItems = @(); technicalPackageSufficient = $true; disposition = 'QUALIFIED_READY_FOR_RFQ'; reviewerNotes = ''
    }
    $blocked = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" $missingGerbers
    Require ($blocked.Status -eq 400) 'missing required Gerbers prevent full-turnkey PCB qualification'

    $hybridWithoutBoundary = $missingGerbers.Clone()
    $hybridWithoutBoundary.materialResponsibility = 'HYBRID'
    $hybridWithoutBoundary.gerbersRequired = $false
    $hybridWithoutBoundary.disposition = 'NEEDS_CUSTOMER_CLARIFICATION'
    $boundaryRequired = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" $hybridWithoutBoundary
    Require ($boundaryRequired.Status -eq 400) 'hybrid review requires an explicit customer-supplied responsibility boundary'

    $hybridQualified = $hybridWithoutBoundary.Clone()
    $hybridQualified.customerSuppliedItems = @('Customer supplies programmed controller U14')
    $hybridQualified.technicalPackageSufficient = $true
    $hybridQualified.disposition = 'QUALIFIED_READY_FOR_RFQ'
    $hybridSaved = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" $hybridQualified
    Require ($hybridSaved.Status -eq 200 -and $hybridSaved.Body.record.technicalReview.materialResponsibility -eq 'HYBRID' -and $hybridSaved.Body.record.technicalReview.customerSuppliedItems[0] -like '*U14') 'hybrid qualification persists the customer-supplied responsibility boundary'

    $qualified = $missingGerbers.Clone()
    $qualified.gerberFiles = @('B11283-17_Gerbers_Rev_B.zip')
    $qualified.subAssemblyDocuments = @('B11283-17_Subassembly_Spec.pdf')
    $qualified.reviewerNotes = 'Assembly drawing, BOM, and required Gerbers identified from source package metadata.'
    $saved = Invoke-SimHttp $session 'PUT' "/api/sim/technical-reviews/$intakeId/disposition" $qualified
    Require ($saved.Status -eq 200 -and $saved.Body.record.status -eq 'READY_FOR_RFQ_WORKING_QUEUE') 'qualified review persists the future RFQs working-queue state'
    Require ($saved.Body.record.technicalReview.assemblyType -eq 'PCB_ASSEMBLY' -and $saved.Body.record.technicalReview.assemblyDrawingFile -like '*Assembly_Drawing*' -and $saved.Body.record.technicalReview.bomFile -like '*BOM*') 'PCB type and governing Drawing/BOM persist'
    Require ($saved.Body.record.technicalReview.gerberFiles[0] -like '*Gerbers*' -and $saved.Body.record.technicalReview.subAssemblyDocuments[0] -like '*Subassembly*') 'Gerber and sub-assembly document associations persist'
    Require ($saved.Body.record.technicalReview.downstreamHandoffTarget -eq 'RFQs' -and $saved.Body.record.technicalReview.downstreamHandoffState -eq 'READY_FOR_RFQ_WORKING_QUEUE') 'successful review records only the future RFQs handoff'
    $readBack = Invoke-SimHttp $session 'GET' "/api/sim/technical-reviews/$intakeId" $null
    Require ($readBack.Status -eq 200 -and $readBack.Body.record.status -eq 'READY_FOR_RFQ_WORKING_QUEUE') 'persisted disposition reads back in the qualified RFQ handoff state'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id -Force; $hostProcess.WaitForExit() }
    if ($datasetExisted) { Copy-Item -LiteralPath $datasetBackup -Destination $datasetPath -Force }
    elseif (Test-Path $datasetPath) { Remove-Item -LiteralPath $datasetPath -Force }
    if ($null -ne $savedRuntimeMetadata) { [IO.File]::WriteAllText($runtimeMetadataPath, $savedRuntimeMetadata) }
}

Write-Host "PASS: $($checks.Count) DLE-OS SIM Technical Review checks."
$checks | ForEach-Object { Write-Host "  - $_" }
