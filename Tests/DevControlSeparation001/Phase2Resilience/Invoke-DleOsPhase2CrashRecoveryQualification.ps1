[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$')]
    [string]$ReleaseId,
    [string]$EvidenceRoot='C:\DLE-OS\Qualification\DevResilience\Phase2'
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)-or
   -not [string]::Equals($identity.Name,'DLE-OS-HOST\Miguel',[StringComparison]::OrdinalIgnoreCase)){
    throw 'Phase 2 crash qualification requires elevated DLE-OS-HOST\Miguel.'
}

$candidatePath='\'
$candidateName='DLE-OS DEV Operational ControlHost 5054 Candidate'
$runtimeIdentity='DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$release="C:\DLE-OS\Development\OperationalControlHost5054\Releases\$ReleaseId"
$manifestPath="C:\DLE-OS\Development\OperationalControlHost5054\Manifests\$ReleaseId.json"
$logRoot='C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs'
$failureRoot='C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\FailureEvidence'
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runRoot=Join-Path $EvidenceRoot ('phase2-crash-qualification-'+$stamp)
$null=New-Item -ItemType Directory -Path $runRoot -Force
Start-Transcript -LiteralPath (Join-Path $runRoot 'crash-qualification-transcript.log') -Force|Out-Null
$result=[ordered]@{Schema='dle-os.phase2-crash-recovery.v1';StartedUtc=[DateTimeOffset]::UtcNow;ReleaseId=$ReleaseId;Passed=$false}

