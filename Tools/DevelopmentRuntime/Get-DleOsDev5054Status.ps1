[CmdletBinding()]
param([string]$OutputPath)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$candidatePath='\';$candidateName='DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath='\DLE-OS\Development\';$legacyName='Operational ControlHost 5054'
$logRoot='C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs'

function Probe([string]$Uri){try{$r=Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -Uri $Uri -TimeoutSec 15;[ordered]@{Passed=([int]$r.StatusCode-eq 200);Status=[int]$r.StatusCode;Body=$r.Content}}catch{[ordered]@{Passed=$false;Error=$_.Exception.Message}}}
$candidate=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
$candidateInfo=Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName
$legacy=Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$action=@($candidate.Actions)[0]
$releasePath=[string]$action.WorkingDirectory
$releaseId=Split-Path -Leaf $releasePath
$manifestPath=Join-Path 'C:\DLE-OS\Development\OperationalControlHost5054\Manifests' ($releaseId+'.json')
$manifest=$null;$releaseChecks=@();$releaseValid=$false
try{$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json;$releaseChecks=@($manifest.files|ForEach-Object{$path=Join-Path $releasePath $_.relativePath;[pscustomobject]@{RelativePath=$_.relativePath;Exists=(Test-Path -LiteralPath $path -PathType Leaf);ExpectedSha256=$_.sha256;ActualSha256=if(Test-Path -LiteralPath $path -PathType Leaf){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}else{$null};ExpectedLength=[int64]$_.length;ActualLength=if(Test-Path -LiteralPath $path -PathType Leaf){(Get-Item -LiteralPath $path).Length}else{$null}}});$releaseValid=@($releaseChecks|Where-Object{-not$_.Exists-or$_.ExpectedSha256-ne$_.ActualSha256-or$_.ExpectedLength-ne$_.ActualLength}).Count-eq 0}catch{}
$executable=Join-Path $releasePath 'DleOs.DevOperationalControlHost.exe'
$processes=@()
try{$processes=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{$_.ExecutablePath-and[string]::Equals($_.ExecutablePath,$executable,[StringComparison]::OrdinalIgnoreCase)}|ForEach-Object{$owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue;[pscustomobject]@{Pid=[int]$_.ProcessId;ParentPid=[int]$_.ParentProcessId;StartTime=$_.CreationDate;ExecutablePath=$_.ExecutablePath;CommandLine=$_.CommandLine;Owner=if($owner.ReturnValue-eq0){$owner.Domain+'\'+$owner.User}else{$null}}})}catch{$processes=@(Get-Process -Name 'DleOs.DevOperationalControlHost' -ErrorAction SilentlyContinue|Select-Object @{N='Pid';E={$_.Id}},StartTime,@{N='ExecutablePath';E={$executable}},@{N='Owner';E={$candidate.Principal.UserId}})}
$logFiles=@(Get-ChildItem -LiteralPath $logRoot -File -Filter 'dev5054-*.jsonl' -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending)
$events=@();foreach($file in @($logFiles|Select-Object -First 5)){foreach($line in @(Get-Content -LiteralPath $file.FullName -Tail 500 -ErrorAction SilentlyContinue)){try{$events+=($line|ConvertFrom-Json)}catch{}}}
function LatestEvent([string[]]$Names){@($events|Where-Object{$_.eventName-in$Names}|Sort-Object {[datetimeoffset]$_.timestampUtc} -Descending|Select-Object -First 1)}
$taskEvents=@();try{$taskEvents=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational';StartTime=[datetime]::UtcNow.AddDays(-2)} -ErrorAction Stop|Where-Object{$_.Message-match[regex]::Escape($candidateName)}|Select-Object -First 50 TimeCreated,Id,LevelDisplayName,Message)}catch{}
$listener=@(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue|Select-Object LocalAddress,LocalPort,OwningProcess)
$result=[ordered]@{
 Schema='dle-os.dev5054-status.v1';CapturedUtc=[DateTimeOffset]::UtcNow;ReadOnly=$true
 CandidateTask=[ordered]@{Enabled=[bool]$candidate.Settings.Enabled;State=[string]$candidate.State;Principal=$candidate.Principal.UserId;LogonType=[string]$candidate.Principal.LogonType;RestartCount=[int]$candidate.Settings.RestartCount;RestartInterval=[string]$candidate.Settings.RestartInterval;ExecutionTimeLimit=[string]$candidate.Settings.ExecutionTimeLimit;MultipleInstances=[string]$candidate.Settings.MultipleInstances;LastRunTime=$candidateInfo.LastRunTime;LastTaskResult=[int64]$candidateInfo.LastTaskResult}
 LegacyTask=[ordered]@{Enabled=[bool]$legacy.Settings.Enabled;State=[string]$legacy.State}
 Runtime=[ordered]@{ReleaseId=$releaseId;ReleasePath=$releasePath;ManifestPath=$manifestPath;ManifestFileCount=if($manifest){@($manifest.files).Count}else{0};ManifestValid=$releaseValid;Processes=$processes;Listener5054=$listener;ExpectedIdentity=$candidate.Principal.UserId}
 Health=[ordered]@{Frontend5051To5054=Probe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history';Canonical5052=Probe 'http://127.0.0.1:5052/api/platform/live/v1/readiness';CanonicalGuard=Probe 'http://127.0.0.1:5052/api/development/v1/security'}
 Logs=[ordered]@{Root=$logRoot;Files=@($logFiles|Select-Object FullName,Length,CreationTimeUtc,LastWriteTimeUtc);LatestStartup=LatestEvent @('ApplicationStarted','LauncherStartup');LatestShutdown=LatestEvent @('ApplicationStopping','ApplicationStopped','ProcessExit','ExecutableExited');LatestFatal=LatestEvent @('ApplicationFatal','UnhandledException','LauncherFatal','StartupValidationFailed');LatestRequest=LatestEvent @('RequestCompleted','RequestFailed')}
 RestartEvents=$taskEvents
}
$json=$result|ConvertTo-Json -Depth 25
if($OutputPath){$parent=Split-Path -Parent $OutputPath;if($parent){$null=New-Item -ItemType Directory -Path $parent -Force};$json|Set-Content -LiteralPath $OutputPath -Encoding UTF8}
$json
