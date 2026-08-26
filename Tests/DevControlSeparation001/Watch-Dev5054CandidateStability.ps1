[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevation required.' }

$candidatePath = '\'
$candidateName = 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath = '\DLE-OS\Development\'
$legacyName = 'Operational ControlHost 5054'
$runtimeIdentity = 'DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$release = 'C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$executable = Join-Path $release 'DleOs.DevOperationalControlHost.exe'
$manifestPath = 'C:\DLE-OS\Development\OperationalControlHost5054\Manifests\dev5054-20260825T170328Z-4e01176a73ea.json'
$repairPath = Join-Path $PSScriptRoot 'dev5054-credential-task-repair.json'
$outputPath = Join-Path $PSScriptRoot 'dev5054-15-minute-stability.json'
$expectedLegacyHash = 'A8599487E42C55F796CC24D499CBFD960DDDD7543CE258CCA2C38CA148342CE9'

function Get-TextSha256([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($Text)))).Replace('-', '') }
    finally { $sha.Dispose() }
}
function Probe-Web([string]$Uri, [bool]$Json) {
    try {
        if ($Json) { return [ordered]@{ Passed=$true; Status=200; Body=Invoke-RestMethod -Uri $Uri -TimeoutSec 15 } }
        $r=Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 15
        return [ordered]@{ Passed=$r.StatusCode-eq 200; Status=[int]$r.StatusCode }
    } catch { return [ordered]@{ Passed=$false; Error=$_.Exception.Message } }
}
function Get-Sample {
    $task=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    $info=Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName
    $processes=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $executable } | ForEach-Object {
        $owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
        [ordered]@{ProcessId=[int]$_.ProcessId;ParentProcessId=[int]$_.ParentProcessId;ExecutablePath=$_.ExecutablePath;CreationDate=$_.CreationDate;WorkingSetSize=[int64]$_.WorkingSetSize;Owner=if($owner.ReturnValue-eq0){"$($owner.Domain)\$($owner.User)"}else{$null}}
    })
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess)
    [ordered]@{CapturedUtc=[DateTimeOffset]::UtcNow;TaskState=[string]$task.State;TaskEnabled=[bool]$task.Settings.Enabled;ExecutionTimeLimit=[string]$task.Settings.ExecutionTimeLimit;LastTaskResult=[int64]$info.LastTaskResult;Processes=$processes;Listeners=$listeners;Passed=$task.State-eq'Running'-and$task.Settings.Enabled-and[string]$task.Settings.ExecutionTimeLimit-eq'PT0S'-and$processes.Count-eq1-and$processes[0].Owner-ieq$runtimeIdentity-and$processes[0].ExecutablePath-ieq$executable-and$listeners.Count-gt0}
}

$repair=Get-Content -LiteralPath $repairPath -Raw|ConvertFrom-Json
if(-not$repair.Passed){throw'Repair evidence is not PASS.'}
$startedUtc=[DateTimeOffset]$repair.StartedUtc
$expectedPid=[int]$repair.Processes[0].ProcessId
$deadline=$startedUtc.AddMinutes(15)
$samples=@()
$criticalFailure=$null
do {
    $sample=Get-Sample
    $samples+=$sample
    if(-not$sample.Passed-or$sample.Processes[0].ProcessId-ne$expectedPid){$criticalFailure='Candidate task/process/listener stability failed.';break}
    $remaining=($deadline-[DateTimeOffset]::UtcNow).TotalSeconds
    if($remaining-gt0){Start-Sleep -Seconds ([Math]::Min(60,[Math]::Ceiling($remaining)))}
} while([DateTimeOffset]::UtcNow-lt$deadline)

