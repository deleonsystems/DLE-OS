[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$requiredIdentity = 'DLE-OS-HOST\DLE-OS'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$projectDirectory = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend'
$project = Join-Path $projectDirectory 'DleOs.DevelopmentFrontend.csproj'
$runtime = Join-Path $projectDirectory 'bin\Release\net8.0-windows'
$assembly = Join-Path $runtime 'DleOs.DevelopmentFrontend.dll'
$dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
$binding = 'http://dle-os-host:5051'
$rootUri = "$binding/"
$identityUri = "$binding/api/auth/me"
$evidenceDirectory = Join-Path $repository '.tmp\development-runtime'
$evidencePath = Join-Path $evidenceDirectory '5051-service-worker-launch.json'
$stdoutPath = Join-Path $evidenceDirectory '5051-authenticated.stdout.log'
$stderrPath = Join-Path $evidenceDirectory '5051-authenticated.stderr.log'
$protectedPorts = 5041,5042,5043,5052,5053
$identityPrivateKeyPath = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\issuer-private.pem'
$oidcClientSecretPath = 'C:\ProgramData\DLE-OS\Keycloak\Secrets\oidc-client-secret.dpapi'
$oidcClientSecretEntropy = 'DLE-OS|Keycloak|OIDC-Client|v1'
$oidcProtectedBytes = $null
$oidcEntropyBytes = $null
$oidcPlainBytes = $null
$startupMutex = $null
$startupMutexAcquired = $false
$startupMutexName = 'Global\DLE-OS-DevelopmentFrontend-5051-Startup'
$process = $null

# Explicit runtime identity and governed destinations. No classification is
# inferred from a port or hostname.
$env:DLE_OS_ENVIRONMENT = 'Development'
$env:DLE_OS_REPOSITORY_ROOT = $repository
$env:DLE_OS_REQUIRED_RUNTIME_IDENTITY = $requiredIdentity
$env:DLE_OS_RUNTIME_MARKER = 'ISOLATED_DEVELOPMENT'
$env:DLE_OS_ENVIRONMENT_LABEL = 'DEVELOPMENT - ISOLATED OPERATIONAL DATA'
$env:DLE_OS_APPLICATION_ORIGIN = 'https://dev.dle-os.internal.dlemfg.com'
$env:DLE_OS_OIDC_CLIENT_ID = 'dle-os-development-bff'
$env:DLE_OS_CANONICAL_API_BASE_URL = 'http://DLE-OS-HOST:5052'
$env:DLE_OS_OPERATIONAL_API_BASE_URL = 'http://DLE-OS-HOST:5054'
$env:DLE_OS_CUSTOMER_FILES_API_BASE_URL = 'http://DLE-OS-HOST:5053'
$env:DLE_OS_SECURITY_DATABASE = 'DLE_OS_SECURITY_DEV'
$env:DLE_OS_FRONTEND_PREFIXES = 'http://dle-os-host:5051;http://192.168.0.105:5051;https://dev.dle-os.internal.dlemfg.com:443;https://auth.internal.dlemfg.com:443'

if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $requiredIdentity) {
    throw "Authenticated development frontend startup requires $requiredIdentity."
}

function Get-ListenerPid([int] $Port) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $null }
    $ids = @($listeners.OwningProcess | Sort-Object -Unique)
    if ($ids.Count -ne 1) { throw "Port $Port has multiple listener owners." }
    return [int]$ids[0]
}

function Get-FrontendWorkers {
    return @(
        Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
                $_.CommandLine.IndexOf($assembly,[StringComparison]::OrdinalIgnoreCase) -ge 0
            }
    )
}

function Get-ProtectedSnapshot {
    $snapshot = [ordered]@{}
    foreach ($port in $protectedPorts) { $snapshot[[string]$port] = Get-ListenerPid $port }
    return $snapshot
}

function Test-ServiceIdentitySeparation {
    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.UseDefaultCredentials = $true
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    $response = $null
    try {
        $response = $client.GetAsync($identityUri).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        if ($status -notin 302,401,403) {
            throw "The service identity boundary returned unexpected HTTP status $status."
        }
    }
    finally {
        if ($response) { $response.Dispose() }
        $client.Dispose()
        $handler.Dispose()
    }
    return [ordered]@{
        StatusCode = $status
        ServiceIdentityIsNotProvisioned = $true
    }
}

New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$protectedBefore = Get-ProtectedSnapshot
$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Binding = $binding
    Authentication = 'HTTP.sys Negotiate + NTLM; anonymous disabled'
    ProtectedBefore = $protectedBefore
}

