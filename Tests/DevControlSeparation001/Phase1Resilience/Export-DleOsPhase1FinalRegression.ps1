[CmdletBinding()]
param(
    [string]$OutputRoot='C:\DLE-OS\Qualification\DevResilience\Phase1',
    [string]$BaselineRoot='C:\DLE-OS\Qualification\DevResilience\Phase1\phase1-20260826T044745Z'
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)-or
   -not [string]::Equals($identity.Name,'DLE-OS-HOST\Miguel',[StringComparison]::OrdinalIgnoreCase)){
    throw 'Final Phase 1 regression requires an elevated DLE-OS-HOST\Miguel session.'
}

$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runRoot=Join-Path $OutputRoot ('phase1-final-regression-'+$stamp)
$null=New-Item -ItemType Directory -Path $runRoot -Force

function Invoke-WebProbe([string]$Uri,[switch]$UseDefaultCredentials){
    try{
        $parameters=@{Uri=$Uri;UseBasicParsing=$true;TimeoutSec=20}
        if($UseDefaultCredentials){$parameters.UseDefaultCredentials=$true}
        $response=Invoke-WebRequest @parameters
        [ordered]@{Passed=([int]$response.StatusCode-eq 200);Status=[int]$response.StatusCode;Uri=$Uri;Body=$response.Content}
    }catch{
        $status=$null
        if($_.Exception.Response){try{$status=[int]$_.Exception.Response.StatusCode}catch{}}
        [ordered]@{Passed=$false;Status=$status;Uri=$Uri;Error=$_.Exception.Message}
    }
}

function Invoke-SqlTable([string]$Query){
    $connection=New-Object System.Data.SqlClient.SqlConnection('Server=lpc:.\SQLEXPRESS;Database=master;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=15;Application Name=DLE-OS Phase1 Final ReadOnly Regression;')
    try{
        $connection.Open();$command=$connection.CreateCommand();$command.CommandText=$Query;$command.CommandTimeout=60
        $adapter=New-Object System.Data.SqlClient.SqlDataAdapter($command);$table=New-Object System.Data.DataTable;$null=$adapter.Fill($table)
        @($table.Rows|ForEach-Object{$row=[ordered]@{};foreach($column in $table.Columns){$value=$_[$column.ColumnName];$row[$column.ColumnName]=if($value-is[DBNull]){$null}else{$value}};[pscustomobject]$row})
    }finally{$connection.Dispose()}
}

function Get-TaskState([string]$TaskPath,[string]$TaskName,[string]$EvidenceName){
    $task=Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    $xml=Export-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    $path=Join-Path $runRoot $EvidenceName
    $xml|Set-Content -LiteralPath $path -Encoding Unicode
    [ordered]@{TaskPath=$TaskPath;TaskName=$TaskName;State=[string]$task.State;Enabled=[bool]$task.Settings.Enabled;ExecutionTimeLimit=[string]$task.Settings.ExecutionTimeLimit;XmlSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;Principal=$task.Principal.UserId;Actions=@($task.Actions|Select-Object Execute,Arguments,WorkingDirectory)}
}

$baseline=Get-Content -LiteralPath (Join-Path $BaselineRoot 'Regression\post-preservation-health.json') -Raw|ConvertFrom-Json
$taskBaseline=Get-Content -LiteralPath (Join-Path $BaselineRoot 'Tasks\task-preflight.json') -Raw|ConvertFrom-Json
$frontend=Invoke-WebProbe 'http://dle-os-host:5051/shared'
$canonical=Invoke-WebProbe 'http://127.0.0.1:5052/api/platform/live/v1/readiness' -UseDefaultCredentials
$guard=Invoke-WebProbe 'http://127.0.0.1:5052/api/development/v1/security' -UseDefaultCredentials
$operational=Invoke-WebProbe 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history' -UseDefaultCredentials
$keycloak=Invoke-WebProbe 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration'
$canonicalBody=if($canonical.Passed){$canonical.Body|ConvertFrom-Json}else{$null}
$guardBody=if($guard.Passed){$guard.Body|ConvertFrom-Json}else{$null}
$canonicalPassed=$canonical.Passed-and$canonicalBody.readinessVerdict-eq'Ready'-and$canonicalBody.database-eq'DLE_OS_CANONICAL_LIVE'
$guardPassed=$guard.Passed-and$guardBody.verdict-eq'PASS'-and$guardBody.select-eq'PERMITTED'-and$guardBody.insert.result-eq'DENIED'-and$guardBody.update.result-eq'DENIED'-and$guardBody.delete.result-eq'DENIED'-and$guardBody.execute-eq'DENIED'