$finalSample=Get-Sample
if($samples[-1].CapturedUtc-ne$finalSample.CapturedUtc){$samples+=$finalSample}
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
$releaseFiles=@($manifest.files|ForEach-Object{$p=Join-Path $release $_.relativePath;[ordered]@{RelativePath=$_.relativePath;ExpectedSha256=$_.sha256;ActualSha256=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash;ExpectedLength=[int64]$_.length;ActualLength=(Get-Item -LiteralPath $p).Length}})
$frontend=Probe-Web 'http://dle-os-host:5051/shared' $false
$readiness=Probe-Web 'http://127.0.0.1:5052/api/platform/live/v1/readiness' $true
$guard=Probe-Web 'http://127.0.0.1:5052/api/development/v1/security' $true
$keycloak=Probe-Web 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration' $false
$services=@('WinDefend','BrAmSvc','mpssvc','sshd','MSSQL$SQLEXPRESS','DleOsKeycloak','DleOsDevelopmentFrontend')|ForEach-Object{Get-Service $_ -ErrorAction SilentlyContinue|Select-Object Name,Status,StartType}
$ciEvents=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational';StartTime=$startedUtc.LocalDateTime} -ErrorAction SilentlyContinue|Where-Object{$_.Message-match'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea'}|Select-Object TimeCreated,RecordId,Id,LevelDisplayName,Message)
$defenderEvents=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Windows Defender/Operational';StartTime=$startedUtc.LocalDateTime} -ErrorAction SilentlyContinue|Where-Object{$_.Message-match'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea'}|Select-Object TimeCreated,RecordId,Id,LevelDisplayName,Message)
$applicationEvents=@(Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=$startedUtc.LocalDateTime} -ErrorAction SilentlyContinue|Where-Object{$_.Message-match'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea'-or$_.ProviderName-match'(?i)HP|Sure|Wolf'}|Select-Object TimeCreated,RecordId,Id,ProviderName,LevelDisplayName,Message)
$legacyHash=Get-TextSha256 (Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName)
$sac=[int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
$secureBoot=try{[bool](Confirm-SecureBootUEFI)}catch{$null}
$deviceGuard=Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard -ErrorAction SilentlyContinue|Select-Object VirtualizationBasedSecurityStatus,SecurityServicesConfigured,SecurityServicesRunning
$elapsed=([DateTimeOffset]::UtcNow-$startedUtc).TotalSeconds
$passed=-not$criticalFailure-and$elapsed-ge900-and@($samples|Where-Object{-not$_.Passed-or$_.Processes[0].ProcessId-ne$expectedPid}).Count-eq0-and@($releaseFiles|Where-Object{$_.ExpectedSha256-ne$_.ActualSha256-or$_.ExpectedLength-ne$_.ActualLength}).Count-eq0-and$frontend.Passed-and$readiness.Passed-and$readiness.Body.readinessVerdict-eq'Ready'-and$guard.Passed-and$guard.Body.verdict-eq'PASS'-and$guard.Body.select-eq'PERMITTED'-and$guard.Body.insert.result-eq'DENIED'-and$guard.Body.update.result-eq'DENIED'-and$guard.Body.delete.result-eq'DENIED'-and$guard.Body.execute-eq'DENIED'-and$keycloak.Passed-and@($services|Where-Object{$_.Status-ne'Running'-or$_.StartType-ne'Automatic'}).Count-eq0-and$sac-eq1-and$ciEvents.Count-eq0-and$defenderEvents.Count-eq0-and$legacyHash-eq$expectedLegacyHash
if(-not$passed){Stop-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue;Disable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction SilentlyContinue|Out-Null}
$result=[ordered]@{Schema='dle-os.dev5054-15-minute-stability.v1';StartedUtc=$startedUtc;CompletedUtc=[DateTimeOffset]::UtcNow;ElapsedSeconds=[Math]::Round($elapsed,1);ExpectedProcessId=$expectedPid;Samples=$samples;CriticalFailure=$criticalFailure;ReleaseFileCount=$releaseFiles.Count;ReleaseMismatchCount=@($releaseFiles|Where-Object{$_.ExpectedSha256-ne$_.ActualSha256-or$_.ExpectedLength-ne$_.ActualLength}).Count;Frontend=$frontend;CanonicalReadiness=$readiness;CanonicalGuard=$guard;Keycloak=$keycloak;Services=$services;SacState=$sac;SecureBoot=$secureBoot;DeviceGuard=$deviceGuard;CodeIntegrityEvents=$ciEvents;DefenderEvents=$defenderEvents;ApplicationSecurityEvents=$applicationEvents;LegacyHash=$legacyHash;LiveListeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$_.LocalPort-in5041,5042,5043}|Select-Object LocalAddress,LocalPort,OwningProcess);Passed=$passed;CandidateContainedOnFailure=-not$passed}
$result|ConvertTo-Json -Depth 16|Set-Content -LiteralPath $outputPath -Encoding utf8
if(-not$passed){throw'15-minute stability qualification failed; candidate stopped and disabled.'}
