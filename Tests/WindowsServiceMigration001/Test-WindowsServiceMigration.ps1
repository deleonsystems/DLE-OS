[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$paths=[ordered]@{
    Project=Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DleOs.DevelopmentFrontend.csproj'
    Program=Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\Program.cs'
    Bootstrap=Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DleOsWindowsServiceBootstrap.cs'
    Config=Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\service-runtime.Development.json'
    Crypto=Join-Path $repository 'Tools\DevelopmentRuntime\DleOsDevelopmentFrontendBootstrapCrypto.ps1'
    Request=Join-Path $repository 'Tools\DevelopmentRuntime\New-DleOsDevelopmentFrontendFileServerBootstrapRequest.ps1'
    FileServer=Join-Path $repository 'Tools\DevelopmentRuntime\DleOsLegacyFileServerBootstrap.cs'
    FileServerManifest=Join-Path $repository 'Tools\DevelopmentRuntime\DleOsLegacyFileServerBootstrap.manifest'
    Migration=Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDevelopmentFrontendServiceMigration.ps1'
    Interactive=Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDevelopmentFrontendServiceMigrationInteractive.ps1'
    HostRollback=Join-Path $repository 'Tools\DevelopmentRuntime\Restore-DleOsDevelopmentFrontendDetachedRuntime.ps1'
    Deployment=Join-Path $repository 'Tools\DevelopmentRuntime\Deploy-DleOsDevelopmentFrontendWindowsService.ps1'
    SqlBootstrap=Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDevelopmentFrontendSqlBootstrap.ps1'
    KittingQualification=Join-Path $repository 'Tools\DevelopmentRuntime\Test-DleOsDevelopmentFrontendKittingAccess.ps1'
    SqlGrant=Join-Path $repository 'Tools\SecurityFoundation\Database\007_GrantDevelopmentFrontendService.sql'
    SqlValidate=Join-Path $repository 'Tools\SecurityFoundation\Database\007_ValidateDevelopmentFrontendService.sql'
}
$checks=[Collections.Generic.List[string]]::new()
function Check([bool]$Condition,[string]$Name){if(-not$Condition){throw "FAILED: $Name"};$checks.Add($Name)}
foreach($name in $paths.Keys){Check (Test-Path -LiteralPath $paths[$name]) "$name implementation exists"}
foreach($name in 'Crypto','Request','Migration','Interactive','HostRollback','Deployment','SqlBootstrap','KittingQualification'){
    $tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($paths[$name],[ref]$tokens,[ref]$errors);Check ($errors.Count-eq 0) "$name parses"
}
$source=@{};foreach($name in $paths.Keys){if($name-ne'Config'){$source[$name]=Get-Content -Raw $paths[$name]}}
$config=Get-Content -Raw $paths.Config|ConvertFrom-Json

Check ($source.Project.Contains('Microsoft.Extensions.Hosting.WindowsServices')-and$source.Program.Contains('builder.Host.UseWindowsService')) 'native SCM lifetime is used'
Check ($source.Bootstrap.Contains('DLE-OS-HOST\DLE-OS-DEV-FRONTEND')-and$source.Bootstrap.Contains('WindowsIdentity.GetCurrent().Name.Equals')) 'service runtime identity fails closed'
Check (-not$source.Bootstrap.Contains('Start-Process')-and-not$source.Program.Contains('Process.Start')) 'service creates no detached child'
Check ($config.environment-eq'Development'-and$config.requiredRuntimeIdentity-eq'DLE-OS-HOST\DLE-OS-DEV-FRONTEND'-and$config.securityDatabase-eq'DLE_OS_SECURITY_DEV') 'configuration is explicit DEV'
Check (@($config.frontendPrefixes).Count-eq 4-and@($config.frontendPrefixes)-contains'https://dev.dle-os.internal.dlemfg.com:443'-and@($config.frontendPrefixes)-contains'https://auth.internal.dlemfg.com:443') 'configuration contains the four approved prefixes'
Check (@($config.frontendPrefixes|Select-Object -Unique).Count-eq@($config.frontendPrefixes).Count) 'configuration contains no duplicate HTTP.sys prefix'
Check (([regex]::Matches($source.Program,'options\.UrlPrefixes\.Add\(')).Count-eq 1-and-not$source.Program.Contains('governedPhase62CIdentityPrefix')) 'configured prefix loop is the sole HTTP.sys registration path'
Check ($source.Bootstrap.Contains('SetEquals(DevelopmentFrontendPrefixes)')-and$source.Bootstrap.Contains('Distinct(StringComparer.OrdinalIgnoreCase)')-and$source.Project.Contains('Microsoft.Extensions.Hosting.WindowsServices')) 'Windows Service bootstrap enforces the exact unique DEV prefix set'
Check ($config.canonicalApiBaseUrl.EndsWith(':5052')-and$config.operationalApiBaseUrl.EndsWith(':5054')) 'configuration preserves 5052 and 5054 boundaries'

foreach($name in 'FileServer','Migration','Interactive','HostRollback'){
    Check (-not($source[$name]-match'New-PSSession|Invoke-Command\s+-Session|TrustedHosts|Basic\s+authentication|Enable-PSRemoting')) "$name contains no remote administration"
}
Check ($source.FileServer.Contains('ExpectedComputer = "DELEON-SERVER"')-and$source.FileServer.Contains('AssertLocalElevatedServer')) 'file-server transaction is local-only and elevated'
Check ($source.Migration.Contains('$env:COMPUTERNAME-ine''DLE-OS-HOST''')-and$source.Migration.Contains('RemoteAdministrationUsed=$false')) 'host transaction is local-only'
Check ($source.Request.Contains('RSACryptoServiceProvider')-and$source.Request.Contains('3072,$csp')-and$source.Request.Contains('host-private-handoff.dpapi')) 'host request creates a legacy-compatible RSA-3072 private handoff'
Check ($source.Request.Contains("'host-state'")-and$source.Request.Contains("'server-package'")-and$source.Request.Contains('CodeManifestSha256')) 'portable server package excludes and is bound to host-private state'
Check ($source.FileServer.Contains('bootstrap-code-manifest.json')-and$source.FileServer.Contains('Server-package code checksum mismatch')) 'server locally verifies every packaged implementation file'
Check ($source.Crypto.Contains('DataProtectionScope')-and$source.Request.Contains('CurrentUser')) 'host private key is DPAPI CurrentUser protected'
Check ($source.FileServer.Contains('RSA-3072-OAEP-SHA1-CSP')-and$source.FileServer.Contains('rsa.Encrypt(passwordBytes, true)')-and$source.Migration.Contains('$rsa.Decrypt($encrypted,$true)')) 'password envelope uses Windows Server 2008 R2-compatible RSA-3072 OAEP'
Check ($source.FileServer.Contains('EvidenceHmacSha256')-and$source.Migration.Contains('Bootstrap evidence signature mismatch')) 'response evidence is HMAC signed and validated'
Check ($source.FileServer.Contains('bootstrap-response.sha256')-and$source.Migration.Contains('Bootstrap response checksum mismatch')) 'response evidence has a checked SHA-256 sidecar'
Check ($source.FileServer.Contains('PlaintextPasswordPersisted = false')-and-not$source.FileServer.Contains('ConvertFrom-SecureString')-and-not$source.Migration.Contains('GetNetworkCredential')) 'password is never persisted or placed on a command line'
Check ($source.FileServer.Contains('fileserver-rollback-state.dpapi')-and$source.FileServer.Contains('DataProtectionScope.LocalMachine')) 'file-server rollback state is DPAPI LocalMachine protected'
Check ($source.FileServer.Contains('ShareReadMask = 0x1200A9')-and$source.FileServer.Contains('SetReadOnlyShareAce')) 'Production share gate is read-only'
Check ($source.FileServer.Contains('KIT-SHORTAGES')-and$source.FileServer.Contains('KIT-COMPLETE')-and$source.FileServer.Contains('FileSystemRights.ReadAndExecute')) 'NTFS grants are limited to exact Kitting roots'
Check ($source.FileServer.Contains('SeDenyInteractiveLogonRight')-and$source.FileServer.Contains('SeDenyRemoteInteractiveLogonRight')-and$source.FileServer.Contains('RemoveAllLocalGroupMemberships')) 'file-server identity is noninteractive and groupless'
Check ($source.FileServer.Contains('ValidateRightsAndAcls')-and$source.FileServer.Contains('ValidateEffectiveSmb')-and$source.FileServer.Contains('UnrelatedProductionReadDenied = true')) 'file-server transaction proves exact NTFS and effective SMB denial locally'
Check ($source.FileServer.Contains('Undo(state)')-and$source.FileServer.Contains('if (mutationStarted')) 'file-server transaction self-rolls back after mutation failure'
Check ($source.FileServer.Contains('rollbackVerdict = "PASS"')-and$source.FileServer.Contains('bootstrap-failure.sha256')-and$source.FileServer.Contains('Local rollback failed')) 'file-server failure evidence reports rollback success or failure without suppression'
Check ($source.FileServer.Contains('SetShareDacl(state.ShareDacl)')-and$source.FileServer.Contains('DeleteLocalUser')) 'file-server rollback restores the prior share DACL and removes only its account'

Check (-not($source.FileServer-match'WindowsPrincipal\]::new|Get-LocalUser|New-LocalUser|Remove-LocalUser|Get-SmbShare|Grant-SmbShareAccess|Revoke-SmbShareAccess')) 'legacy server transaction has no modern PowerShell or missing module dependency'
Check ($source.FileServer.Contains('DirectoryEntry')-and$source.FileServer.Contains('Win32_LogicalShareSecuritySetting')-and$source.FileServer.Contains('DirectorySecurity')) 'legacy account, share, and NTFS APIs are available on Server 2008 R2'
Check ($source.FileServerManifest.Contains('requireAdministrator')-and$source.Request.Contains('Transaction A exit code')) 'elevation and reliable native exit propagation are package-owned'

Check ($source.Migration.Contains('Test-RemoteKittingBoundary')-and$source.Migration.Contains('New-PSDrive')-and$source.Migration.Contains("'KITTING\KIT-SHORTAGES','KITTING\KIT-COMPLETE'")) 'host verifies only the two approved SMB Kitting roots before mutation'
Check ($source.Migration.Contains("Resolve-DnsName -Name 'DELEON-SERVER' -Type A")-and$source.Migration.Contains('$qualificationRoot="\\$serverAddress\Production"')-and$source.Migration.Contains("`$runtimeRoot='\\DELEON-SERVER\Production'")) 'host preflight isolates staged SMB credentials from existing hostname sessions while preserving the runtime UNC'
Check ($source.Migration.Contains("PSObject.Properties['IPAddress']")-and-not$source.Migration.Contains('Where-Object{$_.IPAddress}')) 'DNS answer filtering remains safe under strict mode when metadata records lack IPAddress'
Check ($source.Migration.Contains('Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop')-and-not$source.Migration.Contains('[IO.Directory]::EnumerateFileSystemEntries')) 'temporary SMB drive enumeration uses the PowerShell provider rather than an unsupported .NET drive path'
Check (-not$source.Migration.Contains('Customer Files')-and-not$source.KittingQualification.Contains('Customer Files')-and$source.KittingQualification.Contains('ApprovedKittingRootsOnly')) 'host and post-start service qualification do not directly validate the separate Customer Files boundary'
Check ($source.Migration.Contains('Simulation evidence can never authorize migration')) 'simulation evidence is fail-closed for migration'
Check ($source.Migration.Contains("Mechanism='ScheduledTaskLaunchDetachedWorker'")-and$source.Migration.Contains('ScheduledTaskPresent=$true')-and$source.Migration.Contains("CurrentOwnership='DetachedHistoricalWorker'")) 'rollback baseline reconciles the task-launched detached worker'
Check ($source.Migration.Contains('5051-service-worker-launch.json')-and$source.Migration.Contains('StartScriptSha256')) 'rollback baseline binds PID evidence and exact start script'
Check ($source.Migration.Contains('legacy-scheduled-task.xml')-and$source.Migration.Contains('Export-ScheduledTask')-and$source.Migration.Contains('XmlSha256')) 'rollback baseline captures the exact live Scheduled Task definition'
Check ($source.Migration.IndexOf('Get-LegacyTaskXmlDefinition $task.TaskPath',[StringComparison]::Ordinal)-lt$source.Migration.IndexOf('The captured task is not the DLE-OS 5051 rollback launcher',[StringComparison]::Ordinal)-and$source.Migration.Contains('XmlNamespaceManager')) 'authoritative task XML is preserved and classified without CIM action normalization'
Check ($source.Migration.Contains("SelectSingleNode('t:WorkingDirectory'")-and-not$source.Migration.Contains('$action.WorkingDirectory')) 'missing optional task WorkingDirectory is handled without strict-mode property access'
Check ($source.Migration.Contains('FrontendRollbackRestored')-and$source.Migration.Contains('RollbackWorkerId')-and$source.Migration.Contains('$originallyLaunchedByScheduledTask=$true')-and$source.Migration.Contains('OriginallyLaunchedByScheduledTask=$originallyLaunchedByScheduledTask')) 'worker PID is correlated to the governed task rollback launch evidence'
Check ($source.Migration.Contains("Kind='GovernedWindowsServiceMigrationRollback'")-and$source.Migration.Contains("`$currentLaunchMechanism='GovernedServiceMigrationRollback'")-and$source.Migration.Contains('$elapsed-gt 30')-and$source.Migration.Contains('TaskXmlSha256')) 'worker PID can be correlated to an immediately preceding governed service-migration rollback'
Check ($source.Migration.Contains('Get-NormalizedLegacyTaskXmlSha256')-and$source.Migration.Contains('ParentNode.RemoveChild($enabledNode)')-and$source.Migration.Contains('CurrentTaskEnabled=[bool]$taskSnapshot.Enabled')) 'rollback correlation preserves the actual task state while comparing its invariant definition'
Check ($source.Migration.Contains('Get-ProcessOwner')-and$source.Migration.Contains('$owner-ine$legacyIdentity')) 'rollback worker owner is proven as DLE-OS'
Check ($source.Migration.Contains('Get-WorkerHttpPrefixes')-and$source.Migration.Contains('Wait-Release @($baseline.HttpPrefixes) 45')) 'all captured HTTP.sys prefixes are independently released'
Check ($source.Migration.Contains('Get-HttpPrefixDisplayCandidates')-and$source.Migration.Contains("'{0}://{1}:{2}:{1}/'")-and$source.Migration.Contains('$upper.Contains($_)')) 'HTTP.sys IP-bound display form is normalized for exact ownership checks'
Check ($source.Migration.Contains('Wait-NoFrontendWorkers 45')-and$source.Migration.Contains('Get-ListenerOwners 5051')) 'process and TCP release gates are bounded'
Check ($source.Migration.Contains('Start-LegacyRollbackRuntime')-and$source.Migration.Contains('-Credential $SqlAdministratorCredential')-and$source.Migration.Contains("RollbackRuntimeMechanism='DetachedStartDevelopmentFrontend'")) 'rollback relaunches the actual runtime under existing DLE-OS credential'
Check ($source.Migration.Contains('Set-LegacyTaskRetired')-and$source.Migration.Contains('Disable-ScheduledTask')-and$source.Migration.Contains('Restore-LegacyTaskState')-and-not$source.Migration.Contains('Start-ScheduledTask')) 'migration retires the retained task without using it to start the replacement'
Check (-not$source.Migration.Contains('Unregister-ScheduledTask')-and-not$source.HostRollback.Contains('Register-ScheduledTask')-and$source.HostRollback.Contains('Restore-LegacyTaskState')) 'migration and rollback retain and state-restore the exact task rather than recreating it'
Check ($source.Deployment.Contains('retained legacy Scheduled Task is enabled or running')) 'future service deployment permits only the retained disabled task'

$publishIndex=$source.Migration.IndexOf('&dotnet.exe publish',[StringComparison]::Ordinal)
$accountIndex=$source.Migration.IndexOf('New-LocalUser -Name $serviceAccountName',[StringComparison]::Ordinal)
$disableIndex=$source.Migration.IndexOf("Set-TransactionStage 'LegacyTaskRetire';Set-LegacyTaskRetired",[StringComparison]::Ordinal)
$stopIndex=$source.Migration.IndexOf('Stop-Process -Id $baseline.ProcessId',[StringComparison]::Ordinal)
$urlIndex=$source.Migration.IndexOf('$urlAclsChanged=$true;Set-ServiceUrlAcls',[StringComparison]::Ordinal)
$startIndex=$source.Migration.IndexOf('Start-Service -Name $serviceName',[StringComparison]::Ordinal)
Check ($publishIndex-ge 0-and$accountIndex-gt$publishIndex-and$disableIndex-gt$accountIndex-and$stopIndex-gt$disableIndex-and$urlIndex-gt$stopIndex-and$startIndex-gt$urlIndex) 'candidate qualifies before account creation, then task retirement and old runtime stop precede URL transfer and service start'
Check ($source.Migration.Contains('New-Service -Name $serviceName')-and$source.Migration.Contains('-StartupType Automatic')-and$source.Migration.Contains("-DependsOn @('HTTP','DleOsKeycloak')")) 'SCM service is automatic, direct, and dependency-bound'
Check ($source.Migration.Contains("actions=','restart/60000/restart/120000/none/0")-and$source.Migration.Contains("reset=','86400")) 'SCM recovery is bounded'
Check ($source.Migration.Contains('A frontend process exists outside SCM ownership')-or$source.Migration.Contains('SCM does not directly own exactly one frontend executable')) 'singleton SCM ownership is validated'
Check ($source.Migration.Contains("Set-TransactionStage 'SingletonOwnership'")-and$source.Migration.Contains("Set-TransactionStage 'HealthDevShared'")-and$source.Migration.Contains("Join-Path `$workRoot 'failure.json'")) 'runtime failure stage and exception are persisted before rollback'
Check ($source.Migration.Contains("Health5052Read';Assert-HttpStatus 'http://DLE-OS-HOST:5052/api/platform/live/v1/sales-orders?page=1&pageSize=1' 200")-and-not$source.Migration.Contains("Health5052Read';Assert-HttpStatus 'http://DLE-OS-HOST:5052/api/platform/live/v1/readiness'")) '5052 qualification proves its read boundary without requiring independent aggregate readiness'
Check ($source.Migration.Contains('Assert-LegacyIdentityHttpStatus')-and$source.Migration.Contains("Health5054Operational';Assert-LegacyIdentityHttpStatus")-and$source.Migration.Contains('-Credential $SqlAdministratorCredential')-and$source.Migration.Contains('-EncodedCommand')) '5054 qualification uses the existing authorized identity without exposing its credential'
Check ($source.Migration.Contains('Restore-UrlAcls')-and$source.Migration.Contains('Restore-Acls')-and$source.Migration.Contains("Invoke-RollbackStep 'prior runtime binaries'")) 'host ACLs and binaries are rollback-restorable'
Check ($source.Migration.Contains('CertificatePrivateKeyBefore')-and$source.Migration.Contains('CertificatePrivateKeyAfter')-and$source.Migration.Contains('ServicePrivateKeyGrantRequired=$false')) 'certificate bindings and private-key ACLs are compared without a service grant'
Check ($source.Bootstrap.Contains('EnsureDirectoryReadable(KittingShortageRoot)')-and$source.Bootstrap.Contains('EnsureDirectoryReadable(KittingCompleteRoot)')-and$source.Migration.Contains("Mechanism='SynchronousWindowsServiceBootstrap'")-and-not$source.Migration.Contains('Start-Process powershell.exe -Credential $serviceCredential')) 'Kitting is proven synchronously by the SCM service identity without an interactive service-account logon'
Check ($source.Migration.Contains("Invoke-RollbackStep 'detached runtime restoration'")-and$source.Migration.Contains("Invoke-RollbackStep 'protected listener verification'")) 'rollback restores and verifies the actual runtime'
Check ($source.HostRollback.Contains("RestoredMechanism='ScheduledTaskLaunchDetachedWorker'")-and$source.HostRollback.Contains('ScheduledTaskCreated=$false')-and$source.HostRollback.Contains('ScheduledTaskRestored')) 'post-success rollback restores the detached runtime and retained task state'
Check ($source.HostRollback.Contains('FileServerRollbackRequired=$true')-and$source.Migration.Contains("FileServerRollbackExecutable='DleOsLegacyFileServerBootstrap.exe'")-and$source.Migration.Contains('fileserver-rollback-state.dpapi')) 'cross-machine rollback boundary is explicit and local'

Check ($source.SqlGrant.Contains('CREATE LOGIN [DLE-OS-HOST\DLE-OS-DEV-FRONTEND] FROM WINDOWS')-and$source.SqlGrant.Contains('DLE_OS_SECURITY_DEV')-and-not$source.SqlGrant.Contains('db_owner')-and-not$source.SqlGrant.Contains('DLE_OS_SECURITY_LIVE')) 'SQL grants are least-privileged DEV only'
Check ($source.SqlValidate.Contains('sys.database_role_members')-and$source.SqlValidate.Contains('unapproved direct database permission')-and-not$source.SqlValidate.Contains('DLE_OS_SECURITY_LIVE')) 'SQL validator rejects roles and extra permissions'
Check ($source.SqlValidate.Contains('schema_value.name COLLATE DATABASE_DEFAULT')-and$source.SqlValidate.Contains('object_value.name COLLATE DATABASE_DEFAULT')-and$source.SqlValidate.Contains('permission.permission_name COLLATE DATABASE_DEFAULT')-and$source.SqlValidate.Contains(') COLLATE DATABASE_DEFAULT NOT IN')) 'SQL permission allowlist comparison explicitly resolves catalog collation differences'
Check ($source.SqlValidate.Contains("permission.class_desc = N'DATABASE'")-and$source.SqlValidate.Contains("permission.permission_name = N'CONNECT'")-and$source.SqlValidate.Contains('permission.major_id = 0')-and$source.SqlValidate.Contains('permission.minor_id = 0')) 'SQL validator permits only the automatic database CONNECT permission outside the approved object allowlist'
Check ($source.Migration.Contains('$protectedPorts=5041,5042,5043,5052,5053,5054')-and$source.Migration.Contains('ProductionDeploymentPerformed=$false')) 'LIVE and protected listeners are immutable'
Check ($source.Migration.Contains('$stateRoot=Join-Path $repository ''.tmp''')-and$source.Migration.Contains('$nonCanonicalStateRoot=$repository+''.tmp''')-and$source.Migration.Contains('Transaction state must be beneath canonical root')) 'all transaction state is constrained to the canonical repository .tmp root'
Check ($source.Interactive.Contains('Find-EligibleBootstrapTransaction')-and$source.Interactive.Contains('Expected exactly one eligible canonical bootstrap transaction')-and$source.Interactive.Contains('-ValidateBootstrapOnly')-and$source.Interactive.Contains('$bootstrapRoot=Join-Path $canonicalStateRoot ''development-frontend-two-machine-bootstrap''')) 'interactive launcher cryptographically auto-discovers exactly one canonical bootstrap transaction'
Check ($source.Migration.Contains('KeycloakMetadataChanged=$false')-and-not($source.Migration-match'/admin/realms/dle-os/clients')) 'Keycloak metadata is not changed'
foreach($name in 'FileServer','Migration','HostRollback','Deployment'){
    Check (-not($source[$name]-match'(?im)\bgit\s+(commit|push)\b')) "$name never commits or pushes"
}

Write-Output "PASS: $($checks.Count) two-machine Windows Service migration checks."
$checks|ForEach-Object{Write-Output "  $_"}
