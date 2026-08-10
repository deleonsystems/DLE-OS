[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$migration=Get-Content -Raw (Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDevelopmentFrontendServiceMigration.ps1')
$server=Get-Content -Raw (Join-Path $repository 'Tools\DevelopmentRuntime\DleOsLegacyFileServerBootstrap.cs')

$hostMarkers=[ordered]@{
    LocalAccount='New-LocalUser -Name $serviceAccountName'
    SqlPrincipal='$evidence.SqlGrant=Invoke-SqlBootstrap Grant'
    ServiceInstall='New-Service -Name $serviceName'
    FileAcls='$fileAclsChanged=$true'
    LegacyTaskRetire="Set-TransactionStage 'LegacyTaskRetire';Set-LegacyTaskRetired"
    LegacyStop='Stop-Process -Id $baseline.ProcessId'
    UrlAcls='$urlAclsChanged=$true;Set-ServiceUrlAcls'
    ServiceStart='Start-Service -Name $serviceName'
}
$last=-1;foreach($item in $hostMarkers.GetEnumerator()){$index=$migration.IndexOf($item.Value,[StringComparison]::Ordinal);if($index-le$last){throw "Host mutation order fails at $($item.Key)."};$last=$index}
$serverMarkers=[ordered]@{Account='CreateLocalUser(password)';Share='SetReadOnlyShareAce()';Ntfs='SetKittingAcls(kitting, shortages, complete)';Evidence='WriteUtf8(responsePath, Json.Serialize(response))'}
$bootstrapStart=$server.IndexOf('private static void Bootstrap',[StringComparison]::Ordinal)
$last=$bootstrapStart;foreach($item in $serverMarkers.GetEnumerator()){$index=$server.IndexOf($item.Value,$last+1,[StringComparison]::Ordinal);if($index-le$last){throw "Server mutation order fails at $($item.Key)."};$last=$index}

$hostBoundaries=@('LocalAccount','SqlPrincipal','ServiceInstall','FileAcls','LegacyTaskRetire','LegacyStop','UrlAcls')
foreach($failureIndex in 0..($hostBoundaries.Count-1)){
    $state=[ordered]@{};foreach($b in $hostBoundaries){$state[$b]=$false};for($i=0;$i-le$failureIndex;$i++){$state[$hostBoundaries[$i]]=$true}
    foreach($b in @('ServiceInstall','UrlAcls','FileAcls','SqlPrincipal','LocalAccount','LegacyStop','LegacyTaskRetire')){if($state[$b]){$state[$b]=$false}}
    if(@($state.GetEnumerator()|Where-Object Value).Count-ne 0){throw "Host rollback simulation failed after $($hostBoundaries[$failureIndex])."}
}
foreach($required in "Invoke-RollbackStep 'candidate service removal'","Invoke-RollbackStep 'URL ACL restoration'","Invoke-RollbackStep 'filesystem ACL restoration'","Invoke-RollbackStep 'prior runtime binaries'","Invoke-RollbackStep 'SQL principal removal'","Invoke-RollbackStep 'local account rights'","Invoke-RollbackStep 'local account removal'","Invoke-RollbackStep 'detached runtime restoration'","Invoke-RollbackStep 'legacy Scheduled Task restoration'","Invoke-RollbackStep 'protected listener verification'"){
    if(-not$migration.Contains($required)){throw "Missing independent host rollback step: $required"}
}
if(-not$server.Contains('if (mutationStarted && state != null)')-or-not$server.Contains('Undo(state)')-or-not$server.Contains('SetShareDacl(state.ShareDacl)')-or-not$server.Contains('DeleteLocalUser')){throw 'Server transaction rollback is incomplete.'}
Write-Output "PASS: two local mutation orders and $($hostBoundaries.Count) injected host rollback states simulated without mutation."
