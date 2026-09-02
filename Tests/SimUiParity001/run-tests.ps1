[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$renderer = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimShellRenderer.cs'
$program = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\Program.cs'
$client = Join-Path $repository 'SRC\api\dle-api-client.js'
$systemCenter = Join-Path $repository 'SRC\modules\system-center\system-center.js'
$shell = Join-Path $repository 'DLE_Work_Center_v4.0.0.html'
$testPort = 5198
$testRoot = Join-Path $repository '.sim-state\ui-parity-qualification'
$stdout = Join-Path $testRoot 'host.stdout.log'
$stderr = Join-Path $testRoot 'host.stderr.log'
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if ($Condition -is [Array]) { throw "FAIL: non-Boolean test result for $Message" }
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function Read-Text([string] $Path) {
    return [IO.File]::ReadAllText($Path)
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM UI parity build failed.' }
$checks.Add('SIM UI parity host builds')

$rendererText = Read-Text $renderer
$programText = Read-Text $program
$clientText = Read-Text $client
$systemCenterText = Read-Text $systemCenter
$shellText = Read-Text $shell

Require ($rendererText -match 'DLE-OS SIM' -and $rendererText -match 'SYNTHETIC DATA') 'SIM identity remains explicit and restrained'
Require ($rendererText -match 'dleSimWorkspaceToggle' -and $rendererText -match 'workspace-selector') 'shared workspace selector is exposed through SIM navigation'
Require ($rendererText -match '#invoiceHistorySyncButton' -and $rendererText -match '#syncOperationsButton') 'governed synchronization actions are suppressed in SIM'
Require ($rendererText -match 'refresh-center-force-button' -and $rendererText -match 'dailyOperationsSyncRunButton') 'governed refresh execution actions are suppressed in SIM'
Require ($clientText -match 'if \(IS_SIM_RUNTIME\) throw apiError') 'SIM does not probe project JSON after an unsupported API response'
Require ($systemCenterText -match 'scheduleOperationsRefreshPoll\(!IS_SIM_RUNTIME\)') 'System Center stops unavailable refresh polling in SIM'
Require ($programText -match 'DLE_OS_SIM_BUSINESS_CONTRACT_UNAVAILABLE') 'unsupported contracts use a phase-neutral structured SIM error'
Require ($shellText -match 'SRC/shell/workspace-registry.js' -and $shellText -match 'SRC/shell/workspace-shell.js') 'existing shared workspace shell remains authoritative'
Require (-not (Test-Path (Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DLE_Work_Center_v4.0.0.html'))) 'no copied SIM shell exists'

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'UI parity qualification port is free before startup'

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
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:$testPort/api/sim/status" -TimeoutSec 1
            $ready = $status.status -eq 'READY'
            if ($ready) { break }
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM starts for UI parity qualification'

    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$testPort/" -TimeoutSec 5
    Require ($response.Content -match 'id="dle-sim-parity-script"') 'rendered shared shell contains the SIM parity bootstrap'
    Require ($response.Content -match 'id="workspaceViewSelect"') 'rendered shared shell retains the original workspace selector'
    $registry = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$testPort/SRC/shell/workspace-registry.js" -TimeoutSec 5
    Require ($registry.Content -match 'SRC/modules/invoice-history/invoice-history.js') 'Invoice History shared module remains registered'
    Require ($response.Content -match 'SRC/modules/shipping/shipping-workspace.js') 'Shipping shared module remains registered'
    Require ($response.Content -match 'SRC/modules/sales-order-dashboard/sales-order-dashboard.js') 'Sales Order Dashboard shared module remains registered'
    Require ($response.Content -match 'SRC/modules/work-order-dashboard/work-order-dashboard.js') 'Work Order Dashboard shared module remains registered'
    Require ($response.Content -match 'SRC/modules/system-center/system-center.js') 'System Center shared module remains registered'

    foreach ($path in @(
        'SRC/modules/invoice-history/invoice-history.html',
        'SRC/workspaces/purchasing/purchasing-workspace.html',
        'SRC/workspaces/kitting/kitting-workspace.html',
        'SRC/workspaces/production/production-workspace.html',
        'SRC/modules/shipping/shipping-workspace.html',
        'SRC/modules/work-order-dashboard/work-order-dashboard.html',
        'SRC/modules/system-center/system-center.html'
    )) {
        $asset = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$testPort/$path" -TimeoutSec 5
        Require ($asset.StatusCode -eq 200 -and $asset.Content.Length -gt 0) "shared workspace asset loads: $path"
    }

    try {
        Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$testPort/api/platform/live/v1/readiness" -TimeoutSec 5 -ErrorAction Stop | Out-Null
        $unsupportedStatus = 200
        $unsupportedBody = ''
    }
    catch {
        $unsupportedStatus = [int]$_.Exception.Response.StatusCode
        $unsupportedBody = [string]$_.ErrorDetails.Message
    }
    Require ($unsupportedStatus -eq 501) 'unsupported workspace data remains a local HTTP 501'
    Require ($unsupportedBody -match 'DLE_OS_SIM_BUSINESS_CONTRACT_UNAVAILABLE') 'unsupported workspace response is explicit and structured'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit()
    }
}

Require ($hostProcess.HasExited) 'UI parity qualification host stops cleanly'

Write-Host "PASS: $($checks.Count) DLE-OS SIM UI parity checks."
$checks | ForEach-Object { Write-Host "  - $_" }
