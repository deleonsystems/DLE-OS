[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$')]
    [string]$ReleaseId,
    [string]$EvidenceRoot='C:\DLE-OS\Qualification\DevResilience\Phase2'
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$serviceName='DleOsDevelopmentOperationalControl5054'
$runtimeIdentity='DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$candidatePath='\';$candidateName='DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath='\DLE-OS\Development\';$legacyName='Operational ControlHost 5054'
$releasePath="C:\DLE-OS\Development\OperationalControlHost5054\Releases\$ReleaseId"
$manifestPath="C:\DLE-OS\Development\OperationalControlHost5054\Manifests\$ReleaseId.json"
$oldRelease='C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$logRoot='C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs'
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runRoot=Join-Path $EvidenceRoot ('phase2-service-cutover-'+$stamp)
$result=[ordered]@{Schema='dle-os.phase2-service-cutover.v1';StartedUtc=[DateTimeOffset]::UtcNow;ReleaseId=$ReleaseId;ServiceName=$serviceName;RollbackInvoked=$false;RollbackPassed=$false;Passed=$false}
$runtimeCutoverBegan=$false

function Assert-AdministratorMiguel{
    $id=[Security.Principal.WindowsIdentity]::GetCurrent();$p=[Security.Principal.WindowsPrincipal]::new($id)
    if(-not$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)-or$id.Name-ine'DLE-OS-HOST\Miguel'){throw 'Cutover requires elevated DLE-OS-HOST\Miguel.'}
}
function XmlHash([string]$Path,[string]$Name){$x=Export-ScheduledTask -TaskPath $Path -TaskName $Name;$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash([Text.Encoding]::Unicode.GetBytes($x)))).Replace('-','')}finally{$s.Dispose()}}
function Probe([string]$Uri,[switch]$Credentials){try{$p=@{Uri=$Uri;UseBasicParsing=$true;TimeoutSec=20};if($Credentials){$p.UseDefaultCredentials=$true};$r=Invoke-WebRequest @p;[ordered]@{Passed=([int]$r.StatusCode-eq200);Status=[int]$r.StatusCode;Body=$r.Content}}catch{[ordered]@{Passed=$false;Error=$_.Exception.Message}}}
function Assert-Manifest{
    $m=Get-Content -Raw -LiteralPath $manifestPath|ConvertFrom-Json;$files=@(Get-ChildItem -LiteralPath $releasePath -File -Recurse -Force);$bad=@($m.files|Where-Object{$p=Join-Path $releasePath $_.relativePath;-not(Test-Path -LiteralPath $p)-or(Get-Item -LiteralPath $p).Length-ne[int64]$_.length-or(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash-ne$_.sha256});if($files.Count-ne@($m.files).Count-or$bad.Count-ne0){throw 'The service release failed immutable-manifest verification.'};$m
}
function ServiceProcess{
    $s=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
    if([int]$s.ProcessId-le0){return $null}
    $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($s.ProcessId)" -ErrorAction Stop;$o=Invoke-CimMethod -InputObject $p -MethodName GetOwner
    [pscustomobject]@{Pid=[int]$p.ProcessId;ParentPid=[int]$p.ParentProcessId;Path=$p.ExecutablePath;CommandLine=$p.CommandLine;Owner=if($o.ReturnValue-eq0){$o.Domain+'\'+$o.User}else{$null};ServiceState=$s.State;StartMode=$s.StartMode;StartName=$s.StartName}
}
function ExactOldProcesses{@(Get-CimInstance Win32_Process -Filter "Name='DleOs.DevOperationalControlHost.exe'" -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath-and[string]::Equals($_.ExecutablePath,(Join-Path $oldRelease 'DleOs.DevOperationalControlHost.exe'),[StringComparison]::OrdinalIgnoreCase)})}
function Wait-ServiceHealthy([int]$Seconds){$deadline=(Get-Date).AddSeconds($Seconds);do{Start-Sleep -Seconds 2;$service=Get-Service $serviceName;$process=ServiceProcess;$probe=Probe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history' -Credentials}until(($service.Status-eq'Running'-and$process-and$probe.Passed)-or(Get-Date)-ge$deadline);[pscustomobject]@{Service=$service;Process=$process;Probe=$probe;Passed=($service.Status-eq'Running'-and$null-ne$process-and$probe.Passed)}}
function Start-Fallback{
    try{Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue}catch{}
    try{Set-Service -Name $serviceName -StartupType Manual}catch{}
    try{Enable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName|Out-Null}catch{}
    try{Start-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName}catch{}
    $deadline=(Get-Date).AddSeconds(150);do{Start-Sleep -Seconds 2;$task=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName;$old=@(ExactOldProcesses);$health=Probe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history' -Credentials}until(($task.State-eq'Running'-and$old.Count-eq1-and$health.Passed)-or(Get-Date)-ge$deadline)
    $result.RollbackPassed=($task.State-eq'Running'-and$old.Count-eq1-and$health.Passed)
}
function ServiceEvents([datetime]$Since){@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Service Control Manager';StartTime=$Since.ToLocalTime()} -ErrorAction SilentlyContinue|Where-Object{$_.Message -match $serviceName -or $_.Message -match 'DLE-OS DEV Operational ControlHost 5054'}|Select-Object TimeCreated,RecordId,Id,LevelDisplayName,Message)}

try{
    Assert-AdministratorMiguel;$null=New-Item -ItemType Directory -Path $runRoot -Force
    $manifest=Assert-Manifest
    Add-Type -TypeDefinition (Get-Content -Raw 'C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\DleOsServiceRecoveryConfiguration.cs') -Language CSharp
    $recovery=[DleOsServiceRecoveryConfiguration]::Query($serviceName);$first=@($recovery.Actions|Select-Object -First 4)
    if($recovery.ResetPeriodSeconds-ne86400-or@($recovery.Actions).Count-ne5-or@($first|Where-Object{$_.Type-ne1-or$_.DelayMilliseconds-ne120000}).Count-ne0-or$recovery.Actions[4].Type-ne0){throw 'The staged service recovery policy is not the approved bounded policy.'}
    $service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'";$reported=[string]$service.StartName;$normalized=if($reported.StartsWith('.\')){$env:COMPUTERNAME+'\'+$reported.Substring(2)}else{$reported};$expectedSid=[Security.Principal.NTAccount]::new($runtimeIdentity).Translate([Security.Principal.SecurityIdentifier]).Value;$actualSid=[Security.Principal.NTAccount]::new($normalized).Translate([Security.Principal.SecurityIdentifier]).Value
    if($service.State-ne'Stopped'-or$service.StartMode-ne'Manual'-or$actualSid-cne$expectedSid-or$service.PathName-notmatch[regex]::Escape($releasePath)){throw 'The staged service preflight failed.'}
    $candidate=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName;$legacy=Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
    if($candidate.State-ne'Running'-or-not$candidate.Settings.Enabled-or[int]$candidate.Settings.RestartCount-ne0-or[string]$candidate.Actions[0].WorkingDirectory-ne$oldRelease-or$legacy.State-ne'Disabled'-or$legacy.Settings.Enabled){throw 'The scheduled-task fallback preflight failed.'}
    $candidateHashBefore=XmlHash $candidatePath $candidateName;$legacyHashBefore=XmlHash $legacyPath $legacyName
    $baseline=[ordered]@{CapturedUtc=[DateTimeOffset]::UtcNow;CandidateHash=$candidateHashBefore;LegacyHash=$legacyHashBefore;SacState=[int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState;SecureBoot=try{[bool](Confirm-SecureBootUEFI)}catch{$null};LiveListeners=@(Get-NetTCPConnection -State Listen|Where-Object LocalPort -in 5041,5042,5043|Select-Object LocalAddress,LocalPort,OwningProcess);Services=@('MSSQL$SQLEXPRESS','DleOsKeycloak','sshd','BrAmSvc','WinDefend','mpssvc','DleOsDevelopmentFrontend')|ForEach-Object{Get-Service $_|Select-Object Name,Status,StartType};Defender=Get-MpComputerStatus|Select-Object AMServiceEnabled,AntivirusEnabled,BehaviorMonitorEnabled,RealTimeProtectionEnabled,IsTamperProtected}
    $preflightProbes=[ordered]@{Frontend=Probe 'http://dle-os-host:5051/shared';Operations=Probe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history' -Credentials;Canonical=Probe 'http://127.0.0.1:5052/api/platform/live/v1/readiness' -Credentials;Guard=Probe 'http://127.0.0.1:5052/api/development/v1/security' -Credentials;Keycloak=Probe 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration'}
    if(@($preflightProbes.Values|Where-Object{-not$_.Passed}).Count-ne0){throw 'A pre-cutover health probe failed.'}

    $runtimeCutoverBegan=$true;$cutoverUtc=[datetime]::UtcNow
    Stop-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName -ErrorAction Stop
    $deadline=(Get-Date).AddSeconds(45);do{Start-Sleep -Seconds 1;$old=@(ExactOldProcesses)}until($old.Count-eq0-or(Get-Date)-ge$deadline)
    if($old.Count-ne0){throw 'The scheduled-task 5054 process did not stop cleanly.'}
    Start-Service -Name $serviceName -ErrorAction Stop
    $startup=Wait-ServiceHealthy 150
    if(-not$startup.Passed){throw 'The staged Windows Service did not establish healthy 5054 operation.'}
    $firstProcess=$startup.Process
    if($firstProcess.Owner-ine$runtimeIdentity-or$firstProcess.Path-ine(Join-Path $releasePath 'DleOs.DevOperationalControlHost.exe')){throw 'The service process identity or immutable release path is wrong.'}
    $runtimeProbes=[ordered]@{Operations=$startup.Probe;Kitting=Probe 'http://dle-os-host:5051/api/kitting-dispositions/v1/work-orders/0115622/history' -Credentials;Rma=Probe 'http://dle-os-host:5051/api/rma-rework/v1/cases?page=1&pageSize=10' -Credentials;Shipment=Probe 'http://dle-os-host:5051/api/shipment-staging/v1/shipments?page=1&pageSize=10' -Credentials}
    $result.FirstServiceProcess=$firstProcess;$result.RuntimeProbes=$runtimeProbes
    if(@($runtimeProbes.Values|Where-Object{-not$_.Passed}).Count-ne0){throw 'A DEV operational read path failed under the Windows Service.'}
    $logText=(Get-ChildItem -LiteralPath $logRoot -File -Filter 'dev5054-*.jsonl'|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 4|ForEach-Object{Get-Content -LiteralPath $_.FullName -Tail 300})-join"`n"
    if($logText-notmatch[regex]::Escape($ReleaseId)-or$logText-notmatch'WindowsServiceModeEnabled'-or$logText-notmatch'ServiceProcessStateRecorded'){throw 'Structured Windows Service startup evidence is absent.'}

    $crashUtc=[datetime]::UtcNow;$oldPid=[int]$firstProcess.Pid
    Stop-Process -Id $oldPid -Force -ErrorAction Stop
    $recoveryResult=Wait-ServiceHealthy 210
    if(-not$recoveryResult.Passed-or$recoveryResult.Process.Pid-eq$oldPid){throw 'SCM did not recover DEV 5054 with a new PID.'}
    if($recoveryResult.Process.Owner-ine$runtimeIdentity-or$recoveryResult.Process.Path-ine(Join-Path $releasePath 'DleOs.DevOperationalControlHost.exe')){throw 'SCM recovery returned the wrong identity or release.'}
    $events=ServiceEvents $crashUtc
    $result.CrashRecovery=[ordered]@{CrashUtc=$crashUtc;OldPid=$oldPid;NewProcess=$recoveryResult.Process;ScmEvents=$events;AutomaticRestartPassed=$true;StructuredRecoveryEvidencePassed=$false}
    if(@($events|Where-Object Id -in 7031,7034).Count-eq0){throw 'SCM did not record the controlled service-process failure.'}
    $logTextAfter=(Get-ChildItem -LiteralPath $logRoot -File -Filter 'dev5054-*.jsonl'|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 4|ForEach-Object{Get-Content -LiteralPath $_.FullName -Tail 500})-join"`n"
    if($logTextAfter-notmatch'PreviousServiceProcessExitedUnexpectedly'-or$logTextAfter-notmatch[regex]::Escape([string]$oldPid)){throw 'Durable structured recovery evidence does not identify the failed predecessor PID.'}
    $result.CrashRecovery.StructuredRecoveryEvidencePassed=$true

    $canonical=Probe 'http://127.0.0.1:5052/api/platform/live/v1/readiness' -Credentials;$guard=Probe 'http://127.0.0.1:5052/api/development/v1/security' -Credentials;$cb=if($canonical.Passed){$canonical.Body|ConvertFrom-Json}else{$null};$gb=if($guard.Passed){$guard.Body|ConvertFrom-Json}else{$null}
    $canonicalPassed=$canonical.Passed-and$cb.readinessVerdict-in@('Ready','ReadyFresh')-and$cb.database-eq'DLE_OS_CANONICAL_LIVE';$guardPassed=$guard.Passed-and$gb.verdict-eq'PASS'-and$gb.select-eq'PERMITTED'-and$gb.insert.result-eq'DENIED'-and$gb.update.result-eq'DENIED'-and$gb.delete.result-eq'DENIED'-and$gb.execute-eq'DENIED'
    $postServices=@('MSSQL$SQLEXPRESS','DleOsKeycloak','sshd','BrAmSvc','WinDefend','mpssvc','DleOsDevelopmentFrontend')|ForEach-Object{Get-Service $_|Select-Object Name,Status,StartType};$servicesPassed=@($postServices|Where-Object{$_.Status-ne'Running'-or$_.StartType-ne'Automatic'}).Count-eq0
    $postLive=@(Get-NetTCPConnection -State Listen|Where-Object LocalPort -in 5041,5042,5043|Select-Object LocalAddress,LocalPort,OwningProcess);$liveBefore=@($baseline.LiveListeners|ForEach-Object{"$($_.LocalAddress)|$($_.LocalPort)"}|Sort-Object);$liveAfter=@($postLive|ForEach-Object{"$($_.LocalAddress)|$($_.LocalPort)"}|Sort-Object);$liveUnchanged=(($liveBefore-join',')-ceq($liveAfter-join','))
    $sac=[int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState;$secureBoot=try{[bool](Confirm-SecureBootUEFI)}catch{$null};$defender=Get-MpComputerStatus|Select-Object AMServiceEnabled,AntivirusEnabled,BehaviorMonitorEnabled,RealTimeProtectionEnabled,IsTamperProtected
    $securityPassed=$sac-eq$baseline.SacState-and$secureBoot-eq$baseline.SecureBoot-and
        $defender.AMServiceEnabled-eq$baseline.Defender.AMServiceEnabled-and
        $defender.AntivirusEnabled-eq$baseline.Defender.AntivirusEnabled-and
        $defender.BehaviorMonitorEnabled-eq$baseline.Defender.BehaviorMonitorEnabled-and
        $defender.RealTimeProtectionEnabled-eq$baseline.Defender.RealTimeProtectionEnabled-and
        $defender.IsTamperProtected-eq$baseline.Defender.IsTamperProtected
    $keycloak=Probe 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration';$frontend=Probe 'http://dle-os-host:5051/shared';$finalOperations=Probe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history' -Credentials
    $ciPattern='DleOs\.DevOperationalControlHost|'+[regex]::Escape($ReleaseId)
    $ciEvents=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational';StartTime=$cutoverUtc.ToLocalTime()} -ErrorAction SilentlyContinue|Where-Object{$_.Id-eq3077-and$_.Message-match$ciPattern}|Select-Object TimeCreated,RecordId,Id,Message)
    $result.Regression=[ordered]@{Frontend5051=$frontend;Operations5051To5054=$finalOperations;Canonical5052=$canonical;CanonicalReadOnlyGuard=$guard;CanonicalParsed=$cb;GuardParsed=$gb;CanonicalPassed=$canonicalPassed;GuardPassed=$guardPassed;Keycloak=$keycloak;Services=$postServices;ServicesPassed=$servicesPassed;LiveListenersBefore=$baseline.LiveListeners;LiveListeners=$postLive;LiveUnchanged=$liveUnchanged;SacStateBefore=$baseline.SacState;SacState=$sac;SecureBootBefore=$baseline.SecureBoot;SecureBoot=$secureBoot;DefenderBefore=$baseline.Defender;Defender=$defender;SecurityUnchanged=$securityPassed;CodeIntegrity3077=$ciEvents}
    $failedRegression=@()
    if(-not$canonicalPassed){$failedRegression+='Canonical5052'};if(-not$guardPassed){$failedRegression+='CanonicalReadOnlyGuard'};if(-not$servicesPassed){$failedRegression+='RequiredServices'};if(-not$liveUnchanged){$failedRegression+='LiveListeners'};if(-not$securityPassed){$failedRegression+='SecurityState'};if(-not$keycloak.Passed){$failedRegression+='Keycloak'};if(-not$frontend.Passed){$failedRegression+='Frontend5051'};if(-not$finalOperations.Passed){$failedRegression+='Frontend5051To5054'};if($ciEvents.Count-ne0){$failedRegression+='CodeIntegrity3077'}
    $result.FailedRegressionConditions=$failedRegression
    if($failedRegression.Count-ne0){throw "Final regression failed: $($failedRegression-join', ')."}

    $null=Disable-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    Set-Service -Name $serviceName -StartupType Automatic
    $sc=@(& sc.exe config $serviceName 'start=' 'delayed-auto' 2>&1);if($LASTEXITCODE-ne0){throw "Delayed-auto service configuration failed: $($sc-join' ')"}
    $finalService=Get-CimInstance Win32_Service -Filter "Name='$serviceName'";$delayed=[int](Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName").DelayedAutoStart
    $finalCandidate=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName;$finalLegacy=Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
    if($finalService.State-ne'Running'-or$finalService.StartMode-ne'Auto'-or$delayed-ne1-or$finalCandidate.Settings.Enabled-or$finalLegacy.Settings.Enabled){throw 'Final single-owner startup disposition failed.'}
    if((XmlHash $legacyPath $legacyName)-cne$legacyHashBefore){throw 'The legacy task changed.'}

    $result.Preflight=[ordered]@{ManifestFileCount=@($manifest.files).Count;ManifestIntegrity=$true;RuntimeSid=$actualSid;RecoveryActions=@($recovery.Actions|Select-Object Type,DelayMilliseconds);Probes=$preflightProbes;CandidateHash=$candidateHashBefore;LegacyHash=$legacyHashBefore}
    $result.FinalDisposition=[ordered]@{ServiceState=$finalService.State;ServiceStartMode=$finalService.StartMode;DelayedAutoStart=$delayed;CandidateEnabled=[bool]$finalCandidate.Settings.Enabled;CandidateRetained=$true;CandidateAction=$finalCandidate.Actions[0];CandidateRestartCount=[int]$finalCandidate.Settings.RestartCount;LegacyEnabled=[bool]$finalLegacy.Settings.Enabled;SingleAutomaticOwner=$true}
    $result.Passed=$true
}catch{
    $result.Error=$_.Exception.Message;$result.ErrorDetail=[string]$_
    if($runtimeCutoverBegan){$result.RollbackInvoked=$true;Start-Fallback}
    throw
}finally{
    $result.CompletedUtc=[DateTimeOffset]::UtcNow
    if(-not(Test-Path -LiteralPath $runRoot)){try{$null=New-Item -ItemType Directory -Path $runRoot -Force}catch{}}
    try{$result|ConvertTo-Json -Depth 40|Set-Content -LiteralPath (Join-Path $runRoot 'phase2-service-cutover.json') -Encoding UTF8}catch{}
}

Write-Output (Join-Path $runRoot 'phase2-service-cutover.json')
