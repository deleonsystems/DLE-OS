[CmdletBinding()]
param(
    [string]$EvidenceRoot = 'C:\DLE-OS\Qualification\DevResilience\Phase2'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serviceName = 'DleOsDevelopmentOperationalControl5054'
$candidatePath = '\'
$candidateName = 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath = '\DLE-OS\Development\'
$legacyName = 'Operational ControlHost 5054'
$qualifiedRelease = 'C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$qualifiedExecutable = Join-Path $qualifiedRelease 'DleOs.DevOperationalControlHost.exe'
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runRoot = Join-Path $EvidenceRoot ('phase2-service-rollback-' + $stamp)
$evidencePath = Join-Path $runRoot 'phase2-service-rollback.json'
$result = [ordered]@{
    Schema = 'dle-os.phase2-service-rollback.v1'
    StartedUtc = [DateTimeOffset]::UtcNow
    Passed = $false
    ServiceName = $serviceName
    CandidateTask = $candidateName
    QualifiedRelease = $qualifiedRelease
}

function Assert-AdministratorMiguel {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if ($identity.Name -ine 'DLE-OS-HOST\Miguel' -or
        -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Rollback requires elevated DLE-OS-HOST\Miguel.'
    }
}

function Get-QualifiedProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='DleOs.DevOperationalControlHost.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ExecutablePath -and
            [string]::Equals($_.ExecutablePath, $qualifiedExecutable, [StringComparison]::OrdinalIgnoreCase)
        } |
        Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine)
}

function Invoke-HealthProbe {
    try {
        $probeParameters = @{
            UseBasicParsing = $true
            UseDefaultCredentials = $true
            Uri = 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history'
            TimeoutSec = 20
        }
        $response = Invoke-WebRequest @probeParameters
        [ordered]@{ Passed = ([int]$response.StatusCode -eq 200); Status = [int]$response.StatusCode }
    }
    catch {
        [ordered]@{ Passed = $false; Error = $_.Exception.Message }
    }
}

try {
    Assert-AdministratorMiguel
    $null = New-Item -ItemType Directory -Path $runRoot -Force
    if (-not (Test-Path -LiteralPath $qualifiedExecutable -PathType Leaf)) {
        throw 'The retained qualified fallback executable is absent.'
    }

    $candidate = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    $legacy = Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
    $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    $result.Before = [ordered]@{
        ServiceState = $service.State
        ServiceStartMode = $service.StartMode
        CandidateState = [string]$candidate.State
        CandidateEnabled = [bool]$candidate.Settings.Enabled
        CandidateWorkingDirectory = [string]$candidate.Actions[0].WorkingDirectory
        LegacyState = [string]$legacy.State
        LegacyEnabled = [bool]$legacy.Settings.Enabled
    }
    if ($legacy.Settings.Enabled -or $legacy.State -ne 'Disabled') {
        throw 'The retained legacy task is not disabled; rollback stopped without changing it.'
    }
    if ([string]$candidate.Actions[0].WorkingDirectory -ine $qualifiedRelease) {
        throw 'The candidate task does not point to the retained qualified fallback release.'
    }

    Stop-Service -Name $serviceName -Force -ErrorAction Stop
    Set-Service -Name $serviceName -StartupType Manual
    Enable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName | Out-Null
    Start-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName

    $deadline = (Get-Date).AddSeconds(150)
    do {
        Start-Sleep -Seconds 2
        $candidate = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
        $processes = @(Get-QualifiedProcesses)
        $probe = Invoke-HealthProbe
    } until (($candidate.State -eq 'Running' -and $processes.Count -eq 1 -and $probe.Passed) -or
        (Get-Date) -ge $deadline)

    $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    $legacyAfter = Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
    $passed = $service.State -eq 'Stopped' -and
        $service.StartMode -eq 'Manual' -and
        $candidate.State -eq 'Running' -and
        $candidate.Settings.Enabled -and
        $processes.Count -eq 1 -and
        $probe.Passed -and
        -not $legacyAfter.Settings.Enabled -and
        $legacyAfter.State -eq 'Disabled'
    $result.After = [ordered]@{
        ServiceState = $service.State
        ServiceStartMode = $service.StartMode
        CandidateState = [string]$candidate.State
        CandidateEnabled = [bool]$candidate.Settings.Enabled
        QualifiedProcesses = $processes
        HealthProbe = $probe
        LegacyState = [string]$legacyAfter.State
        LegacyEnabled = [bool]$legacyAfter.Settings.Enabled
    }
    if (-not $passed) { throw 'The retained qualified scheduled-task fallback did not become healthy.' }
    $result.Passed = $true
}
catch {
    $result.Error = $_.Exception.Message
    $result.ErrorDetail = [string]$_
    throw
}
finally {
    $result.CompletedUtc = [DateTimeOffset]::UtcNow
    if (-not (Test-Path -LiteralPath $runRoot)) {
        try { $null = New-Item -ItemType Directory -Path $runRoot -Force } catch {}
    }
    try { $result | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $evidencePath -Encoding UTF8 } catch {}
}

Write-Output $evidencePath
