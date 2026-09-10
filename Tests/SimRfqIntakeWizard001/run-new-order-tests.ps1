[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$testPort = 5191
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\new-order-qualification'
$dataPath = Join-Path $repository '.sim-state\data\rfq-intakes.json'
$runtimeMetadataPath = Join-Path $repository '.sim-state\runtime\runtime.json'
$savedData = if (Test-Path $dataPath) { [IO.File]::ReadAllBytes($dataPath) } else { $null }
$savedRuntimeMetadata = if (Test-Path $runtimeMetadataPath) { [IO.File]::ReadAllBytes($runtimeMetadataPath) } else { $null }
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function Invoke-SimHttp([Microsoft.PowerShell.Commands.WebRequestSession] $Session,
    [string] $Method, [string] $Path, [object] $Body) {
    $parameters = @{ Uri = $baseUri + $Path; Method = $Method; WebSession = $Session;
        UseBasicParsing = $true; TimeoutSec = 5; ErrorAction = 'Stop' }
    if ($null -ne $Body) { $parameters.ContentType = 'application/json'; $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 15 }
    try { $response = Invoke-WebRequest @parameters; return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $response.Content | ConvertFrom-Json } }
    catch { return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Body = ([string]$_.ErrorDetails.Message | ConvertFrom-Json) } }
}