try {
    $startupMutex = [Threading.Mutex]::new($false, $startupMutexName)
    try {
        $startupMutexAcquired = $startupMutex.WaitOne([TimeSpan]::FromSeconds(30))
    }
    catch [Threading.AbandonedMutexException] {
        $startupMutexAcquired = $true
    }
    if (-not $startupMutexAcquired) {
        throw "Timed out waiting for the single-worker startup lock $startupMutexName."
    }

    if (-not (Test-Path -LiteralPath $identityPrivateKeyPath -PathType Leaf)) {
        throw 'The development identity assertion signing key is absent.'
    }
    $env:DLE_OS_IDENTITY_SIGNING_PRIVATE_KEY_PATH = $identityPrivateKeyPath
    Add-Type -AssemblyName System.Security
    $oidcProtectedBytes = [IO.File]::ReadAllBytes($oidcClientSecretPath)
    $oidcEntropyBytes = [Text.Encoding]::UTF8.GetBytes($oidcClientSecretEntropy)
    $oidcPlainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $oidcProtectedBytes,
        $oidcEntropyBytes,
        [Security.Cryptography.DataProtectionScope]::LocalMachine)
    $env:DLE_OS_OIDC_CLIENT_SECRET = [Text.Encoding]::UTF8.GetString($oidcPlainBytes)
    $listenerPid = Get-ListenerPid 5051
    if ($null -ne $listenerPid) {
        $workers = @(Get-FrontendWorkers)
        if ($listenerPid -ne 4 -or $workers.Count -ne 1) {
            throw 'Port 5051 is not owned by the authenticated HTTP.sys development frontend.'
        }
        $evidence.ProcessId = [int]$workers[0].ProcessId
        $evidence.HttpSysListenerPid = 4
        $evidence.AlreadyRunning = $true
        $evidence.ServiceIdentityBoundary = Test-ServiceIdentitySeparation
    }
    else {
        if (-not (Test-Path -LiteralPath $assembly -PathType Leaf)) {
            throw 'The authenticated development frontend Release assembly is absent.'
        }
        $process = Start-Process -FilePath $dotnet -ArgumentList @(
            "`"$assembly`"", '--contentRoot', "`"$runtime`"") -WorkingDirectory $runtime `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
            -WindowStyle Hidden -PassThru
        for ($attempt=0; $attempt -lt 60; $attempt++) {
            Start-Sleep -Milliseconds 250
            if ((Get-ListenerPid 5051) -eq 4) { break }
            $process.Refresh()
            if ($process.HasExited) { throw "Frontend exited during startup. See $stderrPath" }
        }
        if ((Get-ListenerPid 5051) -ne 4) { throw 'HTTP.sys did not bind development port 5051.' }
        $evidence.ProcessId = $process.Id
        $evidence.HttpSysListenerPid = 4
        $evidence.AlreadyRunning = $false
        $evidence.ServiceIdentityBoundary = Test-ServiceIdentitySeparation
    }

    $protectedAfter = Get-ProtectedSnapshot
    $evidence.ProtectedAfter = $protectedAfter
    if (($protectedBefore | ConvertTo-Json -Compress) -ne ($protectedAfter | ConvertTo-Json -Compress)) {
        throw 'A protected listener changed during development frontend startup.'
    }
    $evidence.Verdict = 'PASS'

    # Keep the scheduled-task action alive through the governed deployment
    # validation window. MultipleInstances=IgnoreNew applies to the action,
    # not to a detached child after this script exits.
    if ($process) {
        $ownershipDeadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
        do {
            Start-Sleep -Milliseconds 250
            $process.Refresh()
            if ($process.HasExited) {
                throw "Frontend exited during the scheduled-task ownership window with code $($process.ExitCode)."
            }
        } while ([DateTimeOffset]::UtcNow -lt $ownershipDeadline)
        $evidence.ScheduledTaskOwnershipWindowSeconds = 30
    }
}
catch {
    $evidence.Error = $_.Exception.Message
    throw
}
finally {
    $env:DLE_OS_OIDC_CLIENT_SECRET = $null
    if ($startupMutexAcquired) {
        $startupMutex.ReleaseMutex()
        $startupMutexAcquired = $false
    }
    if ($startupMutex) { $startupMutex.Dispose() }
    if ($oidcPlainBytes) { [Array]::Clear($oidcPlainBytes, 0, $oidcPlainBytes.Length) }
    if ($oidcEntropyBytes) { [Array]::Clear($oidcEntropyBytes, 0, $oidcEntropyBytes.Length) }
    @('DLE_OS_ENVIRONMENT','DLE_OS_REPOSITORY_ROOT','DLE_OS_REQUIRED_RUNTIME_IDENTITY',
      'DLE_OS_RUNTIME_MARKER','DLE_OS_ENVIRONMENT_LABEL',
      'DLE_OS_APPLICATION_ORIGIN','DLE_OS_OIDC_CLIENT_ID','DLE_OS_CANONICAL_API_BASE_URL',
      'DLE_OS_OPERATIONAL_API_BASE_URL','DLE_OS_CUSTOMER_FILES_API_BASE_URL',
      'DLE_OS_SECURITY_DATABASE','DLE_OS_FRONTEND_PREFIXES') |
        ForEach-Object { [Environment]::SetEnvironmentVariable($_, $null, 'Process') }
    if ($oidcProtectedBytes) { [Array]::Clear($oidcProtectedBytes, 0, $oidcProtectedBytes.Length) }
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding utf8
}

[pscustomobject]$evidence
