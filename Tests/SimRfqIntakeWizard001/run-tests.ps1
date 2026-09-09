[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$testPort = 5188
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\rfq-intake-qualification'
$stdout = Join-Path $testRoot 'host.stdout.log'
$stderr = Join-Path $testRoot 'host.stderr.log'
$buildRoot = Join-Path $testRoot 'build'
$runtimeMetadataPath = Join-Path $repository '.sim-state\runtime\runtime.json'
$savedRuntimeMetadata = if (Test-Path $runtimeMetadataPath) { [IO.File]::ReadAllText($runtimeMetadataPath) } else { $null }
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function Invoke-SimHttp([Microsoft.PowerShell.Commands.WebRequestSession] $Session,
    [string] $Method, [string] $Path, [object] $Body) {
    $parameters = @{ Uri = $baseUri + $Path; Method = $Method; WebSession = $Session;
        UseBasicParsing = $true; TimeoutSec = 5; ErrorAction = 'Stop' }
    if ($null -ne $Body) { $parameters.ContentType = 'application/json'; $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 12 }
    try { $response = Invoke-WebRequest @parameters; return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $response.Content | ConvertFrom-Json } }
    catch { return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Body = ([string]$_.ErrorDetails.Message | ConvertFrom-Json) } }
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet -p:UseAppHost=false `
    -p:OutputPath="$buildRoot\bin\"
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM host build failed.' }
$checks.Add('SIM host builds with RFQ Intake')
& node (Join-Path $PSScriptRoot 'run-ui-contract-tests.mjs')
if ($LASTEXITCODE -ne 0) { throw 'FAIL: Intake Wizard UI contract failed.' }
$checks.Add('guided UI contract passes')

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
    $customers = Invoke-SimHttp $session 'GET' '/api/platform/live/v1/customer-directory/search?q=Abbott&page=1&pageSize=25' $null
    Require ($customers.Status -eq 200 -and $customers.Body.items[0].customerName -eq 'Abbott' -and $customers.Body.items[0].synthetic) 'SIM directory resolves the Abbott qualification fixture'
    $correlation = [guid]::NewGuid().ToString()
    $payload = @{
        intakeType = 'NEW_QUOTE_REQUEST'
        customer = @{ customerId = 'SIM-CUSTOMER-ABBOTT'; customerNumber = '990100'; customerName = 'Abbott'; resolutionSource = 'sim-canonical-customer-directory' }
        assemblyCount = 1
        assemblies = @(@{ lineNumber = 1; assemblyNumber = 'B11283-17'; revision = 'B'; quantity = 25 })
        deLeonScope = 'MATERIAL_AND_LABOR'
        technicalFilesProvided = $true
        technicalFiles = @(@{ name = 'B11283-17_rev_B.pdf'; size = 1024; type = 'application/pdf'; lastModified = 0 })
        customerRequirements = @('PRICE', 'LEAD_TIME')
        createdBy = 'Ray'
        requestCorrelationId = $correlation
    }
    $created = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    Require ($created.Status -eq 201 -and $created.Body.record.status -eq 'READY_FOR_RFQ_QUALIFICATION') 'Abbott intake reaches the RFQ Qualification handoff'
    $record = $created.Body.record
    Require ($record.customer.customerName -eq 'Abbott' -and $record.assemblies[0].assemblyNumber -eq 'B11283-17' -and $record.assemblies[0].revision -eq 'B' -and $record.assemblies[0].quantity -eq 25) 'customer, assembly, revision, and quantity persist'
    Require ($record.deLeonScope -eq 'MATERIAL_AND_LABOR' -and $record.technicalFilesProvided -and $record.customerRequirements -contains 'LEAD_TIME') 'scope, technical files, and lead time persist'
    $read = Invoke-SimHttp $session 'GET' ("/api/sim/rfq-intakes/" + $record.intakeId) $null
    Require ($read.Status -eq 200 -and $read.Body.intakeId -eq $record.intakeId) 'persisted intake reads back by identity'
    $duplicate = Invoke-SimHttp $session 'POST' '/api/sim/rfq-intakes' $payload
    Require ($duplicate.Status -eq 201 -and $duplicate.Body.duplicate) 'correlation retry is idempotent'
    $dataset = Join-Path $repository '.sim-state\data\rfq-intakes.json'
    Require (Test-Path $dataset) 'structured intake dataset is stored under ignored SIM state'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id -Force; $hostProcess.WaitForExit() }
    if ($null -ne $savedRuntimeMetadata) { [IO.File]::WriteAllText($runtimeMetadataPath, $savedRuntimeMetadata) }
}

Write-Host "PASS: $($checks.Count) DLE-OS SIM RFQ Intake checks."
$checks | ForEach-Object { Write-Host "  - $_" }
