[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw'Elevation required.'}
Start-Transcript -LiteralPath (Join-Path $PSScriptRoot 'dev5054-negative-live-access.transcript.log') -Force|Out-Null
$runtimeIdentity='DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$release='C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$assembly=Join-Path $release 'DleOs.DevOperationalControlHost.dll'
$launcher=Join-Path $release 'Start-DevOperationalControlHost5054.ps1'
$runtimeConfiguration=Join-Path (Split-Path $PSScriptRoot -Parent) '..\Tools\DevelopmentRuntime\DleOs.DevOperationalControlHost\DevControlHostRuntimeConfiguration.cs'
$runtimeConfiguration=[IO.Path]::GetFullPath($runtimeConfiguration)
$output=Join-Path $PSScriptRoot 'dev5054-negative-live-access.json'

function Read-SqlRows([Data.SqlClient.SqlConnection]$Connection,[string]$Query){
 $command=$Connection.CreateCommand();$command.CommandText=$Query;$reader=$command.ExecuteReader();$rows=@();try{while($reader.Read()){$row=[ordered]@{};for($i=0;$i-lt$reader.FieldCount;$i++){$row[$reader.GetName($i)]=if($reader.IsDBNull($i)){$null}else{$reader.GetValue($i)}};$rows+=$row}}finally{$reader.Close();$command.Dispose()};return $rows
}
$sql=[Data.SqlClient.SqlConnection]::new('Server=lpc:.\SQLEXPRESS;Database=master;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=10;Application Name=DLE-OS DEV 5054 Negative Access Qualification')
try{
 $sql.Open()
 $serverPrincipals=@(Read-SqlRows $sql "SELECT name,type_desc,is_disabled FROM sys.server_principals WHERE name=N'$runtimeIdentity';")
 $databaseInventory=[ordered]@{}
 foreach($database in 'DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV','DLE_OS_CANONICAL_LIVE','DLE_OS_OPERATIONAL_LIVE','DLE_OS_SECURITY_LIVE'){
  try{$sql.ChangeDatabase($database);$databaseInventory[$database]=@(Read-SqlRows $sql "SELECT p.name,p.type_desc,p.authentication_type_desc,permission_name=dp.permission_name,permission_state=dp.state_desc,role_name=r.name FROM sys.database_principals p LEFT JOIN sys.database_permissions dp ON dp.grantee_principal_id=p.principal_id LEFT JOIN sys.database_role_members rm ON rm.member_principal_id=p.principal_id LEFT JOIN sys.database_principals r ON r.principal_id=rm.role_principal_id WHERE p.name=N'$runtimeIdentity';")}
  catch{$databaseInventory[$database]=[ordered]@{QueryDenied=$true;Error=$_.Exception.Message}}
 }
}finally{if($sql){$sql.Dispose()}}

$bytes=[IO.File]::ReadAllBytes($assembly);$assemblyText=[Text.Encoding]::UTF8.GetString($bytes)+[Text.Encoding]::Unicode.GetString($bytes)
$launcherText=Get-Content -LiteralPath $launcher -Raw
$forbidden=@('DLE_OS_CANONICAL_LIVE','DLE_OS_OPERATIONAL_LIVE','DLE_OS_SECURITY_LIVE','deleon-server\Production','Start-LiveSnapshotRefresh','Start-InvoiceHistoryRefresh','Start-OperationsRefresh','Invoke-SyncOperations','/api/sync/operations','/api/platform/refresh','C:\DLE-OS\Canonical','C:\DLE-OS\Live','Azure Artifact Signing','TrustedSigningAccount','SignTool.exe')
$required=@('DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV','DLE-OS-HOST:5052','DEV_OPERATIONAL_ONLY')
$forbiddenFindings=@($forbidden|Where-Object{$assemblyText.IndexOf($_,[StringComparison]::OrdinalIgnoreCase)-ge0-or$launcherText.IndexOf($_,[StringComparison]::OrdinalIgnoreCase)-ge0})
$requiredMissing=@($required|Where-Object{$assemblyText.IndexOf($_,[StringComparison]::OrdinalIgnoreCase)-lt0-and$launcherText.IndexOf($_,[StringComparison]::OrdinalIgnoreCase)-lt0})
$routes=@([regex]::Matches($assemblyText,'/api/[A-Za-z0-9_{}./-]+')|ForEach-Object{$_.Value}|Sort-Object -Unique)
$mutatingLiveRoutes=@($routes|Where-Object{$_-match'(?i)sync|refresh|deploy|promotion|service-control|sign'})
$canonicalReadRoutes=@($routes|Where-Object{$_-like'/api/platform/live/v1/*'})
$configurationText=Get-Content -LiteralPath $runtimeConfiguration -Raw
$configurationGuardPresent=$configurationText-match'InitialCatalog\.Contains\("LIVE"' -and $configurationText-match'DLE_OS_OPERATIONAL_DEV' -and $configurationText-match'DLE_OS_SECURITY_DEV' -and $configurationText-match'5052'
$task=Get-ScheduledTask -TaskPath '\' -TaskName 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$operationalDevRows=@($databaseInventory.DLE_OS_OPERATIONAL_DEV)
$securityDevRows=@($databaseInventory.DLE_OS_SECURITY_DEV)
$operationalRoleQualified=$operationalDevRows.Count-gt0-and@($operationalDevRows|Where-Object{$_.role_name-ne'dle_os_dev_control_rw'-or$_.permission_name-ne'CONNECT'-or$_.permission_state-ne'GRANT'}).Count-eq0
$securityRoleQualified=$securityDevRows.Count-gt0-and@($securityDevRows|Where-Object{$_.role_name-ne'dle_os_dev_control_security_reader'-or$_.permission_name-ne'CONNECT'-or$_.permission_state-ne'GRANT'}).Count-eq0
$passed=$serverPrincipals.Count-eq0-and$operationalRoleQualified-and$securityRoleQualified-and$forbiddenFindings.Count-eq0-and$requiredMissing.Count-eq0-and$mutatingLiveRoutes.Count-eq0-and$canonicalReadRoutes.Count-gt0-and$configurationGuardPresent-and$task.State-eq'Running'-and$task.Settings.Enabled
$result=[ordered]@{Schema='dle-os.dev5054-negative-live-access.v1';CapturedUtc=[DateTimeOffset]::UtcNow;ElevatedIdentity=$id.Name;RuntimeIdentity=$runtimeIdentity;ServerPrincipals=$serverPrincipals;DatabasePrincipalInventory=$databaseInventory;OperationalRoleQualified=$operationalRoleQualified;SecurityRoleQualified=$securityRoleQualified;Assembly=$assembly;AssemblySha256=(Get-FileHash -LiteralPath $assembly -Algorithm SHA256).Hash;LauncherSha256=(Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash;RuntimeConfiguration=$runtimeConfiguration;RuntimeConfigurationSha256=(Get-FileHash -LiteralPath $runtimeConfiguration -Algorithm SHA256).Hash;ConfigurationLiveDatabaseGuardPresent=$configurationGuardPresent;ForbiddenTokensTested=$forbidden;ForbiddenFindings=$forbiddenFindings;RequiredTokens=$required;RequiredMissing=$requiredMissing;DiscoveredApiRoutes=$routes;CanonicalReadApiRoutes=$canonicalReadRoutes;MutatingLiveRoutes=$mutatingLiveRoutes;CandidateState=[string]$task.State;CandidateEnabled=[bool]$task.Settings.Enabled;Passed=$passed}
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $output -Encoding utf8
$result|ConvertTo-Json -Depth 6
if(-not$passed){throw'Negative LIVE-access qualification failed.'}