$serviceNames=@('MSSQL$SQLEXPRESS','DleOsKeycloak','sshd','BrAmSvc','WinDefend','mpssvc','DleOsDevelopmentFrontend')
$services=@($serviceNames|ForEach-Object{Get-Service -Name $_ -ErrorAction Stop|Select-Object Name,Status,StartType})
$servicesPassed=@($services|Where-Object{$_.Status-ne'Running'-or$_.StartType-ne'Automatic'}).Count-eq 0
$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object{$_.LocalPort-in 22,5051,5052,5054,5041,5042,5043}|Select-Object LocalAddress,LocalPort,OwningProcess,State)
$portsPassed=@($listeners|Where-Object LocalPort -eq 22).Count-gt 0-and@($listeners|Where-Object LocalPort -eq 5051).Count-gt 0-and@($listeners|Where-Object LocalPort -eq 5052).Count-gt 0-and@($listeners|Where-Object LocalPort -eq 5054).Count-gt 0
$liveListeners=@($listeners|Where-Object{$_.LocalPort-in 5041,5042,5043})
$baselineLive=@($baseline.LiveListeners|ForEach-Object{"$($_.LocalAddress)|$($_.LocalPort)"}|Sort-Object)
$currentLive=@($liveListeners|ForEach-Object{"$($_.LocalAddress)|$($_.LocalPort)"}|Sort-Object)
$liveUnchanged=(($baselineLive-join ',')-ceq($currentLive-join ','))

$candidate=Get-TaskState '\' 'DLE-OS DEV Operational ControlHost 5054 Candidate' 'candidate-5054-task-final.xml'
$legacy=Get-TaskState '\DLE-OS\Development\' 'Operational ControlHost 5054' 'legacy-5054-task-final.xml'
$tasksPassed=$candidate.Enabled-and$candidate.State-eq'Running'-and$candidate.ExecutionTimeLimit-eq'PT0S'-and$candidate.XmlSha256-eq$taskBaseline.Candidate.XmlSha256-and
    (-not $legacy.Enabled)-and$legacy.State-eq'Disabled'-and$legacy.XmlSha256-eq$taskBaseline.Legacy.XmlSha256
$helperTasks=@(Get-ScheduledTask -ErrorAction SilentlyContinue|Where-Object{$_.TaskName-like'DLE-OS Phase1 SQL Restore Qualification *'})

