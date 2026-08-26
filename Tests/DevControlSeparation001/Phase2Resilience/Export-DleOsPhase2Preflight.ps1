[CmdletBinding()]
param(
    [string]$OutputRoot='C:\DLE-OS\Qualification\DevResilience\Phase2'
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)-or-not [string]::Equals($identity.Name,'DLE-OS-HOST\Miguel',[StringComparison]::OrdinalIgnoreCase)){throw 'Phase 2 preflight requires elevated DLE-OS-HOST\Miguel.'}
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runRoot=Join-Path $OutputRoot ('phase2-preflight-'+$stamp)
$null=New-Item -ItemType Directory -Path $runRoot -Force

function Get-Events([string]$LogName,[int[]]$Ids,[datetime]$Start,[string]$Pattern){
    try{
        $filter=@{LogName=$LogName;StartTime=$Start}
        if($Ids.Count-gt 0){$filter.Id=$Ids}
        @(Get-WinEvent -FilterHashtable $filter -ErrorAction Stop|Where-Object{$_.Message-match$Pattern}|Select-Object -First 200 TimeCreated,Id,LevelDisplayName,ProviderName,ProcessId,Message)
    }catch{@([pscustomobject]@{Error=$_.Exception.Message;LogName=$LogName})}
}
function Probe([string]$Uri,[switch]$Credentials){try{$p=@{Uri=$Uri;UseBasicParsing=$true;TimeoutSec=15};if($Credentials){$p.UseDefaultCredentials=$true};$r=Invoke-WebRequest @p;[ordered]@{Status=[int]$r.StatusCode;Passed=([int]$r.StatusCode-eq 200);Body=$r.Content}}catch{[ordered]@{Passed=$false;Error=$_.Exception.Message}}}

$taskPath='\';$taskName='DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath='\DLE-OS\Development\';$legacyName='Operational ControlHost 5054'
$task=Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName
$taskInfo=Get-ScheduledTaskInfo -TaskPath $taskPath -TaskName $taskName
$taskXmlPath=Join-Path $runRoot 'candidate-task-before.xml'
Export-ScheduledTask -TaskPath $taskPath -TaskName $taskName|Set-Content -LiteralPath $taskXmlPath -Encoding Unicode
$legacy=Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
$legacyXmlPath=Join-Path $runRoot 'legacy-task-before.xml'
Export-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName|Set-Content -LiteralPath $legacyXmlPath -Encoding Unicode
$action=@($task.Actions)[0]
$releasePath=[string]$action.WorkingDirectory
$releaseId=Split-Path -Leaf $releasePath
$manifestPath=Join-Path 'C:\DLE-OS\Development\OperationalControlHost5054\Manifests' ($releaseId+'.json')
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
$fileChecks=@($manifest.files|ForEach-Object{$path=Join-Path $releasePath $_.relativePath;[pscustomobject]@{RelativePath=$_.relativePath;ExpectedSha256=$_.sha256;ActualSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;ExpectedLength=[int64]$_.length;ActualLength=(Get-Item -LiteralPath $path).Length}})

