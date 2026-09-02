[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$program = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\Program.cs'
$options = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimRuntimeOptions.cs'
$client = Join-Path $repository 'SRC\api\dle-api-client.js'
$testPort = 5199
$testRoot = Join-Path $repository '.sim-state\qualification'
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

function Invoke-GuardedHost([string] $Name, [string] $DllPath) {
    $guardStdout = Join-Path $testRoot "$Name.stdout.log"
    $guardStderr = Join-Path $testRoot "$Name.stderr.log"
    [IO.File]::WriteAllText($guardStdout, '')
    [IO.File]::WriteAllText($guardStderr, '')
    $guardProcess = Start-Process dotnet -ArgumentList @($DllPath) -WorkingDirectory $repository `
        -RedirectStandardOutput $guardStdout -RedirectStandardError $guardStderr `
        -PassThru -Wait -WindowStyle Hidden
    return [pscustomobject]@{
        ExitCode = $guardProcess.ExitCode
        Output = (Read-Text $guardStdout) + (Read-Text $guardStderr)
    }
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM host build failed.' }
$checks.Add('SIM host builds without external project dependencies')

$projectText = Read-Text $project
$programText = Read-Text $program
$optionsText = Read-Text $options
$clientText = Read-Text $client

Require ($projectText -match 'Microsoft.Data.Sqlite' -and $projectText -notmatch 'SqlClient|Dapper|EntityFramework') 'SIM uses only its local SQLite provider and no external SQL provider'
Require ($programText -notmatch 'HttpClient|IHttpClientFactory|WebProxy|UseDefaultCredentials') 'SIM host configures no downstream HTTP client or default credentials'
Require ($programText -notmatch 'Process\.Start|PowerShell|\.src|worker-dependencies') 'SIM host exposes no worker-launch implementation'
Require ($programText -match 'IPAddress\.Loopback') 'SIM Kestrel binding is explicit loopback'
Require ($optionsText -match '5051, 5052, 5053, 5054, 5055, 5056, 5057') 'all governed DEV service ports are prohibited'
Require ($optionsText -match 'DLE_OS_SECURITY_CONNECTION_STRING') 'SQL/security runtime configuration is rejected'
Require ($optionsText -match 'DLE_OS_IDENTITY_SIGNING_PRIVATE_KEY_PATH') 'real identity key configuration is rejected'
Require ($optionsText -match 'DLE_OS_SYNC_OPERATIONS_EXECUTION_MODE') 'worker execution configuration is rejected'
Require ($programText -match 'connect-src ''self''') 'browser network policy restricts application connections to same origin'
Require ($clientText -match 'IS_SIM_RUNTIME' -and $clientText -match 'USE_SAME_ORIGIN_RUNTIME') 'shared API client recognizes SIM as a same-origin runtime'
Require ($clientText -match 'if \(IS_SIM_RUNTIME\) \{' -and $clientText -match 'baseUrl: DEVELOPMENT_BFF_BASE_URL') 'legacy API configuration is ignored in SIM'
Require ($programText -match 'DLE_OS_SIM_BUSINESS_CONTRACT_UNAVAILABLE') 'unknown business APIs fail locally instead of forwarding'

$outside = [IO.Path]::GetFullPath((Join-Path $repository '..\outside-sim-state'))
Require (-not $outside.StartsWith(([IO.Path]::GetFullPath($repository).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) 'state-root negative-test path is outside the repository'
Require ($optionsText -match 'EnsureDescendant') 'SIM validates that local state remains under its repository root'

& dotnet build $project --nologo --verbosity quiet | Out-Null
$dll = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.dll'

$previousCanonical = $env:DLE_OS_CANONICAL_API_BASE_URL
try {
    $env:DLE_OS_CANONICAL_API_BASE_URL = 'http://DLE-OS-HOST:5052'
    $guardResult = Invoke-GuardedHost 'canonical-guard' $dll
    $guardOutput = $guardResult.Output
    $guardExit = $guardResult.ExitCode
}
finally {
    if ($null -eq $previousCanonical) { Remove-Item Env:DLE_OS_CANONICAL_API_BASE_URL -ErrorAction SilentlyContinue }
    else { $env:DLE_OS_CANONICAL_API_BASE_URL = $previousCanonical }
}
Require ($guardExit -ne 0 -and $guardOutput -match 'rejected prohibited runtime configuration DLE_OS_CANONICAL_API_BASE_URL') 'known DEV downstream configuration fails startup closed'

$previousPort = $env:DLE_OS_SIM_PORT
try {
    $env:DLE_OS_SIM_PORT = '5051'
    $portResult = Invoke-GuardedHost 'port-guard' $dll
    $portOutput = $portResult.Output
    $portExit = $portResult.ExitCode
}
finally {
    if ($null -eq $previousPort) { Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue }
    else { $env:DLE_OS_SIM_PORT = $previousPort }
}
Require ($portExit -ne 0 -and $portOutput -match 'may not bind governed DLE-OS port 5051') 'governed DEV port selection fails startup closed'

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'qualification port is free before SIM startup'

$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
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
    Require $ready 'SIM starts and reports READY on loopback'
    Require ($status.binding -eq "http://127.0.0.1:$testPort") 'runtime reports only its explicit loopback binding'
    Require ($status.outboundProviders.Count -eq 0) 'runtime reports no outbound provider configuration'
    Require ([IO.Path]::GetFullPath($status.stateRoot).StartsWith(([IO.Path]::GetFullPath($repository).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) 'runtime state root remains inside the current clone'

    $shell = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$testPort/" -TimeoutSec 5
    Require ($shell.StatusCode -eq 200) 'shared shell returns HTTP 200'
    Require ($shell.Content -match 'id="workspaceViewSelect"') 'shared workspace navigation is present'
    Require ($shell.Content -match 'DLE-OS SIM' -and $shell.Content -match 'SYNTHETIC DATA') 'shared shell has persistent SIM synthetic-data identity'
    Require ($shell.Content -match '#dleDevControlsToggle' -and $shell.Content -match 'display: none !important') 'DEV-only controls are suppressed by the SIM shell overlay'
    Require (($shell.Content -match 'id="dle-auth-identity-script"') -and ($shell.Content -match "fetch\('/api/auth/me'")) 'normal current-user identity bootstrap is retained in SIM'
    Require ($shell.Content -match 'SRC/modules/operations-center/operations-center.js') 'shared module graph is retained rather than copied'
    Require (([string]::Join(' ', $shell.Headers['Content-Security-Policy'])) -match "connect-src 'self'") 'rendered shell enforces same-origin browser connections'

    $runtimeInfo = Invoke-RestMethod -Uri "http://127.0.0.1:$testPort/api/runtime/info" -TimeoutSec 5
    Require ($runtimeInfo.environment -eq 'SIM' -and $runtimeInfo.syntheticData) 'runtime identity is SIM with synthetic data'
    $user = Invoke-RestMethod -Uri "http://127.0.0.1:$testPort/api/auth/me" -TimeoutSec 5
    Require ($user.user.displayName -eq 'SIM Administrator' -and $user.isSuperAdmin) 'minimal synthetic user contract is active'

    try {
        Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$testPort/api/platform/live/v1/readiness" -TimeoutSec 5 -ErrorAction Stop | Out-Null
        $businessStatus = 200
    }
    catch { $businessStatus = [int]$_.Exception.Response.StatusCode }
    Require ($businessStatus -eq 501) 'unimplemented business API fails locally with HTTP 501'

    $src = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$testPort/SRC/shell/workspace-registry.js" -TimeoutSec 5
    Require ($src.StatusCode -eq 200 -and $src.Content -match 'DleWorkspaceRegistry') 'tracked shared frontend source is served directly'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit()
    }
}

Require ($hostProcess.HasExited) 'SIM stops cleanly without a Windows service'

Write-Host "PASS: $($checks.Count) DLE-OS SIM shell/isolation checks."
$checks | ForEach-Object { Write-Host "  - $_" }