function New-OrderPayload {
    param([hashtable] $Overrides = @{})
    $review = @{
        customerPoNumber = 'PO-SIM-1001'; customerPoType = 'CUSTOMER_PO'; paymentTermsMatch = $false;
        paymentTermsActionNote = 'A/R review recorded'; billingMatchesShipTo = $false;
        shippingActionNote = 'Ship To verified and highlighted'; shippingMethod = 'UPS_COLLECT'; upsAccountNumber = 'SIM-UPS-100';
        orderClassification = 'NEW_REVISION'; deliveryDateAchievable = $false;
        deliveryDateActionNote = 'Customer discussion required'; priceMatchesQuote = $false;
        priceActionNote = 'Quote review required'; traceabilityRequired = $true;
        traceabilityDeliverables = @('TRAVELER','MATERIAL_CERTS');
        aerospaceRequirements = @('CERTIFICATE_OF_CONFORMANCE','MATERIAL_CERTS','FAIR','ITAR','DPAS_RATED');
        poFlowdowns = 'QF-7.2.2.3 SIM flowdown'; additionalContractQualityRequirements = 'SIM quality requirement';
        specialRequirements = 'SIM special requirement'; requirementsIdentifiedOnAttachedDocument = $true
    }
    $payload = @{
        intakeType = 'NEW_ORDER'
        customer = @{ customerId = 'SIM-CUSTOMER-ABBOTT'; customerNumber = '990100'; customerName = 'Abbott'; resolutionSource = 'sim-canonical-customer-directory' }
        assemblyCount = 0; assemblies = @(); deLeonScope = ''; technicalFilesProvided = $true
        technicalFiles = @(@{ name = 'customer-po-sim.pdf'; size = 1024; type = 'application/pdf'; lastModified = 0 })
        customerRequirements = @(); createdBy = 'Untrusted Client Value'; requestCorrelationId = [guid]::NewGuid().ToString()
        contractReview = $review
    }
    foreach ($key in $Overrides.Keys) {
        if ($key.StartsWith('contractReview.')) { $review[$key.Substring(15)] = $Overrides[$key] }
        else { $payload[$key] = $Overrides[$key] }
    }
    return $payload
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& node (Join-Path $PSScriptRoot 'run-new-order-ui-contract-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'FAIL: New Order UI contract failed.' }
$checks.Add('New Order UI contract passes')
& dotnet build $project --nologo --verbosity quiet -p:UseAppHost=false -p:OutputPath="$testRoot\build\"
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM host build failed.' }
$checks.Add('SIM host builds with New Order Contract Review')

$existing = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existing) 'qualification port is free'
$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $testRoot 'build\DleOs.SimHost.dll'
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput (Join-Path $testRoot 'host.stdout.log') -RedirectStandardError (Join-Path $testRoot 'host.stderr.log') -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        try { if ((Invoke-RestMethod "$baseUri/api/sim/status" -TimeoutSec 1).status -eq 'READY') { $ready = $true; break } }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'isolated SIM starts and reports READY'
    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()

    $valid = New-OrderPayload
    $created = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $valid
    Require ($created.Status -eq 201 -and $created.Body.record.intakeType -eq 'NEW_ORDER') 'New Order submits through the existing Intake endpoint'
    Require ($created.Body.record.contractReview.customerPoNumber -eq 'PO-SIM-1001' -and $created.Body.record.contractReview.customerPoType -eq 'CUSTOMER_PO') 'customer PO identity persists'
    Require ($created.Body.record.contractReview.reviewedBy -eq 'SIM Administrator' -and $created.Body.record.contractReview.reviewDate) 'reviewer identity and date are server-derived'
    Require ($created.Body.record.contractReview.aerospaceRequirements.Count -eq 5 -and $created.Body.record.contractReview.traceabilityDeliverables.Count -eq 2) 'multi-select contract requirements persist'
    Require ($created.Body.record.contractReview.paymentTermsActionNote -and $created.Body.record.contractReview.shippingActionNote -and $created.Body.record.contractReview.deliveryDateActionNote -and $created.Body.record.contractReview.priceActionNote) 'all triggered action notes persist'
    $queue = Invoke-SimHttp $session 'GET' '/api/sim/technical-reviews' $null
    $queuedOrder = @($queue.Body.items | Where-Object intakeId -eq $created.Body.record.intakeId)[0]
    Require ($queue.Status -eq 200 -and $queuedOrder.reviewType -eq 'CONTRACT_REVIEW' -and $queuedOrder.reviewTypeLabel -eq 'New Order Contract Review') 'New Order reaches Technical Review with an explicit Contract Review identity'
    $read = Invoke-SimHttp $session 'GET' ("/api/sim/rfq-intakes/" + $created.Body.record.intakeId) $null
    Require ($read.Status -eq 200 -and $read.Body.contractReview.poFlowdowns -eq 'QF-7.2.2.3 SIM flowdown') 'completed Contract Review reads back accurately'

    foreach ($case in @(
        @{ Name='customer PO attachment required'; Override=@{ technicalFiles=@() }; Code='DLE_OS_SIM_NEW_ORDER_CUSTOMER_PO_REQUIRED' },
        @{ Name='Verbal PO rejected'; Override=@{ 'contractReview.customerPoType'='VERBAL_PO' }; Code='DLE_OS_SIM_NEW_ORDER_CUSTOMER_PO_REQUIRED' },
        @{ Name='UPS Collect account required'; Override=@{ 'contractReview.upsAccountNumber'='' }; Code='DLE_OS_SIM_NEW_ORDER_UPS_ACCOUNT_REQUIRED' },
        @{ Name='payment mismatch note required'; Override=@{ 'contractReview.paymentTermsActionNote'='' }; Code='DLE_OS_SIM_NEW_ORDER_PAYMENT_NOTE_REQUIRED' },
        @{ Name='Ship To action note required'; Override=@{ 'contractReview.shippingActionNote'='' }; Code='DLE_OS_SIM_NEW_ORDER_SHIPPING_NOTE_REQUIRED' },
        @{ Name='delivery-date action note required'; Override=@{ 'contractReview.deliveryDateActionNote'='' }; Code='DLE_OS_SIM_NEW_ORDER_DELIVERY_NOTE_REQUIRED' },
        @{ Name='price action note required'; Override=@{ 'contractReview.priceActionNote'='' }; Code='DLE_OS_SIM_NEW_ORDER_PRICE_NOTE_REQUIRED' }
    )) {
        $result = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' (New-OrderPayload $case.Override)
        Require ($result.Status -eq 400 -and $result.Body.code -eq $case.Code) $case.Name
    }

    $hidden = New-OrderPayload @{
        'contractReview.paymentTermsMatch'=$true; 'contractReview.paymentTermsActionNote'='';
        'contractReview.billingMatchesShipTo'=$true; 'contractReview.shippingActionNote'='';
        'contractReview.shippingMethod'='UPS_CHARGE'; 'contractReview.upsAccountNumber'='';
        'contractReview.deliveryDateAchievable'=$true; 'contractReview.deliveryDateActionNote'='';
        'contractReview.priceMatchesQuote'=$true; 'contractReview.priceActionNote'='';
        'contractReview.traceabilityRequired'=$false; 'contractReview.traceabilityDeliverables'=@()
    }
    $hiddenResult = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $hidden
    Require ($hiddenResult.Status -eq 201) 'hidden conditional fields do not block submission'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id -Force; $hostProcess.WaitForExit() }
    if ($null -eq $savedData) { Remove-Item -LiteralPath $dataPath -Force -ErrorAction SilentlyContinue }
    else { [IO.File]::WriteAllBytes($dataPath, $savedData) }
    if ($null -ne $savedRuntimeMetadata) { [IO.File]::WriteAllBytes($runtimeMetadataPath, $savedRuntimeMetadata) }
}

Write-Host "PASS: $($checks.Count) DLE-OS SIM New Order Intake checks."
$checks | ForEach-Object { Write-Host "  - $_" }
