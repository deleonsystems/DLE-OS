[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevation required.' }

$candidatePath = '\'
$candidateName = 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath = '\DLE-OS\Development\'
$legacyName = 'Operational ControlHost 5054'
$runtimeIdentity = 'DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$release = 'C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$launcher = Join-Path $release 'Start-DevOperationalControlHost5054.ps1'
$executable = Join-Path $release 'DleOs.DevOperationalControlHost.exe'
$manifestPath = 'C:\DLE-OS\Development\OperationalControlHost5054\Manifests\dev5054-20260825T170328Z-4e01176a73ea.json'
$output = 'C:\DLE-OS\Repositories\DLE-OS\Tests\DevControlSeparation001\dev5054-candidate-activation.json'
$expectedLegacyHash = 'A8599487E42C55F796CC24D499CBFD960DDDD7543CE258CCA2C38CA148342CE9'

function Get-TextSha256([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Text)))).Replace('-', '') }
    finally { $sha.Dispose() }
}
function Probe-Web([string]$Uri, [bool]$Json) {
    try {
        if ($Json) { return [ordered]@{ Passed = $true; Status = 200; Body = Invoke-RestMethod -Uri $Uri -TimeoutSec 15 } }
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 15
        return [ordered]@{ Passed = $response.StatusCode -eq 200; Status = $response.StatusCode }
    }
    catch { return [ordered]@{ Passed = $false; Error = $_.Exception.Message } }
}
function Get-CandidateProcess {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $executable, [StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object {
        $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
        [ordered]@{ ProcessId = [int]$_.ProcessId; ParentProcessId = [int]$_.ParentProcessId; ExecutablePath = $_.ExecutablePath; CommandLine = $_.CommandLine; CreationDate = $_.CreationDate; WorkingSetSize = [int64]$_.WorkingSetSize; Owner = $(if ($owner.ReturnValue -eq 0) { "$($owner.Domain)\$($owner.User)" } else { $null }) }
    })
}
function Get-ManifestCheck {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    @($manifest.files | ForEach-Object {
        $path = Join-Path $release $_.relativePath
        [ordered]@{ RelativePath = $_.relativePath; ExpectedSha256 = $_.sha256; ActualSha256 = (Get-FileHash $path -Algorithm SHA256).Hash; ExpectedLength = [int64]$_.length; ActualLength = (Get-Item $path).Length }
    })
}

$candidate = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$candidateInfo = Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName
$candidateXmlBefore = Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$legacy = Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyXmlBefore = Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyHashBefore = Get-TextSha256 $legacyXmlBefore
$filesBefore = @(Get-ManifestCheck)
$sac = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy'
$services = @()
foreach ($name in 'WinDefend','BrAmSvc','mpssvc','sshd','MSSQL$SQLEXPRESS','DleOsKeycloak','DleOsDevelopmentFrontend') {
    $service = Get-Service $name -ErrorAction SilentlyContinue
    if ($service) { $services += [ordered]@{ Name = $name; Status = [string]$service.Status; StartType = [string]$service.StartType } }
}
$firewallRules = @(Get-NetFirewallRule -DisplayName 'OpenSSH SSH Server (sshd)' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' })
$preflight = [ordered]@{
    Frontend = Probe-Web 'http://dle-os-host:5051/shared' $false
    CanonicalReadiness = Probe-Web 'http://127.0.0.1:5052/api/platform/live/v1/readiness' $true
    CanonicalGuard = Probe-Web 'http://127.0.0.1:5052/api/development/v1/security' $true
    Keycloak = Probe-Web 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration' $false
    Services = $services
    Firewall = [ordered]@{ RuleCount = $firewallRules.Count; RemoteAddress = @($firewallRules | Get-NetFirewallAddressFilter | Select-Object -ExpandProperty RemoteAddress) }
    Defender = Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, BehaviorMonitorEnabled, RealTimeProtectionEnabled, IsTamperProtected
    SacState = [int]$sac.VerifiedAndReputablePolicyState
    Listener5054 = @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue)
    Candidate = [ordered]@{ State = [string]$candidate.State; Enabled = [bool]$candidate.Settings.Enabled; UserId = $candidate.Principal.UserId; LogonType = [string]$candidate.Principal.LogonType; RunLevel = [string]$candidate.Principal.RunLevel; Actions = @($candidate.Actions | Select-Object Execute, Arguments, WorkingDirectory); XmlSha256 = Get-TextSha256 $candidateXmlBefore; LastRunTime = $candidateInfo.LastRunTime; LastTaskResult = [int64]$candidateInfo.LastTaskResult }
    Legacy = [ordered]@{ State = [string]$legacy.State; Enabled = [bool]$legacy.Settings.Enabled; XmlSha256 = $legacyHashBefore }
    ReleaseFileCount = $filesBefore.Count
    ReleaseMismatchCount = @($filesBefore | Where-Object { $_.ActualSha256 -ne $_.ExpectedSha256 -or $_.ActualLength -ne $_.ExpectedLength }).Count
}