$sql=Invoke-SqlTable "SET NOCOUNT ON; SELECT @@SERVERNAME ServerName,SUSER_SNAME() LoginName,CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) ProductVersion,(SELECT COUNT_BIG(*) FROM sys.databases WHERE name LIKE 'DLE[_]OS[_]%[_]DEV[_]RESTORE[_]TEST[_]%') RestoreTestDatabaseCount,(SELECT COUNT_BIG(*) FROM sys.databases WHERE name IN ('DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV') AND state_desc='ONLINE' AND user_access_desc='MULTI_USER') ActiveDevOnlineCount;"
$sqlPassed=@($sql).Count-eq 1-and[int64]$sql[0].RestoreTestDatabaseCount-eq 0-and[int64]$sql[0].ActiveDevOnlineCount-eq 2
$sacState=[int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
$secureBoot=try{[bool](Confirm-SecureBootUEFI)}catch{$null}
$deviceGuard=Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard|Select-Object VirtualizationBasedSecurityStatus,SecurityServicesConfigured,SecurityServicesRunning,CodeIntegrityPolicyEnforcementStatus,UsermodeCodeIntegrityPolicyEnforcementStatus
$defender=Get-MpComputerStatus|Select-Object AMServiceEnabled,AntivirusEnabled,BehaviorMonitorEnabled,RealTimeProtectionEnabled,IsTamperProtected,AntivirusSignatureLastUpdated
$defenderUnchanged=$defender.AMServiceEnabled-eq$baseline.Defender.AMServiceEnabled-and$defender.AntivirusEnabled-eq$baseline.Defender.AntivirusEnabled-and$defender.BehaviorMonitorEnabled-eq$baseline.Defender.BehaviorMonitorEnabled-and$defender.RealTimeProtectionEnabled-eq$baseline.Defender.RealTimeProtectionEnabled-and$defender.IsTamperProtected-eq$baseline.Defender.IsTamperProtected
$sshFirewall=@(Get-NetFirewallRule -DisplayName 'OpenSSH SSH Server (sshd)' -ErrorAction Stop|ForEach-Object{[ordered]@{Name=$_.Name;Enabled=[string]$_.Enabled;Direction=[string]$_.Direction;Action=[string]$_.Action;RemoteAddress=@(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $_|Select-Object -ExpandProperty RemoteAddress)}})
$sshFirewallPassed=@($sshFirewall|Where-Object{$_.Enabled-eq'True'-and$_.Direction-eq'Inbound'-and$_.Action-eq'Allow'-and(@($_.RemoteAddress)-join ',')-eq'192.168.0.0/255.255.255.0'}).Count-eq 1

$passed=$frontend.Passed-and$canonicalPassed-and$guardPassed-and$operational.Passed-and$keycloak.Passed-and$servicesPassed-and$portsPassed-and$liveUnchanged-and$tasksPassed-and$helperTasks.Count-eq 0-and$sqlPassed-and$sacState-eq[int]$baseline.SacState-and$secureBoot-eq[bool]$baseline.SecureBoot-and$defenderUnchanged-and$sshFirewallPassed
$result=[ordered]@{Schema='dle-os.phase1-final-regression.v1';CapturedUtc=[DateTimeOffset]::UtcNow;Identity=$identity.Name;Frontend5051=$frontend;Canonical5052=[ordered]@{Probe=$canonical;Parsed=$canonicalBody;Passed=$canonicalPassed};CanonicalReadOnlyGuard=[ordered]@{Probe=$guard;Parsed=$guardBody;Passed=$guardPassed};FrontendTo5054=$operational;Keycloak=$keycloak;Services=$services;ServicesPassed=$servicesPassed;Listeners=$listeners;RequiredPortsPassed=$portsPassed;LiveListeners=$liveListeners;LiveListenersUnchanged=$liveUnchanged;CandidateTask=$candidate;LegacyTask=$legacy;TasksUnchanged=$tasksPassed;Phase1HelperTasksRemaining=@($helperTasks|Select-Object TaskPath,TaskName,State);Sql=$sql;SqlPassed=$sqlPassed;SacState=$sacState;SacUnchanged=($sacState-eq[int]$baseline.SacState);SecureBoot=$secureBoot;DeviceGuard=$deviceGuard;Defender=$defender;DefenderStateUnchanged=$defenderUnchanged;SshFirewall=$sshFirewall;SshFirewallPassed=$sshFirewallPassed;Passed=$passed}
$path=Join-Path $runRoot 'phase1-final-regression.json'
$result|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $path -Encoding UTF8
if(-not $passed){throw "Phase 1 final regression failed: $path"}
Write-Output $path
