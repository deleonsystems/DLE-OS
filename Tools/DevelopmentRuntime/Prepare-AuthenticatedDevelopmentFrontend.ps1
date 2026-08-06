[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$expectedAssemblyFragment = 'DleOs.DevelopmentFrontend.dll'
$url = 'http://dle-os-host:5051/'
$urlAclUser = 'DLE-OS-HOST\DLE-OS'
$protectedPorts = 5041,5042,5043,5052,5053
$evidencePath = Join-Path $repository '.tmp\development-runtime\5051-auth-transition.json'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Authenticated development frontend preparation requires an elevated Administrator token.'
}

function Get-ListenerPid([int] $Port) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $null }
    $ids = @($listeners.OwningProcess | Sort-Object -Unique)
    if ($ids.Count -ne 1) { throw "Port $Port has multiple listener owners." }
    return [int]$ids[0]
}

function Get-ProtectedSnapshot {
    $snapshot = [ordered]@{}
    foreach ($port in $protectedPorts) { $snapshot[[string]$port] = Get-ListenerPid $port }
    return $snapshot
}

$protectedBefore = Get-ProtectedSnapshot
$legacyPid = Get-ListenerPid 5051
$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ElevatedIdentity = $identity.Name
    LegacyProcessId = $legacyPid
    Url = $url
    UrlAclUser = $urlAclUser
    ProtectedBefore = $protectedBefore
}

try {
    if ($null -ne $legacyPid) {
        if ($legacyPid -eq 4) {
            $workers = @(
                Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" -ErrorAction Stop |
                    Where-Object {
                        -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
                        $_.CommandLine.IndexOf($expectedAssemblyFragment,
                            [StringComparison]::OrdinalIgnoreCase) -ge 0
                    }
            )
            if ($workers.Count -ne 1) {
                throw 'The existing HTTP.sys 5051 worker could not be identified uniquely.'
            }
            Stop-Process -Id $workers[0].ProcessId -ErrorAction Stop
            $evidence.LegacyWorkerProcessId = [int]$workers[0].ProcessId
            for ($attempt=0; $attempt -lt 40; $attempt++) {
                if ($null -eq (Get-ListenerPid 5051)) { break }
                Start-Sleep -Milliseconds 250
            }
            if ($null -ne (Get-ListenerPid 5051)) {
                throw 'The existing authenticated development frontend did not release 5051.'
            }
            $evidence.LegacyStopped = $true
        }
        else {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$legacyPid" -ErrorAction Stop
            if ($process.Name -ine 'dotnet.exe' -or
                [string]::IsNullOrWhiteSpace($process.CommandLine) -or
                $process.CommandLine.IndexOf($expectedAssemblyFragment,[StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw "Port 5051 PID $legacyPid is not the governed development frontend."
            }
            Stop-Process -Id $legacyPid -ErrorAction Stop
            for ($attempt=0; $attempt -lt 40; $attempt++) {
                if ($null -eq (Get-ListenerPid 5051)) { break }
                Start-Sleep -Milliseconds 250
            }
            if ($null -ne (Get-ListenerPid 5051)) { throw 'Legacy development port 5051 did not release.' }
            $evidence.LegacyStopped = $true
        }
    }
    else {
        $evidence.LegacyStopped = $false
    }

    $reservation = netsh http show urlacl url=$url | Out-String
    if ($reservation -match 'Reserved URL') {
        if ($reservation -match [regex]::Escape($urlAclUser)) {
            $evidence.UrlAclCreated = $false
        }
        else {
            netsh http delete urlacl url=$url | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'The prior 5051 URL reservation could not be removed.' }
            netsh http add urlacl url=$url user=$urlAclUser | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'The service-owned 5051 URL reservation could not be created.' }
            $evidence.UrlAclCreated = $true
            $evidence.UrlAclReplaced = $true
        }
    }
    else {
        netsh http add urlacl url=$url user=$urlAclUser | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'The 5051 URL reservation could not be created.' }
        $evidence.UrlAclCreated = $true
    }

    $protectedAfter = Get-ProtectedSnapshot
    $evidence.ProtectedAfter = $protectedAfter
    if (($protectedBefore | ConvertTo-Json -Compress) -ne ($protectedAfter | ConvertTo-Json -Compress)) {
        throw 'A protected listener changed during the 5051 development transition.'
    }
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    New-Item -ItemType Directory -Path (Split-Path $evidencePath -Parent) -Force | Out-Null
    $evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $evidencePath -Encoding utf8
}

[pscustomobject]$evidence