$guard = $preflight.CanonicalGuard.Body
$ready = $preflight.CanonicalReadiness.Body
$requiredServicesHealthy = @($services | Where-Object { $_.Status -ne 'Running' -or $_.StartType -ne 'Automatic' }).Count -eq 0
$firewallHealthy = $preflight.Firewall.RuleCount -eq 1 -and @($preflight.Firewall.RemoteAddress).Count -eq 1 -and $preflight.Firewall.RemoteAddress[0] -in '192.168.0.0/255.255.255.0','192.168.0.0/24'
$candidateAction = @($candidate.Actions)[0]
$candidateSid = [string]([Security.Principal.NTAccount]::new($candidate.Principal.UserId).Translate([Security.Principal.SecurityIdentifier]))
$runtimeSid = [string]([Security.Principal.NTAccount]::new($runtimeIdentity).Translate([Security.Principal.SecurityIdentifier]))
$candidateDefinitionHealthy = -not $candidate.Settings.Enabled -and $candidateSid -eq $runtimeSid -and [string]$candidate.Principal.LogonType -eq 'Password' -and [string]$candidate.Principal.RunLevel -eq 'Limited' -and $candidateAction.Execute -ieq 'powershell.exe' -and $candidateAction.Arguments -match [regex]::Escape($launcher) -and $candidateAction.WorkingDirectory -ieq $release
$preflightPassed = $preflight.Frontend.Passed -and $preflight.CanonicalReadiness.Passed -and $ready.readinessVerdict -eq 'Ready' -and $preflight.CanonicalGuard.Passed -and $guard.verdict -eq 'PASS' -and $guard.select -eq 'PERMITTED' -and $guard.insert.result -eq 'DENIED' -and $guard.update.result -eq 'DENIED' -and $guard.delete.result -eq 'DENIED' -and $guard.execute -eq 'DENIED' -and $preflight.Keycloak.Passed -and $requiredServicesHealthy -and $firewallHealthy -and $preflight.Defender.AMServiceEnabled -and $preflight.Defender.AntivirusEnabled -and $preflight.SacState -eq 1 -and $preflight.Listener5054.Count -eq 0 -and $candidateDefinitionHealthy -and $legacyHashBefore -eq $expectedLegacyHash -and $preflight.ReleaseFileCount -eq 47 -and $preflight.ReleaseMismatchCount -eq 0
if (-not $preflightPassed) {
    [ordered]@{ Schema = 'dle-os.dev5054-candidate-activation.v1'; CapturedUtc = [DateTimeOffset]::UtcNow; PreflightPassed = $false; Preflight = $preflight } | ConvertTo-Json -Depth 18 | Set-Content $output -Encoding utf8
    throw 'Candidate activation preflight failed; no task state changed.'
}