function Probe([string]$Uri){
    try{$r=Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -Uri $Uri -TimeoutSec 20;[ordered]@{Passed=([int]$r.StatusCode-eq200);Status=[int]$r.StatusCode;Body=$r.Content}}
    catch{[ordered]@{Passed=$false;Error=$_.Exception.Message}}
}
function ExactProcess {
    $exe=Join-Path $release 'DleOs.DevOperationalControlHost.exe'
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath-and[string]::Equals($_.ExecutablePath,$exe,[StringComparison]::OrdinalIgnoreCase)}|ForEach-Object{
        $owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
        [pscustomobject]@{Pid=[int]$_.ProcessId;ParentPid=[int]$_.ParentProcessId;Started=$_.CreationDate;Path=$_.ExecutablePath;Owner=if($owner.ReturnValue-eq0){$owner.Domain+'\'+$owner.User}else{$null}}
    })
}
function AssertManifest {
    $manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
    $actual=@(Get-ChildItem -LiteralPath $release -File -Recurse -Force)
    if($actual.Count-ne@($manifest.files).Count){throw 'Release file count no longer matches its immutable manifest.'}
    foreach($entry in $manifest.files){
        $file=Join-Path $release $entry.relativePath
        if(-not(Test-Path -LiteralPath $file -PathType Leaf)-or(Get-Item -LiteralPath $file).Length-ne[int64]$entry.length-or(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash-ne$entry.sha256){throw "Release manifest mismatch: $($entry.relativePath)"}
    }
    $manifest
}

try{
    $manifest=AssertManifest
    $task=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    $taskXml=Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    $legacyXml=Export-ScheduledTask -TaskPath '\DLE-OS\Development\' -TaskName 'Operational ControlHost 5054'
    $before=@(ExactProcess)
    if($before.Count-ne1-or$before[0].Owner-ine$runtimeIdentity-or[string]$task.Settings.RestartCount-ne'4'-or[string]$task.Settings.RestartInterval-ne'PT2M'-or[string]$task.Settings.ExecutionTimeLimit-ne'PT0S'-or[string]$task.Settings.MultipleInstances-ne'IgnoreNew'){throw 'The activated candidate is not at the approved Phase 2 baseline.'}
    if((Probe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history').Passed-ne$true){throw '5051 to 5054 pre-crash qualification failed.'}

    $oldFailureFolders=@(Get-ChildItem -LiteralPath $failureRoot -Directory -ErrorAction SilentlyContinue|Select-Object -ExpandProperty FullName)
    for($index=0;$index-lt16;$index++){
        $path=Join-Path $logRoot ("dev5054-qualification-{0:D2}.jsonl"-f$index)
        '{"eventName":"Phase2RetentionQualification","secret":"[REDACTED]"}'|Set-Content -LiteralPath $path -Encoding UTF8
        if($index-eq0){(Get-Item -LiteralPath $path).LastWriteTimeUtc=[DateTime]::UtcNow.AddDays(-15)}
    }
    $active=Join-Path $logRoot 'dev5054-current.jsonl'
    $line=[Text.Encoding]::UTF8.GetBytes(('{"eventName":"Phase2CrashMarker","releaseId":"'+$ReleaseId+'","padding":"'+('x'*1800)+'"}'+[Environment]::NewLine))
    $stream=[IO.File]::Open($active,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite)
    try{while($stream.Length-lt(10MB+4096)){$stream.Write($line,0,$line.Length)};$stream.Flush($true)}finally{$stream.Dispose()}
    $preCrashLogSize=(Get-Item -LiteralPath $active).Length
    $oldPid=$before[0].Pid
    $crashUtc=[DateTimeOffset]::UtcNow
    Stop-Process -Id $oldPid -Force -ErrorAction Stop

    $deadline=(Get-Date).AddMinutes(4)
    $after=@()
    do{Start-Sleep -Seconds 5;$after=@(ExactProcess)}until(($after.Count-eq1-and$after[0].Pid-ne$oldPid)-or(Get-Date)-ge$deadline)
    if($after.Count-ne1-or$after[0].Pid-eq$oldPid-or$after[0].Owner-ine$runtimeIdentity){throw 'Task Scheduler did not recover the exact Phase 2 release under the expected identity.'}
    $recoverySeconds=[Math]::Round(([DateTimeOffset]::UtcNow-$crashUtc).TotalSeconds,1)
    $frontendTo5054=Probe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history'
    if(-not$frontendTo5054.Passed){throw '5051 to 5054 did not recover.'}

    $deadline=(Get-Date).AddSeconds(30)
    do{Start-Sleep -Seconds 2;$logFiles=@(Get-ChildItem -LiteralPath $logRoot -File -Filter 'dev5054-*.jsonl' -ErrorAction SilentlyContinue);$logTail=@($logFiles|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 4|ForEach-Object{Get-Content -LiteralPath $_.FullName -Tail 80 -ErrorAction SilentlyContinue})-join"`n"}until(($logTail-match[regex]::Escape($ReleaseId)-and$logTail-match'ApplicationStarted')-or(Get-Date)-ge$deadline)
    $archives=@($logFiles|Where-Object Name -ne'dev5054-current.jsonl')
    $oldSyntheticRemaining=@($archives|Where-Object Name -like'dev5054-qualification-*')
    $retentionPassed=$archives.Count-le14-and$oldSyntheticRemaining.Count-eq0-and@($archives|Where-Object LastWriteTimeUtc -lt([DateTime]::UtcNow.AddDays(-14))).Count-eq0
    $logPassed=$retentionPassed-and$logTail-match[regex]::Escape($ReleaseId)-and$logTail-match'ApplicationStarted'-and@($archives|Where-Object Length -ge10MB).Count-gt0
    if(-not$logPassed){throw 'Durable crash/restart logging or bounded retention qualification failed.'}

    $failureDeadline=(Get-Date).AddSeconds(45)
    do{Start-Sleep -Seconds 3;$newFailureFolders=@(Get-ChildItem -LiteralPath $failureRoot -Directory -ErrorAction SilentlyContinue|Where-Object FullName -notin$oldFailureFolders)}until($newFailureFolders.Count-gt0-or(Get-Date)-ge$failureDeadline)
    $taskAfter=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    $taskXmlAfter=Export-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    $legacyXmlAfter=Export-ScheduledTask -TaskPath '\DLE-OS\Development\' -TaskName 'Operational ControlHost 5054'
    if($taskXmlAfter-cne$taskXml-or$legacyXmlAfter-cne$legacyXml){throw 'A scheduled task changed during crash recovery qualification.'}
    $integrity=AssertManifest
    $result.OldProcess=$before[0];$result.NewProcess=$after[0];$result.RecoverySeconds=$recoverySeconds
    $result.RestartPolicy=[ordered]@{Count=[int]$taskAfter.Settings.RestartCount;Interval=[string]$taskAfter.Settings.RestartInterval;ExecutionTimeLimit=[string]$taskAfter.Settings.ExecutionTimeLimit;MultipleInstances=[string]$taskAfter.Settings.MultipleInstances;Bounded=$true}
    $result.Logging=[ordered]@{PreCrashActiveBytes=$preCrashLogSize;Files=@($logFiles|Select-Object Name,Length,CreationTimeUtc,LastWriteTimeUtc);ArchiveCount=$archives.Count;RetentionPassed=$retentionPassed;CrashMarkerSurvived=@($archives|Where-Object Length -ge10MB).Count-gt0;PostRecoveryStartupObserved=$logTail-match'ApplicationStarted';Passed=$logPassed}
    $result.FailureEvidence=[ordered]@{NewFolders=@($newFailureFolders|Select-Object FullName,CreationTimeUtc);WatcherProducedEvidence=$newFailureFolders.Count-gt0}
    $result.FrontendTo5054=$frontendTo5054;$result.ManifestFileCount=@($integrity.files).Count;$result.Passed=$true
}finally{
    $result.CompletedUtc=[DateTimeOffset]::UtcNow
    $result|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $runRoot 'phase2-crash-recovery.json') -Encoding UTF8
    Stop-Transcript|Out-Null
}
if(-not$result.Passed){throw "Phase 2 crash qualification failed: $runRoot"}
$result|ConvertTo-Json -Depth 12