$listener=Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue|Select-Object -First 1
$process=$null
if($listener){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)";$owner=Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue;$process=[ordered]@{Pid=[int]$p.ProcessId;Name=$p.Name;ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine;ParentPid=[int]$p.ParentProcessId;CreationDate=$p.CreationDate;Owner=if($owner){$owner.Domain+'\'+$owner.User}else{$null};WorkingSet=(Get-Process -Id $p.ProcessId).WorkingSet64}}
$start=[datetime]::UtcNow.AddDays(-14)
$taskEvents=Get-Events 'Microsoft-Windows-TaskScheduler/Operational' @(100,101,102,103,107,110,111,129,200,201,203,322,323,329) $start '5054 Candidate|DLE-OS DEV Operational'
$appEvents=Get-Events 'Application' @(1000,1001,1026) $start 'DleOs.DevOperationalControlHost|5054'
$ciEvents=Get-Events 'Microsoft-Windows-CodeIntegrity/Operational' @(3033,3034,3076,3077,3089) $start 'DleOs.DevOperationalControlHost|OperationalControlHost5054'
$defenderEvents=Get-Events 'Microsoft-Windows-Windows Defender/Operational' @() $start 'DleOs.DevOperationalControlHost|OperationalControlHost5054|5054'
$hpLogs=@(Get-WinEvent -ListLog '*HP*' -ErrorAction SilentlyContinue|Where-Object{$_.IsEnabled}|Select-Object -ExpandProperty LogName)
$hpEvents=@($hpLogs|ForEach-Object{Get-Events $_ @() $start 'DleOs.DevOperationalControlHost|OperationalControlHost5054|5054'})
$logRoots=@('C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs','C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Logs')
$logs=@($logRoots|ForEach-Object{if(Test-Path -LiteralPath $_){Get-ChildItem -LiteralPath $_ -File -Recurse -Force|Select-Object FullName,Length,CreationTimeUtc,LastWriteTimeUtc}})
$sourceProgram='C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\DleOs.DevOperationalControlHost\Program.cs'
$releaseLauncher=Join-Path $releasePath 'Start-DevOperationalControlHost5054.ps1'
$sourceText=Get-Content -LiteralPath $sourceProgram -Raw
$launcherText=Get-Content -LiteralPath $releaseLauncher -Raw
$health=Probe 'http://dle-os-host:5054/health' -Credentials
$frontendTo5054=Probe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history' -Credentials
$canonical=Probe 'http://127.0.0.1:5052/api/platform/live/v1/readiness' -Credentials
$guard=Probe 'http://127.0.0.1:5052/api/development/v1/security' -Credentials
$result=[ordered]@{
 Schema='dle-os.phase2-preflight.v1';CapturedUtc=[DateTimeOffset]::UtcNow;Identity=$identity.Name
 CandidateTask=[ordered]@{State=[string]$task.State;Enabled=[bool]$task.Settings.Enabled;RestartCount=[int]$task.Settings.RestartCount;RestartInterval=[string]$task.Settings.RestartInterval;MultipleInstances=[string]$task.Settings.MultipleInstances;ExecutionTimeLimit=[string]$task.Settings.ExecutionTimeLimit;StartWhenAvailable=[bool]$task.Settings.StartWhenAvailable;AllowDemandStart=[bool]$task.Settings.AllowDemandStart;Principal=$task.Principal|Select-Object UserId,LogonType,RunLevel;Triggers=$task.Triggers|Select-Object *;Actions=$task.Actions|Select-Object Execute,Arguments,WorkingDirectory;LastRunTime=$taskInfo.LastRunTime;LastTaskResult=[int64]$taskInfo.LastTaskResult;XmlPath=$taskXmlPath;XmlSha256=(Get-FileHash -LiteralPath $taskXmlPath -Algorithm SHA256).Hash}
 LegacyTask=[ordered]@{State=[string]$legacy.State;Enabled=[bool]$legacy.Settings.Enabled;XmlPath=$legacyXmlPath;XmlSha256=(Get-FileHash -LiteralPath $legacyXmlPath -Algorithm SHA256).Hash}
 RuntimeProcess=$process;Listener5054=$listener;ReleaseId=$releaseId;ReleasePath=$releasePath;ManifestPath=$manifestPath;ManifestSha256=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash;ManifestFileCount=@($manifest.files).Count;ReleaseIntegrityPassed=(@($fileChecks|Where-Object{$_.ExpectedSha256-ne$_.ActualSha256-or$_.ExpectedLength-ne$_.ActualLength}).Count-eq 0);ReleaseFiles=$fileChecks
 Logging=[ordered]@{ApplicationProviders=@('Console');ClearProvidersPresent=$sourceText.Contains('builder.Logging.ClearProviders()');ConsoleProviderPresent=$sourceText.Contains('builder.Logging.AddConsole()');StructuredDurableProviderPresent=($sourceText-match'Json|FileLogger|DevOnly\\Logs');LauncherRedirectsOutput=($launcherText-match'RedirectStandard|2>|Out-File|Tee-Object');ExistingLogRoots=$logRoots;ExistingFiles=$logs}
 Health=[ordered]@{Direct5054=$health;Frontend5051To5054=$frontendTo5054;Canonical5052=$canonical;CanonicalGuard=$guard}
 Correlation=[ordered]@{HttpTraceIdentifierInProgram=$sourceText.Contains('TraceIdentifier');CorrelationHeaderInProgram=$sourceText.Contains('X-DLE-OS-Correlation-ID');AuthenticatedActorRequestLoggingInProgram=($sourceText-match'User.Identity.*Log|Log.*User.Identity')}
 Events=[ordered]@{TaskScheduler=$taskEvents;Application=$appEvents;CodeIntegrity=$ciEvents;Defender=$defenderEvents;HpLogNames=$hpLogs;Hp=$hpEvents}
 ReadOnly=$true;ChangesMade=$false
}
$path=Join-Path $runRoot 'phase2-preflight.json'
$result|ConvertTo-Json -Depth 35|Set-Content -LiteralPath $path -Encoding UTF8
Write-Output $path