$ciLast = (Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 1 -ErrorAction SilentlyContinue).RecordId
$defenderLast = (Get-WinEvent -LogName 'Microsoft-Windows-Windows Defender/Operational' -MaxEvents 1 -ErrorAction SilentlyContinue).RecordId
$applicationLast = (Get-WinEvent -LogName Application -MaxEvents 1 -ErrorAction SilentlyContinue).RecordId
$activationUtc = [DateTimeOffset]::UtcNow
$activationError = $null
$samples = @()
try {
    Enable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName | Out-Null
    Start-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    $deadline = (Get-Date).AddSeconds(30)
    do { Start-Sleep -Milliseconds 500; $listener = Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue } while (-not $listener -and (Get-Date) -lt $deadline)
    if (-not $listener) { throw 'The candidate did not open TCP 5054 within 30 seconds.' }
    foreach ($delay in 0, 15, 15) {
        if ($delay) { Start-Sleep -Seconds $delay }
        $samples += [ordered]@{ CapturedUtc = [DateTimeOffset]::UtcNow; Processes = @(Get-CandidateProcess); Listener = @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess); TaskState = [string](Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName).State }
    }
    $pids = @($samples | ForEach-Object { $_.Processes | ForEach-Object { $_.ProcessId } } | Sort-Object -Unique)
    if ($pids.Count -ne 1 -or @($samples | Where-Object { $_.Processes.Count -ne 1 -or $_.Processes[0].Owner -ine $runtimeIdentity -or $_.Processes[0].ExecutablePath -ine $executable -or $_.TaskState -ne 'Running' }).Count -ne 0) { throw 'The candidate process identity/path/stability qualification failed.' }
}
catch {
    $activationError = $_.Exception.Message
    Stop-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue | Out-Null
}

$filesAfter = @(Get-ManifestCheck)
$candidateAfter = Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$candidateInfoAfter = Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName
$legacyXmlAfter = Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyHashAfter = Get-TextSha256 $legacyXmlAfter
$ciEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-CodeIntegrity/Operational'; StartTime = $activationUtc.LocalDateTime } -ErrorAction SilentlyContinue | Where-Object { $_.RecordId -gt $ciLast -and ($_.Message -match 'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea') } | Select-Object TimeCreated, RecordId, Id, LevelDisplayName, Message)
$defenderEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; StartTime = $activationUtc.LocalDateTime } -ErrorAction SilentlyContinue | Where-Object { $_.RecordId -gt $defenderLast -and ($_.Message -match 'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea') } | Select-Object TimeCreated, RecordId, Id, LevelDisplayName, Message)
$applicationEvents = @(Get-WinEvent -FilterHashtable @{ LogName = Application; StartTime = $activationUtc.LocalDateTime } -ErrorAction SilentlyContinue | Where-Object { $_.RecordId -gt $applicationLast -and ($_.Message -match 'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea' -or $_.ProviderName -match '(?i)HP|Sure|Wolf') } | Select-Object TimeCreated, RecordId, Id, ProviderName, LevelDisplayName, Message)
$result = [ordered]@{
    Schema = 'dle-os.dev5054-candidate-activation.v1'; ActivationUtc = $activationUtc; CompletedUtc = [DateTimeOffset]::UtcNow
    ElevatedIdentity = $id.Name; PreflightPassed = $preflightPassed; Preflight = $preflight
    ActivationPassed = [string]::IsNullOrEmpty($activationError); ActivationError = $activationError; StabilitySamples = $samples
    CandidateAfter = [ordered]@{ State = [string]$candidateAfter.State; Enabled = [bool]$candidateAfter.Settings.Enabled; LastRunTime = $candidateInfoAfter.LastRunTime; LastTaskResult = [int64]$candidateInfoAfter.LastTaskResult }
    LegacyHashBefore = $legacyHashBefore; LegacyHashAfter = $legacyHashAfter; LegacyUnchanged = $legacyHashBefore -eq $legacyHashAfter
    ReleaseFiles = $filesAfter; ReleaseIntegrityPreserved = @($filesAfter | Where-Object { $_.ActualSha256 -ne $_.ExpectedSha256 -or $_.ActualLength -ne $_.ExpectedLength }).Count -eq 0
    CodeIntegrityEvents = $ciEvents; DefenderEvents = $defenderEvents; ApplicationSecurityEvents = $applicationEvents
    LiveListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 5041,5042,5043 } | Select-Object LocalAddress, LocalPort, OwningProcess)
}
$result | ConvertTo-Json -Depth 20 | Set-Content $output -Encoding utf8
if ($activationError) { throw $activationError }
