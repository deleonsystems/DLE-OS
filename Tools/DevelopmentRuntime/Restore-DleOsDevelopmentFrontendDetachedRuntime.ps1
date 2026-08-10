[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param(
    [Parameter(Mandatory)]
    [ValidateScript({Test-Path -LiteralPath $_ -PathType Leaf})]
    [string]$MigrationEvidencePath,

    [Parameter(Mandatory)]
    [switch]$ApproveRollback,

    [Parameter(Mandatory)]
    [Management.Automation.PSCredential]$SqlAdministratorCredential
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$serviceName='DleOsDevelopmentFrontend';$account='DLE-OS-DEV-FRONTEND';$identity="DLE-OS-HOST\$account";$legacyIdentity='DLE-OS-HOST\DLE-OS';$legacyTaskName='DLE-OS Development Authenticated Frontend 5051'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$runtime=Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\bin\Release\net8.0-windows'
$startScript=Join-Path $repository 'Tools\DevelopmentRuntime\Start-DevelopmentFrontend.ps1'
$sqlBootstrap=Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDevelopmentFrontendSqlBootstrap.ps1'
$rightsSource=Join-Path $repository 'Tools\DevelopmentRuntime\DleOsServiceAccountRights.cs'
$migration=Get-Content -Raw -LiteralPath $MigrationEvidencePath|ConvertFrom-Json
$migrationRoot=Split-Path -Parent $MigrationEvidencePath;$rollbackRuntime=Join-Path $migrationRoot 'rollback-detached-runtime'
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ');$evidencePath=Join-Path $repository ".tmp\windows-service-rollback\$stamp\rollback.json"
$protectedPorts=5041,5042,5043,5052,5053,5054
$evidence=[ordered]@{StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');MigrationEvidencePath=(Resolve-Path $MigrationEvidencePath).Path;ServiceName=$serviceName;RestoredMechanism='ScheduledTaskLaunchDetachedWorker';ScheduledTaskCreated=$false;ProductionDeploymentPerformed=$false;KeycloakMetadataChanged=$false;FileServerRollbackRequired=$true}

function Invoke-Native([string]$File,[string[]]$Arguments){$output=&$File @Arguments 2>&1|Out-String;if($LASTEXITCODE-ne 0){throw "$File failed ($LASTEXITCODE): $output"};$output}
function Get-Owners([int]$Port){@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess|Sort-Object -Unique)}
function Get-Protected{$r=[ordered]@{};foreach($p in $protectedPorts){$r[[string]$p]=@(Get-Owners $p)};$r}
function Get-Workers{@(Get-CimInstance Win32_Process -Filter "Name='dotnet.exe' OR Name='DleOs.DevelopmentFrontend.exe'"|Where-Object{$_.CommandLine-like'*DleOs.DevelopmentFrontend*'})}
function Restore-UrlAcls([object[]]$Snapshots){foreach($s in $Snapshots){&netsh.exe http delete urlacl "url=$($s.Url)" 2>&1|Out-Null;if($s.Exists){$null=Invoke-Native netsh.exe @('http','add','urlacl',"url=$($s.Url)","sddl=$($s.Sddl)")}}}
function Restore-Acls([object[]]$Snapshots){foreach($s in $Snapshots){if(Test-Path $s.Path){$acl=Get-Acl $s.Path;$acl.SetSecurityDescriptorSddlForm([string]$s.Sddl,[Security.AccessControl.AccessControlSections]::All);Set-Acl $s.Path $acl}}}
function Remove-SqlPrincipal{$result=Join-Path(Split-Path $evidencePath -Parent)'sql-remove.json';$args=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"{0}"'-f$sqlBootstrap),'-Mode','Remove','-ResultPath',('"{0}"'-f$result));$p=Start-Process powershell.exe -Credential $SqlAdministratorCredential -ArgumentList $args -WindowStyle Hidden -Wait -PassThru;if($p.ExitCode-ne 0){throw 'DEV SQL principal rollback failed.'}}
function Start-DetachedRuntime{$args=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"{0}"'-f$startScript));$p=Start-Process powershell.exe -Credential $SqlAdministratorCredential -ArgumentList $args -WindowStyle Hidden -Wait -PassThru;if($p.ExitCode-ne 0){throw 'Detached runtime launcher failed.'};$deadline=[DateTimeOffset]::UtcNow.AddSeconds(45);do{$w=@(Get-Workers);if($w.Count-eq 1){return $w[0]};Start-Sleep -Milliseconds 250}while([DateTimeOffset]::UtcNow-lt$deadline);throw 'Exactly one detached rollback worker was not restored.'}
function Get-OptionalPropertyValue([object]$Object,[string]$Name,[object]$Default=$null){$property=$Object.PSObject.Properties[$Name];if($null-eq$property){return $Default};$property.Value}
function Restore-LegacyTaskState{
    $baseline=$migration.RollbackBaseline.ScheduledTask;$task=Get-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.Path -ErrorAction Stop;$actions=@($task.Actions)
    $principalName=if([string]$task.Principal.UserId-like'S-1-*'){([Security.Principal.SecurityIdentifier]$task.Principal.UserId).Translate([Security.Principal.NTAccount]).Value}else{[string]$task.Principal.UserId}
    if($actions.Count-ne 1-or[string](Get-OptionalPropertyValue $actions[0] 'Execute' '')-ine$baseline.Execute-or[string](Get-OptionalPropertyValue $actions[0] 'Arguments' '')-cne$baseline.Arguments-or[string](Get-OptionalPropertyValue $actions[0] 'WorkingDirectory' '')-cne[string]$baseline.WorkingDirectory-or$principalName-ine$baseline.Principal){throw 'The retained legacy Scheduled Task no longer matches the captured rollback baseline.'}
    if([bool]$baseline.Enabled){Enable-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.Path|Out-Null}else{Disable-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.Path|Out-Null}
    $after=Get-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.Path;if([bool]$after.Settings.Enabled-ne[bool]$baseline.Enabled){throw 'The legacy Scheduled Task enabled state was not restored.'}
    $evidence.ScheduledTaskRestored=[pscustomobject]@{Name=$legacyTaskName;Enabled=[bool]$after.Settings.Enabled;State=[string]$after.State}
}

New-Item -ItemType Directory -Path (Split-Path $evidencePath -Parent) -Force|Out-Null
try{
    $current=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=[Security.Principal.WindowsPrincipal]::new($current);if(-not$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Rollback requires elevation.'}
    if(-not$ApproveRollback){throw 'Explicit -ApproveRollback is required.'};if($SqlAdministratorCredential.UserName-ine$legacyIdentity){throw "Rollback credential must be $legacyIdentity."}
    if($migration.RollbackBaseline.Mechanism-cne'ScheduledTaskLaunchDetachedWorker'-or-not$migration.RollbackBaseline.ScheduledTaskPresent){throw 'Migration evidence does not contain the exact task-launched detached-runtime baseline.'}
    $legacyTask=Get-ScheduledTask -TaskName $legacyTaskName -TaskPath $migration.RollbackBaseline.ScheduledTask.Path -ErrorAction Stop;if([bool]$legacyTask.Settings.Enabled-or[string]$legacyTask.State-eq'Running'){throw 'The retained legacy Scheduled Task must be disabled before service rollback.'}
    if(-not$PSCmdlet.ShouldProcess($serviceName,'remove the DEV service and restore the prior detached runtime')){throw 'Rollback approval was declined.'}
    $evidence.ProtectedBefore=Get-Protected
    if(Get-Service $serviceName -ErrorAction SilentlyContinue){Stop-Service $serviceName -Force -ErrorAction SilentlyContinue;foreach($w in @(Get-Workers)){Stop-Process $w.ProcessId -Force};$null=Invoke-Native sc.exe @('delete',$serviceName)}
    Restore-UrlAcls @($migration.UrlAclBefore);Restore-Acls @($migration.FileSystemAclBefore)
    if(-not(Test-Path $rollbackRuntime)){throw 'The captured detached runtime is absent.'};Copy-Item -Path (Join-Path $rollbackRuntime '*') -Destination $runtime -Recurse -Force
    if($migration.SqlPrincipalCreated){Remove-SqlPrincipal}
    Add-Type -Path $rightsSource
    if($migration.DenyRemoteInteractiveRightAdded){[DleOsServiceAccountRights]::RemoveRight($identity,'SeDenyRemoteInteractiveLogonRight')}
    if($migration.DenyInteractiveRightAdded){[DleOsServiceAccountRights]::RemoveRight($identity,'SeDenyInteractiveLogonRight')}
    if($migration.ServiceLogonRightAdded){[DleOsServiceAccountRights]::RemoveRight($identity,'SeServiceLogonRight')}
    if(Get-LocalUser $account -ErrorAction SilentlyContinue){Remove-LocalUser $account}
    $worker=Start-DetachedRuntime;$evidence.RestoredWorkerId=[int]$worker.ProcessId;Restore-LegacyTaskState
    $evidence.ProtectedAfter=Get-Protected;foreach($p in $protectedPorts){if(($evidence.ProtectedBefore[[string]$p]-join',')-ne($evidence.ProtectedAfter[[string]$p]-join',')){throw "Protected listener $p changed."}}
    $evidence.Verdict='PASS'
}catch{$evidence.Error=$_.Exception.Message;throw}finally{$SqlAdministratorCredential=$null;$evidence.CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');$evidence|ConvertTo-Json -Depth 25|Set-Content $evidencePath -Encoding utf8}
[pscustomobject]$evidence
