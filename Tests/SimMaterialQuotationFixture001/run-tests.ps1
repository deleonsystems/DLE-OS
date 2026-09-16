[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../Tools/SimRuntime/Invoke-DleOsSimTestIsolation.ps1')
if (Invoke-DleOsSimTestIsolation -ScriptPath $PSCommandPath -Parameters $PSBoundParameters) { return }
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$fixture = Join-Path $repository 'Tools\SimRuntime\Scenarios\material-quotation.ui-fixture.v1.json'
$testRoot = Join-Path $repository '.sim-state\material-quotation-fixture-qualification'
$buildRoot = Join-Path $testRoot 'build'
$port = 5194
$baseUri = "http://127.0.0.1:$port"
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

Require (Test-Path -LiteralPath $fixture) 'tracked Material Quotation fixture exists'
$definition = Get-Content -LiteralPath $fixture -Raw | ConvertFrom-Json
Require ($definition.schema -eq 'DLE_MATERIAL_QUOTATION_UI_FIXTURE_V1' -and $definition.intakeId -eq 'RFQI-SIM-0040') 'fixture identity is deterministic'
Require (@($definition.rows).Count -eq 8) 'fixture contains eight visually varied BOM rows'
Require (@($definition.rows | Where-Object componentType -eq 'SUBASSEMBLY').Count -eq 1 -and @($definition.rows | Where-Object componentType -eq 'REFERENCE_ONLY').Count -eq 1) 'fixture covers subassembly and reference-only presentation'

New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet -p:UseAppHost=false -p:OutputPath="$buildRoot\"
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM host build failed.' }
$checks.Add('SIM host builds with Material Quotation fixture')

$existing = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
Require ($null -eq $existing) 'qualification port is free'
$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$port
    $hostProcess = Start-Process dotnet -ArgumentList @((Join-Path $buildRoot 'DleOs.SimHost.dll')) -WorkingDirectory $repository `
        -RedirectStandardOutput (Join-Path $testRoot 'host.stdout.log') -RedirectStandardError (Join-Path $testRoot 'host.stderr.log') -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { if ((Invoke-RestMethod "$baseUri/api/sim/status" -TimeoutSec 1).status -eq 'READY') { $ready = $true; break } }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'isolated SIM starts READY with fixture materialized'
    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $rfqs = Invoke-RestMethod "$baseUri/api/sim/rfqs" -WebSession $session -TimeoutSec 5
    $record = @($rfqs.items | Where-Object intakeId -eq 'RFQI-SIM-0040')
    Require ($record.Count -eq 1) 'RFQI-SIM-0040 exists exactly once in the RFQ queue'
    Require ($record[0].status -eq 'READY_TO_WORK') 'fixture is ready for shared quotation work'
    Require ($record[0].inputs.status -eq 'READY' -and $record[0].inputs.materialsTarget -eq 'QUOTATION_MATERIALS' -and $record[0].inputs.manufacturingTarget -eq 'QUOTATION_LABOR') 'quotation handoff targets are complete and explicit'
    Require ($record[0].inputs.materials.version -eq 1 -and @($record[0].inputs.materials.candidate.rows).Count -eq 8) 'accepted BOM version and rows are exposed'
    Require ($record[0].inputs.manufacturing.nothingMissing) 'completed manufacturing definition is exposed'
    $materials = Invoke-RestMethod "$baseUri/api/sim/rfqs/RFQI-SIM-0040/materials" -WebSession $session -TimeoutSec 5
    Require (@($materials.rows).Count -eq 8 -and $materials.plan.revision -eq 0) 'Material Quotation initializes eight empty quotation rows'
    Require ($materials.rows[0].requiredQuantity -eq 48) 'required quantity derives from BOM quantity per assembly and RFQ quantity'
    Require ($materials.rows[5].quote.customerSupplied -eq $false -and $materials.rows[7].required -eq $false) 'subassembly and reference-only rows render through the material contract'
    $registry = Get-Content (Join-Path $repository 'SRC\shell\workspace-registry.js') -Raw
    $rfqUi = Get-Content (Join-Path $repository 'SRC\workspaces\rfqs\rfqs-workspace.js') -Raw
    $materialsUi = Get-Content (Join-Path $repository 'SRC\workspaces\rfqs\materials-workbench.js') -Raw
    Require ($registry -match 'id: "rfqs"' -and $rfqUi -match 'data-open="materials"') 'normal Home RFQs workspace exposes the Materials action'
    Require ($materialsUi -match 'Material Quotation Workspace' -and $materialsUi -match '/materials') 'Material Quotation uses the supported RFQ materials API'
    $requestId = [guid]::NewGuid().ToString('D')
    $reset = Invoke-RestMethod "$baseUri/api/sim/reset" -Method Post -WebSession $session -ContentType 'application/json' `
        -Body (@{ confirmation = 'RESET SIM'; requestId = $requestId } | ConvertTo-Json -Compress) -TimeoutSec 10
    Require ($reset.succeeded) 'isolated SIM reset succeeds'
    $afterReset = Invoke-RestMethod "$baseUri/api/sim/rfqs" -WebSession ([Microsoft.PowerShell.Commands.WebRequestSession]::new()) -TimeoutSec 5
    $restored = @($afterReset.items | Where-Object intakeId -eq 'RFQI-SIM-0040')
    Require ($restored.Count -eq 1 -and @($restored[0].inputs.materials.candidate.rows).Count -eq 8) 'reset reconstructs the Material Quotation fixture'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id -Force; $hostProcess.WaitForExit() }
}

Write-Host "PASS: $($checks.Count) DLE-OS SIM Material Quotation fixture checks."
$checks | ForEach-Object { Write-Host "  - $_" }
