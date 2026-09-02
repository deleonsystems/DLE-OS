[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$optionsSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimRuntimeOptions.cs'
$stateSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimStateStore.cs'
$rendererSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimShellRenderer.cs'
$stateRoot = Join-Path $repository '.sim-state'
$metadataPath = Join-Path $stateRoot 'state\metadata.json'
$testRoot = Join-Path $stateRoot 'reset-qualification'
$testPort = 5196
$baseUri = "http://127.0.0.1:$testPort"
$checks = [Collections.Generic.List[string]]::new()
$hostProcess = $null
$hostSequence = 0
$outsideSentinel = Join-Path ([IO.Path]::GetTempPath()) ("dle-os-sim-reset-sentinel-" + [guid]::NewGuid().ToString('N'))

function Require($Condition, [string] $Message) {
    if ($Condition -is [Array]) { throw "FAIL: non-Boolean test result for $Message" }
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

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
        $text = $response.Content
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body = $(if ([string]::IsNullOrWhiteSpace($text)) { $null } else { $text | ConvertFrom-Json })
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

function Start-SimHost {
    $script:hostSequence++
    $stdout = Join-Path $testRoot "host-$script:hostSequence.stdout.log"
    $stderr = Join-Path $testRoot "host-$script:hostSequence.stderr.log"
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.dll'
    $script:hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($script:hostProcess.HasExited) { break }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$baseUri/api/sim/status" -TimeoutSec 1
            if ([int]$response.StatusCode -eq 200) { return }
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    throw "FAIL: SIM state qualification host did not start. See $stderr"
}

function Stop-SimHost {
    if ($null -ne $script:hostProcess -and -not $script:hostProcess.HasExited) {
        Stop-Process -Id $script:hostProcess.Id -Force
        $script:hostProcess.WaitForExit()
    }
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM state/reset build failed.' }
$checks.Add('SIM state/reset host builds')

$optionsText = [IO.File]::ReadAllText($optionsSource)
$stateText = [IO.File]::ReadAllText($stateSource)
$rendererText = [IO.File]::ReadAllText($rendererSource)
$gitignore = [IO.File]::ReadAllText((Join-Path $repository '.gitignore'))
Require ($gitignore -match '(?m)^/\.sim-state/\s*$') 'per-clone SIM state root is ignored by Git'
Require ($optionsText -match 'ResolveStatePath' -and $optionsText -match 'EnsureDescendant') 'state paths are resolved beneath the validated SIM root'
Require ($optionsText -match 'IsNetworkPath' -and $optionsText -match 'UNC or network') 'UNC and network state roots are rejected'
Require ($stateText -match 'SemaphoreSlim resetGate' -and $stateText -match 'WaitAsync\(0\)') 'concurrent resets fail closed'
Require ($stateText -match 'EnsureNoReparsePoints' -and $stateText -match 'FileAttributes.ReparsePoint') 'reset rejects reparse points inside disposable state'
Require ($stateText -match 'BaselineScenarioId = "baseline"' -and $stateText -match 'BaselineScenarioVersion = 5' -and $stateText -match 'CurrentStateVersion = 1') 'minimal versioned baseline scenario is defined'
Require ($stateText -match 'BaselineClock' -and $stateText -match 'NextDeterministicId') 'deterministic clock and ID foundation is explicit'
Require ($stateText -notmatch 'SqlConnection|LocalDB') 'state metadata remains independent of external database providers'
Require ($rendererText -notmatch 'localStorage\.clear\(' -and $rendererText -notmatch 'sessionStorage\.clear\(') 'browser reset never blanket-clears browser storage'
Require ($rendererText -match 'clearScopedBrowserState' -and $rendererText -match 'indexedDB\.deleteDatabase') 'shell implements scoped storage and IndexedDB cleanup'
Require ($rendererText -match 'Confirm reset' -and $rendererText -match "confirmation: 'RESET SIM'") 'SIM reset requires a deliberate two-step confirmation'

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'state/reset qualification port is free before startup'

try {
    [IO.File]::WriteAllText($outsideSentinel, 'must survive SIM reset')
    Start-SimHost
    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $initial = Invoke-SimHttp $session 'GET' '/api/sim/state' $null
    Require ($initial.Status -eq 200 -and $initial.Body.environment -eq 'SIM' -and $initial.Body.health -eq 'READY') 'SIM state endpoint reports a healthy SIM environment'
    Require ($initial.Body.scenarioId -eq 'baseline' -and $initial.Body.scenarioVersion -eq 5 -and $initial.Body.stateVersion -eq 1) 'baseline scenario and version metadata are stable'
    Require ([long]$initial.Body.generation -ge 1 -and [long]$initial.Body.browserResetGeneration -eq [long]$initial.Body.generation) 'initial generation and browser reset generation are valid'
    Require ([int]$initial.Body.deterministicSeed -eq 2405001 -and [long]$initial.Body.nextDeterministicId -eq 1 -and [long]$initial.Body.nextEventOrdinal -eq 0) 'baseline deterministic counters start predictably'
    foreach ($directory in @('runtime','state','data','documents','generated','logs','temp')) {
        Require (Test-Path (Join-Path $stateRoot $directory) -PathType Container) "state layout contains $directory"
    }
    $ignored = git -C $repository check-ignore '.sim-state/state/metadata.json'
    Require ($LASTEXITCODE -eq 0 -and $ignored -match '\.sim-state/state/metadata\.json') 'active state metadata is ignored runtime data'

    $selection = Invoke-SimHttp $session 'POST' '/api/sim/persona' @{ personaId = 'shipping-operator' }
    Require ($selection.Status -eq 200) 'persona can change before reset'
    New-Item -ItemType Directory -Path (Join-Path $stateRoot 'data\qualification') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $stateRoot 'data\qualification\ephemeral.txt'), 'discard me')

    $unconfirmed = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{ confirmation = 'reset'; requestId = [guid]::NewGuid().ToString() }
    Require ($unconfirmed.Status -eq 400 -and $unconfirmed.Body.code -eq 'DLE_OS_SIM_RESET_CONFIRMATION_REQUIRED') 'reset rejects an imprecise confirmation'

    $requestId = [guid]::NewGuid().ToString()
    $firstReset = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{ confirmation = 'RESET SIM'; requestId = $requestId }
    Require ($firstReset.Status -eq 200 -and $firstReset.Body.succeeded -and $firstReset.Body.reloadRequired) 'reset returns a structured successful result'
    Require ([long]$firstReset.Body.generation -eq ([long]$initial.Body.generation + 1)) 'first reset increments generation predictably'
    Require (-not (Test-Path (Join-Path $stateRoot 'data\qualification\ephemeral.txt'))) 'reset recreates SIM-owned data storage'
    Require (Test-Path $outsideSentinel -PathType Leaf) 'reset leaves a sentinel outside the SIM state root untouched'
    $afterResetUser = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    Require ($afterResetUser.Body.personaId -eq 'administrator') 'reset returns the current browser session to SIM Administrator'

    $replay = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{ confirmation = 'RESET SIM'; requestId = $requestId }
    Require ($replay.Status -eq 200 -and $replay.Body.replayed -and [long]$replay.Body.generation -eq [long]$firstReset.Body.generation) 'retrying the same reset request is idempotent'
    $secondReset = Invoke-SimHttp $session 'POST' '/api/sim/reset' @{ confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString() }
    Require ([long]$secondReset.Body.generation -eq ([long]$firstReset.Body.generation + 1)) 'a distinct repeated reset advances generation once'
    Require ($secondReset.Body.browserStorage.scope -eq 'CURRENT_SIM_ORIGIN_ONLY') 'reset declares current-origin browser cleanup scope'
    Require ($secondReset.Body.browserStorage.localStorageKeys -contains 'DLE_OS_OPERATIONS_PROJECTION_V1' -and $secondReset.Body.browserStorage.localStorageKeys -contains 'DLE_OS_SHIPMENT_HISTORY_V1') 'reset identifies repository-evidenced localStorage keys'
    Require ($secondReset.Body.browserStorage.sessionStoragePrefixes -contains 'dle-os:kitting-released-bom:return:') 'reset identifies the repository-evidenced sessionStorage namespace'
    Require ($secondReset.Body.browserStorage.indexedDbNames -contains 'DLE_OS_SHIPMENT_STAGING_HANDLES') 'reset identifies the repository-evidenced IndexedDB file-handle store'
    Stop-SimHost

    $generationBeforeMissingRecovery = [long]$secondReset.Body.generation
    Remove-Item -LiteralPath $metadataPath -Force
    Start-SimHost
    $missingRecovered = Invoke-SimHttp ([Microsoft.PowerShell.Commands.WebRequestSession]::new()) 'GET' '/api/sim/state' $null
    Require ($missingRecovered.Status -eq 200 -and [long]$missingRecovered.Body.generation -eq ($generationBeforeMissingRecovery + 1)) 'missing disposable metadata is recreated with a new generation'
    Stop-SimHost

    [IO.File]::WriteAllText($metadataPath, '{ invalid json')
    Start-SimHost
    $corruptSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $invalid = Invoke-SimHttp $corruptSession 'GET' '/api/sim/state' $null
    Require ($invalid.Status -eq 409 -and $invalid.Body.code -eq 'DLE_OS_SIM_STATE_INVALID' -and $invalid.Body.resetAvailable) 'invalid state fails clearly with reset recovery available'
    $blockedBusiness = Invoke-SimHttp $corruptSession 'GET' '/api/platform/live/v1/work-orders' $null
    Require ($blockedBusiness.Status -eq 503 -and $blockedBusiness.Body.resetAvailable) 'invalid state blocks business boundaries without external fallback'
    $repair = Invoke-SimHttp $corruptSession 'POST' '/api/sim/reset' @{ confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString() }
    Require ($repair.Status -eq 200 -and $repair.Body.scenarioId -eq 'baseline') 'reset safely rebuilds invalid state'
    Stop-SimHost

    $incompatible = Get-Content $metadataPath -Raw | ConvertFrom-Json
    $incompatible.stateVersion = 999
    [IO.File]::WriteAllText($metadataPath, ($incompatible | ConvertTo-Json -Depth 8))
    Start-SimHost
    $incompatibleSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $incompatibleStatus = Invoke-SimHttp $incompatibleSession 'GET' '/api/sim/state' $null
    Require ($incompatibleStatus.Status -eq 409 -and $incompatibleStatus.Body.code -eq 'DLE_OS_SIM_STATE_INCOMPATIBLE') 'incompatible state version fails clearly'
    $finalRepair = Invoke-SimHttp $incompatibleSession 'POST' '/api/sim/reset' @{ confirmation = 'RESET SIM'; requestId = [guid]::NewGuid().ToString() }
    Require ($finalRepair.Status -eq 200 -and $finalRepair.Body.stateVersion -eq 1) 'reset restores the supported state version after incompatibility'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    Stop-SimHost
    if (Test-Path $outsideSentinel) { Remove-Item -LiteralPath $outsideSentinel -Force }
}

Require ($hostProcess.HasExited) 'state/reset qualification host stops cleanly'
Write-Host "PASS: $($checks.Count) DLE-OS SIM state/reset checks."
$checks | ForEach-Object { Write-Host "  - $_" }
