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
    $status = $null
    try {
        Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -Uri $identityUri `
            -TimeoutSec 15 -ErrorAction Stop | Out-Null
        throw 'The service identity unexpectedly received a DLE-OS application identity.'
    }
    catch {
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode.value__ }
        if ($status -ne 403) { throw }
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
}
catch {
    $evidence.Error = $_.Exception.Message
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $evidencePath -Encoding utf8
}

[pscustomobject]$evidence
