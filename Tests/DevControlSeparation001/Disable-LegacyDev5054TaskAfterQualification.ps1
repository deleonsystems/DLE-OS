[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw'Elevation required.'}
Start-Transcript -LiteralPath (Join-Path $PSScriptRoot 'dev5054-legacy-task-disposition.transcript.log') -Force|Out-Null
$candidatePath='\';$candidateName='DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath='\DLE-OS\Development\';$legacyName='Operational ControlHost 5054'
$release='C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$executable=Join-Path $release 'DleOs.DevOperationalControlHost.exe'
$expectedLegacyHash='A8599487E42C55F796CC24D499CBFD960DDDD7543CE258CCA2C38CA148342CE9'
$output=Join-Path $PSScriptRoot 'dev5054-legacy-task-disposition.json'
function HashText([string]$Text){$s=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($s.ComputeHash([Text.Encoding]::Unicode.GetBytes($Text)))).Replace('-','')}finally{$s.Dispose()}}
function WithoutEnabled([string]$Text){[xml]$x=$Text;$n=[Xml.XmlNamespaceManager]::new($x.NameTable);$n.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task');$node=$x.SelectSingleNode('/t:Task/t:Settings/t:Enabled',$n);if($node){[void]$node.ParentNode.RemoveChild($node)};$x.OuterXml}
function Probe([string]$Uri,[bool]$Json){try{if($Json){return [ordered]@{Passed=$true;Body=Invoke-RestMethod -Uri $Uri -TimeoutSec 15}};$r=Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 15;return [ordered]@{Passed=$r.StatusCode-eq200;Status=[int]$r.StatusCode}}catch{return [ordered]@{Passed=$false;Error=$_.Exception.Message}}}
$repair=Get-Content (Join-Path $PSScriptRoot 'dev5054-credential-task-repair.json') -Raw|ConvertFrom-Json
$state=Get-Content (Join-Path $PSScriptRoot 'dev5054-candidate-current-state.json') -Raw|ConvertFrom-Json
$negative=Get-Content (Join-Path $PSScriptRoot 'dev5054-negative-live-access.json') -Raw|ConvertFrom-Json
$elapsed=([DateTimeOffset]$state.CapturedUtc-[DateTimeOffset]$repair.StartedUtc).TotalSeconds
$candidate=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$processes=@(Get-CimInstance Win32_Process|Where-Object{$_.ExecutablePath-and$_.ExecutablePath-ieq$executable}|ForEach-Object{$o=Invoke-CimMethod -InputObject $_ -MethodName GetOwner;[ordered]@{ProcessId=[int]$_.ProcessId;CreationDate=$_.CreationDate;ExecutablePath=$_.ExecutablePath;Owner="$($o.Domain)\$($o.User)"}})
$legacyXmlBefore=Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyHashBefore=HashText $legacyXmlBefore
$readiness=Probe 'http://127.0.0.1:5052/api/platform/live/v1/readiness' $true;$guard=Probe 'http://127.0.0.1:5052/api/development/v1/security' $true;$frontend=Probe 'http://dle-os-host:5051/shared' $false;$keycloak=Probe 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration' $false
$services=@('WinDefend','BrAmSvc','mpssvc','sshd','MSSQL$SQLEXPRESS','DleOsKeycloak','DleOsDevelopmentFrontend')|ForEach-Object{Get-Service $_ -ErrorAction SilentlyContinue|Select-Object Name,Status,StartType}
$preflight=$repair.Passed-and$negative.Passed-and$elapsed-ge900-and$state.Processes[0].ProcessId-eq$repair.Processes[0].ProcessId-and$processes.Count-eq1-and$processes[0].ProcessId-eq$repair.Processes[0].ProcessId-and$processes[0].Owner-ieq'DLE-OS-HOST\DLE-OS-DEV-CONTROL'-and$candidate.State-eq'Running'-and$candidate.Settings.Enabled-and[string]$candidate.Settings.ExecutionTimeLimit-eq'PT0S'-and@(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue).Count-gt0-and$legacyHashBefore-eq$expectedLegacyHash-and$frontend.Passed-and$readiness.Passed-and$readiness.Body.readinessVerdict-eq'Ready'-and$guard.Passed-and$guard.Body.verdict-eq'PASS'-and$guard.Body.select-eq'PERMITTED'-and$guard.Body.insert.result-eq'DENIED'-and$guard.Body.update.result-eq'DENIED'-and$guard.Body.delete.result-eq'DENIED'-and$guard.Body.execute-eq'DENIED'-and$keycloak.Passed-and@($services|Where-Object{$_.Status-ne'Running'-or$_.StartType-ne'Automatic'}).Count-eq0-and[int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState-eq1
if(-not$preflight){throw'Final legacy-task disposition preflight failed; no task changed.'}
Disable-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName|Out-Null
$legacy=Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyXmlAfter=Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyHashAfter=HashText $legacyXmlAfter
$onlyEnabledChanged=(WithoutEnabled $legacyXmlBefore)-ceq(WithoutEnabled $legacyXmlAfter)
$startup5054=@(Get-ScheduledTask|Where-Object{$_.Settings.Enabled-and@($_.Actions|Where-Object{$_.Arguments-match'5054'}).Count-gt0-and@($_.Triggers|Where-Object{$_.CimClass.CimClassName-eq'MSFT_TaskBootTrigger'}).Count-gt0}|ForEach-Object{[ordered]@{TaskPath=$_.TaskPath;TaskName=$_.TaskName;State=[string]$_.State;Enabled=[bool]$_.Settings.Enabled;Actions=@($_.Actions|Select-Object Execute,Arguments,WorkingDirectory)}})
$candidateAfter=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$passed=$legacy.State-eq'Disabled' -and -not $legacy.Settings.Enabled -and $onlyEnabledChanged -and $candidateAfter.State-eq'Running' -and $candidateAfter.Settings.Enabled -and $startup5054.Count-eq1 -and $startup5054[0].TaskPath-eq'\' -and $startup5054[0].TaskName-eq$candidateName -and @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue).Count-gt0
$result=[ordered]@{Schema='dle-os.dev5054-legacy-task-disposition.v1';CapturedUtc=[DateTimeOffset]::UtcNow;ElevatedIdentity=$id.Name;PreflightPassed=$preflight;QualifiedElapsedSeconds=[Math]::Round($elapsed,1);CandidateProcess=$processes;CandidateState=[string]$candidateAfter.State;CandidateEnabled=[bool]$candidateAfter.Settings.Enabled;LegacyStateBefore='Ready';LegacyEnabledBefore=$true;LegacyHashBefore=$legacyHashBefore;LegacyStateAfter=[string]$legacy.State;LegacyEnabledAfter=[bool]$legacy.Settings.Enabled;LegacyHashAfter=$legacyHashAfter;OnlyLegacyEnabledFieldChanged=$onlyEnabledChanged;Enabled5054StartupTasks=$startup5054;Frontend=$frontend;CanonicalReadiness=$readiness;CanonicalGuard=$guard;Keycloak=$keycloak;Services=$services;Passed=$passed}
$result|ConvertTo-Json -Depth 14|Set-Content -LiteralPath $output -Encoding utf8
if(-not$passed){throw'Legacy task disposition did not reach the required final state.'}
