[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param(
    [Parameter(Mandatory)]
    [switch]$ApproveMigration,

    [Parameter(Mandatory)]
    [ValidateScript({Test-Path -LiteralPath $_ -PathType Container})]
    [string]$BootstrapRequestDirectory,

    [Parameter(Mandatory)]
    [ValidateScript({Test-Path -LiteralPath $_ -PathType Container})]
    [string]$BootstrapResponseDirectory,

    [Parameter(Mandatory)]
    [Management.Automation.PSCredential]$SqlAdministratorCredential,

    [switch]$ValidateBootstrapOnly,

    [switch]$AllowSimulationEvidence
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'DleOsDevelopmentFrontendBootstrapCrypto.ps1')

$serviceName='DleOsDevelopmentFrontend'
$serviceAccountName='DLE-OS-DEV-FRONTEND'
$serviceIdentity="DLE-OS-HOST\$serviceAccountName"
$fileServerIdentity="DELEON-SERVER\$serviceAccountName"
$legacyIdentity='DLE-OS-HOST\DLE-OS'
$legacyTaskName='DLE-OS Development Authenticated Frontend 5051'
$serviceLogonRight='SeServiceLogonRight'
$denyInteractiveRight='SeDenyInteractiveLogonRight'
$denyRemoteInteractiveRight='SeDenyRemoteInteractiveLogonRight'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$project=Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DleOs.DevelopmentFrontend.csproj'
$configurationSource=Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\service-runtime.Development.json'
$accountRightsSource=Join-Path $repository 'Tools\DevelopmentRuntime\DleOsServiceAccountRights.cs'
$sqlBootstrap=Join-Path $repository 'Tools\DevelopmentRuntime\Invoke-DleOsDevelopmentFrontendSqlBootstrap.ps1'
$kittingQualification=Join-Path $repository 'Tools\DevelopmentRuntime\Test-DleOsDevelopmentFrontendKittingAccess.ps1'
$legacyStartScript=Join-Path $repository 'Tools\DevelopmentRuntime\Start-DevelopmentFrontend.ps1'
$legacyLaunchEvidence=Join-Path $repository '.tmp\development-runtime\5051-service-worker-launch.json'
$runtime=Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\bin\Release\net8.0-windows'
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$stateRoot=Join-Path $repository '.tmp';$nonCanonicalStateRoot=$repository+'.tmp'
$workRoot=Join-Path $stateRoot "windows-service-migration\$stamp"
$legacyTaskSnapshotPath=Join-Path $workRoot 'legacy-scheduled-task.xml'
$publish=Join-Path $workRoot 'publish';$artifacts=Join-Path $workRoot 'artifacts'
$rollbackRuntime=Join-Path $workRoot 'rollback-detached-runtime'
$evidencePath=Join-Path $workRoot 'migration.json'
$serviceRoot='C:\ProgramData\DLE-OS\DevelopmentFrontend\Service'
$release=Join-Path $serviceRoot "releases\$stamp"
$serviceConfiguration=Join-Path $release 'service-runtime.json'
$protectedPorts=5041,5042,5043,5052,5053,5054
$urls=@('http://dle-os-host:5051/','http://192.168.0.105:5051/','https://dev.dle-os.internal.dlemfg.com:443/','https://auth.internal.dlemfg.com:443/')
$evidence=[ordered]@{StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');ServiceName=$serviceName;ServiceIdentity=$serviceIdentity;FileServerIdentity=$fileServerIdentity;Approved=[bool]$ApproveMigration;ProductionDeploymentPerformed=$false;Phase63Preserved=$true;KeycloakMetadataChanged=$false;RemoteAdministrationUsed=$false;LegacyScheduledTaskExpected=$true;CanonicalStateRoot=$stateRoot;NonCanonicalStateRoot=$nonCanonicalStateRoot}
$handoff=$null;$serviceCredential=$null;$remoteCredential=$null
$serviceCreated=$false;$urlAclsChanged=$false;$fileAclsChanged=$false;$sqlPrincipalCreated=$false
$localAccountCreated=$false;$serviceLogonRightAdded=$false;$denyInteractiveRightAdded=$false;$denyRemoteInteractiveRightAdded=$false
$legacyStopped=$false;$legacyTaskDisabled=$false;$urlAclBefore=@();$aclBefore=@();$baseline=$null;$releaseCreated=$false

function Assert-Administrator{
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=[Security.Principal.WindowsPrincipal]::new($identity)
    if(-not$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'The DLE-OS-HOST service migration requires elevation.'}
    $evidence.OperatorIdentity=$identity.Name
}
function Invoke-Native([string]$File,[string[]]$Arguments){$output=&$File @Arguments 2>&1|Out-String;if($LASTEXITCODE-ne 0){throw "$File failed ($LASTEXITCODE): $output"};$output}
function Get-ListenerOwners([int]$Port){@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess|Sort-Object -Unique)}
function Get-ProtectedSnapshot{$result=[ordered]@{};foreach($port in $protectedPorts){$result[[string]$port]=@(Get-ListenerOwners $port)};$result}
function Get-FrontendWorkers{@(Get-CimInstance Win32_Process -Filter "Name='dotnet.exe' OR Name='DleOs.DevelopmentFrontend.exe'" -ErrorAction SilentlyContinue|Where-Object{$_.CommandLine-like'*DleOs.DevelopmentFrontend*'})}
function Get-ProcessOwner([object]$Process){$owner=Invoke-CimMethod -InputObject $Process -MethodName GetOwner;if($owner.ReturnValue-ne 0){throw "Cannot determine owner of PID $($Process.ProcessId)."};"$($owner.Domain)\$($owner.User)"}
function Get-HttpServiceState{Invoke-Native netsh.exe @('http','show','servicestate','view=requestq')}
function Get-HttpPrefixDisplayCandidates([string]$ExactPrefix){
    $candidates=[Collections.Generic.List[string]]::new();$candidates.Add($ExactPrefix.ToUpperInvariant())
    $match=[regex]::Match($ExactPrefix,'(?i)^(HTTPS?)://(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/$')
    if($match.Success){$candidates.Add(('{0}://{1}:{2}:{1}/'-f$match.Groups[1].Value,$match.Groups[2].Value,$match.Groups[3].Value).ToUpperInvariant())}
    $candidates.ToArray()
}
function Get-HttpPrefixRegistration([string]$ExactPrefix){
    $state=Get-HttpServiceState;$candidates=@(Get-HttpPrefixDisplayCandidates $ExactPrefix);$blocks=@($state-split'(?im)(?=^Request queue name:)'|Where-Object{$upper=$_.ToUpperInvariant();@($candidates|Where-Object{$upper.Contains($_)}).Count-gt 0})
    $ids=@($blocks|ForEach-Object{[regex]::Matches($_,'(?im)^\s*ID:\s*(\d+),')|ForEach-Object{[int]$_.Groups[1].Value}}|Sort-Object -Unique)
    [pscustomobject]@{Registered=$blocks.Count-gt 0;ProcessIds=$ids;Text=($blocks-join"`n")}
}
function Get-WorkerHttpPrefixes([int]$ProcessId){
    $state=Get-HttpServiceState;$blocks=@($state-split'(?im)(?=^Request queue name:)'|Where-Object{$_-match("(?im)^\s*ID:\s*"+$ProcessId+",\s*image:")})
    @($blocks|ForEach-Object{[regex]::Matches($_,'(?im)^\s+(HTTPS?://\S+/)\s*$')|ForEach-Object{$_.Groups[1].Value.ToUpperInvariant()}}|Sort-Object -Unique)
}
function Wait-NoFrontendWorkers([int]$Seconds=45){$deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds);do{$workers=@(Get-FrontendWorkers);if($workers.Count-eq 0){return};Start-Sleep -Milliseconds 250}while([DateTimeOffset]::UtcNow-lt$deadline);throw "Frontend processes did not exit: $($workers.ProcessId-join',')."}
function Wait-Release([string[]]$Prefixes,[int]$Seconds=45){
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do{$tcp=@(Get-ListenerOwners 5051);$registered=@($Prefixes|ForEach-Object{Get-HttpPrefixRegistration $_}|Where-Object Registered);if($tcp.Count-eq 0-and$registered.Count-eq 0){return};Start-Sleep -Milliseconds 250}while([DateTimeOffset]::UtcNow-lt$deadline)
    throw "DEV release timeout. TCP=$($tcp-join','); HTTP.sys prefixes=$(@($registered|ForEach-Object{$_.Text})-join' | ')."
}
function Get-UrlAclSnapshot([string]$Url){$text=&netsh.exe http show urlacl "url=$Url" 2>&1|Out-String;if($LASTEXITCODE-ne 0){return [pscustomobject]@{Url=$Url;Exists=$false;Sddl=$null}};$sddl=[regex]::Match($text,'(?im)^\s*SDDL:\s*(\S+)\s*$').Groups[1].Value;[pscustomobject]@{Url=$Url;Exists=$true;Sddl=$sddl}}
function Restore-UrlAcls([object[]]$Snapshots){foreach($snapshot in $Snapshots){&netsh.exe http delete urlacl "url=$($snapshot.Url)" 2>&1|Out-Null;if($snapshot.Exists){$null=Invoke-Native netsh.exe @('http','add','urlacl',"url=$($snapshot.Url)","sddl=$($snapshot.Sddl)")}}}
function Set-ServiceUrlAcls{foreach($url in $urls){&netsh.exe http delete urlacl "url=$url" 2>&1|Out-Null;$null=Invoke-Native netsh.exe @('http','add','urlacl',"url=$url","user=$serviceIdentity",'listen=yes','delegate=no')}}
function Get-AclSnapshot([string]$Path){$acl=Get-Acl -LiteralPath $Path;[pscustomobject]@{Path=$Path;Sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)}}
function Restore-Acls([object[]]$Snapshots){foreach($snapshot in $Snapshots){if(Test-Path -LiteralPath $snapshot.Path){$acl=Get-Acl -LiteralPath $snapshot.Path;$acl.SetSecurityDescriptorSddlForm([string]$snapshot.Sddl,[Security.AccessControl.AccessControlSections]::All);Set-Acl -LiteralPath $snapshot.Path -AclObject $acl}}}
function Get-CertificatePrivateKeySnapshot([string]$HostnamePort){
    $binding=&netsh.exe http show sslcert "hostnameport=$HostnamePort" 2>&1|Out-String
    if($LASTEXITCODE-ne 0){throw "SSL binding $HostnamePort is absent."}
    $thumbprint=[regex]::Match($binding,'(?im)^\s*Certificate Hash\s*:\s*([A-F0-9]+)\s*$').Groups[1].Value
    if([string]::IsNullOrWhiteSpace($thumbprint)){throw "SSL binding $HostnamePort has no certificate hash."}
    $certificate=Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumbprint"
    $certificateText=Invoke-Native certutil.exe @('-store','My',$thumbprint)
    $container=[regex]::Match($certificateText,'(?im)^\s*Unique container name:\s*(\S+)\s*$').Groups[1].Value
    $provider=[regex]::Match($certificateText,'(?im)^\s*Provider\s*=\s*(.+?)\s*$').Groups[1].Value
    $keyPath=if([string]::IsNullOrWhiteSpace($container)){$null}elseif($provider-match'Key Storage Provider'){Join-Path 'C:\ProgramData\Microsoft\Crypto\Keys' $container}else{Join-Path 'C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys' $container}
    [pscustomobject]@{HostnamePort=$HostnamePort;Thumbprint=$thumbprint;Subject=$certificate.Subject;Provider=$provider;KeyPath=$keyPath;KeyAclSddl=if($keyPath-and(Test-Path $keyPath)){(Get-Acl $keyPath).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)}else{$null};ServicePrivateKeyGrantRequired=$false}
}
function Grant-Read([string]$Path){$null=Invoke-Native icacls.exe @($Path,'/grant:r',"${serviceIdentity}:(OI)(CI)(RX)")}
function Grant-FileRead([string]$Path){$null=Invoke-Native icacls.exe @($Path,'/grant:r',"${serviceIdentity}:(R)")}
function Grant-Traverse([string]$Path){$null=Invoke-Native icacls.exe @($Path,'/grant:r',"${serviceIdentity}:(RX)")}
function Wait-ServiceState([string]$State,[int]$Seconds=45){$deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds);do{$service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue;if($service-and[string]$service.State-eq$State){return $service};Start-Sleep -Milliseconds 250}while([DateTimeOffset]::UtcNow-lt$deadline);throw "$serviceName did not reach $State."}

function Read-BootstrapHandoff{
    $requestPath=Join-Path $BootstrapRequestDirectory 'bootstrap-request.json';$requestHashPath=Join-Path $BootstrapRequestDirectory 'bootstrap-request.sha256';$privatePath=Join-Path $BootstrapRequestDirectory 'host-private-handoff.dpapi'
    $responsePath=Join-Path $BootstrapResponseDirectory 'bootstrap-response.json';$responseHashPath=Join-Path $BootstrapResponseDirectory 'bootstrap-response.sha256'
    foreach($path in $requestPath,$requestHashPath,$privatePath,$responsePath,$responseHashPath){if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Bootstrap handoff file is absent: $path"}}
    $requestHash=(Get-Content -Raw $requestHashPath).Trim().ToUpperInvariant();if((Get-DleOsFileSha256 $requestPath)-cne$requestHash){throw 'Bootstrap request checksum mismatch.'}
    $request=Get-Content -Raw $requestPath|ConvertFrom-Json
    $responseHash=(Get-Content -Raw $responseHashPath).Trim().ToUpperInvariant();if((Get-DleOsFileSha256 $responsePath)-cne$responseHash){throw 'Bootstrap response checksum mismatch.'}
    $response=Get-Content -Raw $responsePath|ConvertFrom-Json
    if($response.Verdict-cne'PASS'-or[string]::IsNullOrWhiteSpace([string]$response.PayloadBase64)){throw 'Only successful DELEON-SERVER evidence is accepted.'}
    $canonicalPayloadBytes=[Convert]::FromBase64String([string]$response.PayloadBase64)
    try{$payload=[Text.Encoding]::UTF8.GetString($canonicalPayloadBytes)|ConvertFrom-Json}catch{throw 'The canonical bootstrap payload is invalid.'}
    if($payload.Schema-cne'DLE-OS-DEV-FRONTEND-FILESERVER-BOOTSTRAP-RESPONSE-V2'){throw 'The bootstrap response schema is invalid.'}
    if($payload.Simulation-and-not($ValidateBootstrapOnly-and$AllowSimulationEvidence)){throw 'Simulation evidence can never authorize migration.'}
    if($payload.TransactionId-cne$request.TransactionId-or$payload.RequestSha256-cne$requestHash-or$payload.RequestNonce-cne$request.Nonce-or$payload.ComputerName-cne'DELEON-SERVER'-or$payload.QualifiedIdentity-cne$fileServerIdentity){throw 'Bootstrap response binding validation failed.'}
    $entropy=[Text.Encoding]::UTF8.GetBytes("DLE-OS|DEV-FRONTEND|$($request.TransactionId)|HOST-HANDOFF-V2");$protected=[IO.File]::ReadAllBytes($privatePath);$plain=$null;$passwordBytes=$null;$rsa=$null
    try{
        $plain=Unprotect-DleOsBytes $protected $entropy CurrentUser;$private=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json
        if($private.TransactionId-cne$request.TransactionId-or$private.RequestSha256-cne$requestHash-or$private.Nonce-cne$request.Nonce){throw 'The host-private handoff does not match the request.'}
        $csp=New-Object Security.Cryptography.CspParameters;$csp.ProviderType=24;$csp.Flags=[Security.Cryptography.CspProviderFlags]::UseMachineKeyStore
        $rsa=New-Object Security.Cryptography.RSACryptoServiceProvider -ArgumentList 3072,$csp;$rsa.PersistKeyInCsp=$false
        $rsa.ImportParameters((ConvertFrom-DleOsRsaParametersRecord $private.PrivateKey -IncludePrivate))
        $encrypted=[Convert]::FromBase64String([string]$payload.EncryptedPassword)
        try{$passwordBytes=$rsa.Decrypt($encrypted,$true)}finally{[Array]::Clear($encrypted,0,$encrypted.Length)}
        $payloadBytes=$canonicalPayloadBytes
        try{
            if((Get-DleOsSha256Hex $payloadBytes)-cne$response.PayloadSha256){throw 'Bootstrap payload checksum mismatch.'}
            if((Get-DleOsHmacSha256 $passwordBytes $payloadBytes)-cne$response.EvidenceHmacSha256){throw 'Bootstrap evidence signature mismatch.'}
        }finally{$canonicalPayloadBytes=$null}
        $secure=New-Object Security.SecureString;foreach($byte in $passwordBytes){$secure.AppendChar([char]$byte)};$secure.MakeReadOnly()
        [pscustomobject]@{TransactionId=[string]$request.TransactionId;RequestSha256=$requestHash;ResponseSha256=$responseHash;SecurePassword=$secure;Response=$response}
    }finally{
        if($canonicalPayloadBytes){[Array]::Clear($canonicalPayloadBytes,0,$canonicalPayloadBytes.Length)};if($passwordBytes){[Array]::Clear($passwordBytes,0,$passwordBytes.Length)};if($plain){[Array]::Clear($plain,0,$plain.Length)};[Array]::Clear($protected,0,$protected.Length);[Array]::Clear($entropy,0,$entropy.Length);if($rsa){$rsa.PersistKeyInCsp=$false;$rsa.Clear()}
    }
}
function Test-RemoteKittingBoundary([Management.Automation.PSCredential]$Credential){
    $addresses=@(Resolve-DnsName -Name 'DELEON-SERVER' -Type A -ErrorAction Stop|ForEach-Object{
        $addressProperty=$_.PSObject.Properties['IPAddress']
        if($null-ne$addressProperty-and-not[string]::IsNullOrWhiteSpace([string]$addressProperty.Value)){[string]$addressProperty.Value}
    }|Sort-Object -Unique)
    if($addresses.Count-ne 1){throw "DELEON-SERVER must resolve to exactly one IPv4 address for isolated credential qualification; found $($addresses.Count)."}
    $serverAddress=[string]$addresses[0]
    if(@(Get-SmbConnection -ServerName $serverAddress -ErrorAction SilentlyContinue).Count-ne 0){throw "An existing $serverAddress SMB session would make credential qualification ambiguous."}
    $qualificationRoot="\\$serverAddress\Production"
    $runtimeRoot='\\DELEON-SERVER\Production'
    $drive='DLEKIT'+([Guid]::NewGuid().ToString('N').Substring(0,8));$created=$false
    try{
        New-PSDrive -Name $drive -PSProvider FileSystem -Root $qualificationRoot -Credential $Credential -Scope Script -ErrorAction Stop|Out-Null;$created=$true
        foreach($relative in 'KITTING\KIT-SHORTAGES','KITTING\KIT-COMPLETE'){
            $path="$drive`:\$relative"
            if(-not(Test-Path -LiteralPath $path -PathType Container)){throw "The staged identity cannot read $relative."}
            [void]@(Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop|Select-Object -First 1)
        }
        [pscustomobject]@{ExactKittingRead=$true;Scope='ApprovedKittingRootsOnly';QualificationRoot=$qualificationRoot;RuntimeRoot=$runtimeRoot}
    }finally{if($created){Remove-PSDrive -Name $drive -Force -ErrorAction SilentlyContinue}}
}
function Invoke-SqlBootstrap([ValidateSet('Inspect','Grant','Remove')][string]$Mode){
    $resultPath=Join-Path $workRoot "sql-$($Mode.ToLowerInvariant()).json";$arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"{0}"'-f$sqlBootstrap),'-Mode',$Mode,'-ResultPath',('"{0}"'-f$resultPath))
    $process=Start-Process powershell.exe -Credential $SqlAdministratorCredential -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if($process.ExitCode-ne 0-or-not(Test-Path $resultPath)){throw "Governed SQL $Mode failed with exit code $($process.ExitCode)."};$result=Get-Content -Raw $resultPath|ConvertFrom-Json;if($result.Verdict-ne'PASS'-or$result.ExecutedAs-ine$legacyIdentity){throw "Governed SQL $Mode evidence is invalid."};$result
}
function Resolve-TaskPrincipalName([string]$UserId){
    if($UserId-like'S-1-*'){return ([Security.Principal.SecurityIdentifier]$UserId).Translate([Security.Principal.NTAccount]).Value}
    $UserId
}
function Get-OptionalPropertyValue([object]$Object,[string]$Name,[object]$Default=$null){$property=$Object.PSObject.Properties[$Name];if($null-eq$property){return $Default};$property.Value}
function Get-LegacyTaskXmlDefinition([string]$TaskPath){
    $xmlText=Export-ScheduledTask -TaskName $legacyTaskName -TaskPath $TaskPath;[xml]$document=$xmlText;$namespace=New-Object Xml.XmlNamespaceManager($document.NameTable);$namespace.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
    $actions=@($document.SelectNodes('//t:Actions/t:Exec',$namespace));$triggers=@($document.SelectNodes('//t:Triggers/*',$namespace));$action=if($actions.Count-eq 1){$actions[0]}else{$null}
    $userNode=$document.SelectSingleNode('//t:Principals/t:Principal/t:UserId',$namespace);$enabledNode=$document.SelectSingleNode('//t:Settings/t:Enabled',$namespace);$multipleNode=$document.SelectSingleNode('//t:Settings/t:MultipleInstancesPolicy',$namespace);$restartCountNode=$document.SelectSingleNode('//t:Settings/t:RestartOnFailure/t:Count',$namespace);$restartIntervalNode=$document.SelectSingleNode('//t:Settings/t:RestartOnFailure/t:Interval',$namespace)
    $commandNode=if($action){$action.SelectSingleNode('t:Command',$namespace)}else{$null};$argumentsNode=if($action){$action.SelectSingleNode('t:Arguments',$namespace)}else{$null};$workingDirectoryNode=if($action){$action.SelectSingleNode('t:WorkingDirectory',$namespace)}else{$null}
    $execute=if($commandNode){[string]$commandNode.InnerText}else{''};$arguments=if($argumentsNode){[string]$argumentsNode.InnerText}else{''};$workingDirectory=if($workingDirectoryNode){[string]$workingDirectoryNode.InnerText}else{''};$principalName=if($userNode){Resolve-TaskPrincipalName ([string]$userNode.InnerText)}else{''}
    [pscustomobject]@{XmlText=$xmlText;ActionCount=$actions.Count;Execute=$execute;Arguments=$arguments;WorkingDirectory=$workingDirectory;Principal=$principalName;TriggerCount=$triggers.Count;Triggers=@($triggers|ForEach-Object{$_.OuterXml});Enabled=if($enabledNode){[bool]::Parse($enabledNode.InnerText)}else{$true};MultipleInstances=if($multipleNode){[string]$multipleNode.InnerText}else{'IgnoreNew'};RestartCount=if($restartCountNode){[int]$restartCountNode.InnerText}else{0};RestartInterval=if($restartIntervalNode){[string]$restartIntervalNode.InnerText}else{''}}
}
function Get-NormalizedLegacyTaskXmlSha256([string]$Path){
    [xml]$document=Get-Content -Raw -LiteralPath $Path;$namespace=New-Object Xml.XmlNamespaceManager($document.NameTable);$namespace.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
    $enabledNode=$document.SelectSingleNode('//t:Settings/t:Enabled',$namespace);if($null-ne$enabledNode){[void]$enabledNode.ParentNode.RemoveChild($enabledNode)}
    $bytes=[Text.Encoding]::UTF8.GetBytes($document.OuterXml);$sha=[Security.Cryptography.SHA256]::Create()
    try{return([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','')}finally{$sha.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
}
function Get-LegacyTaskSnapshot{
    $tasks=@(Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue)
    if($tasks.Count-ne 1){throw "The rollback baseline requires exactly one $legacyTaskName task; found $($tasks.Count)."}
    $task=$tasks[0];$definition=Get-LegacyTaskXmlDefinition $task.TaskPath;$definition.XmlText|Set-Content -LiteralPath $legacyTaskSnapshotPath -Encoding Unicode
    $isPowerShell=if([string]::IsNullOrWhiteSpace($definition.Execute)){$false}else{[IO.Path]::GetFileName($definition.Execute)-ieq'powershell.exe'}
    $usesGovernedStartScript=$definition.Arguments.IndexOf($legacyStartScript,[StringComparison]::OrdinalIgnoreCase)-ge 0
    $startScriptText=Get-Content -Raw -LiteralPath $legacyStartScript;$canLaunch5051=$startScriptText.IndexOf('http://dle-os-host:5051',[StringComparison]::OrdinalIgnoreCase)-ge 0;$canLaunchAuthGateway=$startScriptText.IndexOf('https://auth.internal.dlemfg.com:443',[StringComparison]::OrdinalIgnoreCase)-ge 0
    if($definition.ActionCount-ne 1-or-not$isPowerShell-or-not$usesGovernedStartScript-or$definition.Principal-ine$legacyIdentity-or-not$canLaunch5051-or-not$canLaunchAuthGateway){throw "The captured task is not the DLE-OS 5051 rollback launcher. XML=$legacyTaskSnapshotPath"}
    $info=Get-ScheduledTaskInfo -TaskName $legacyTaskName -TaskPath $task.TaskPath
    [pscustomobject]@{Name=$task.TaskName;Path=$task.TaskPath;Classification='RollbackCreatedLegacy5051Launcher';Enabled=$definition.Enabled;State=[string]$task.State;Execute=$definition.Execute;Arguments=$definition.Arguments;WorkingDirectory=$definition.WorkingDirectory;Principal=$definition.Principal;TriggerCount=$definition.TriggerCount;Triggers=$definition.Triggers;MultipleInstances=$definition.MultipleInstances;RestartCount=$definition.RestartCount;RestartInterval=$definition.RestartInterval;LastRunTime=$info.LastRunTime;LastTaskResult=[int64]$info.LastTaskResult;NextRunTime=$info.NextRunTime;XmlPath=$legacyTaskSnapshotPath;XmlSha256=Get-DleOsFileSha256 $legacyTaskSnapshotPath;CanLaunch5051=$canLaunch5051;CanLaunchAuthGateway=$canLaunchAuthGateway;CanStartFrontendWorker=$definition.Enabled}
}
function Set-LegacyTaskRetired{
    $script:legacyTaskDisabled=$true
    Disable-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.ScheduledTask.Path|Out-Null
    $task=Get-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.ScheduledTask.Path
    if([bool]$task.Settings.Enabled-or[string]$task.State-eq'Running'){throw 'The legacy 5051 Scheduled Task did not reach a disabled, non-running state.'}
    $evidence.LegacyScheduledTaskRetired=[pscustomobject]@{Retained=$true;Enabled=$false;State=[string]$task.State}
}
function Restore-LegacyTaskState{
    if($null-eq$baseline-or$null-eq$baseline.ScheduledTask){return}
    $task=Get-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.ScheduledTask.Path -ErrorAction Stop;$definition=Get-LegacyTaskXmlDefinition $baseline.ScheduledTask.Path
    if($definition.ActionCount-ne 1-or$definition.Execute-ine$baseline.ScheduledTask.Execute-or$definition.Arguments-cne$baseline.ScheduledTask.Arguments-or$definition.WorkingDirectory-cne[string]$baseline.ScheduledTask.WorkingDirectory-or$definition.Principal-ine$baseline.ScheduledTask.Principal){throw 'The retained legacy Scheduled Task changed and cannot be safely restored.'}
    if([bool]$baseline.ScheduledTask.Enabled){Enable-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.ScheduledTask.Path|Out-Null}else{Disable-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.ScheduledTask.Path|Out-Null}
    $after=Get-ScheduledTask -TaskName $legacyTaskName -TaskPath $baseline.ScheduledTask.Path
    if([bool]$after.Settings.Enabled-ne[bool]$baseline.ScheduledTask.Enabled){throw 'The legacy Scheduled Task enabled state was not restored.'}
}
function Get-LegacyBaseline{
    $taskSnapshot=Get-LegacyTaskSnapshot
    $workers=@(Get-FrontendWorkers);if($workers.Count-ne 1){throw "The rollback baseline requires exactly one detached frontend worker; found $($workers.Count)."}
    $worker=$workers[0];$owner=Get-ProcessOwner $worker;if($owner-ine$legacyIdentity){throw "Rollback worker PID $($worker.ProcessId) is owned by $owner, not $legacyIdentity."}
    $launch=Get-Content -Raw $legacyLaunchEvidence|ConvertFrom-Json
    if($launch.Verdict-cne'PASS'-or$launch.Identity-ine$legacyIdentity-or[int]$launch.ProcessId-ne[int]$worker.ProcessId-or$launch.AlreadyRunning){throw 'The current worker does not match the governed detached-launch evidence.'}
    $prefixes=@(Get-WorkerHttpPrefixes ([int]$worker.ProcessId));if($prefixes.Count-eq 0-or$prefixes-notcontains'HTTPS://AUTH.INTERNAL.DLEMFG.COM:443/'){throw 'The current worker HTTP.sys ownership baseline is incomplete.'}
    $launchTransaction=$null;$originallyLaunchedByScheduledTask=$true;$currentLaunchMechanism='ScheduledTaskLaunchDetachedWorker'
    foreach($file in @(Get-ChildItem (Join-Path $repository '.tmp\environment-separation') -Recurse -Filter deployment.json|Sort-Object LastWriteTime -Descending)){
        $item=Get-Content -Raw $file.FullName|ConvertFrom-Json;$restored=$item.PSObject.Properties['FrontendRollbackRestored'];$rollbackWorker=$item.PSObject.Properties['RollbackWorkerId']
        if($null-ne$restored-and$null-ne$rollbackWorker-and[bool]$restored.Value-and[int]$rollbackWorker.Value-eq[int]$worker.ProcessId){$launchTransaction=[pscustomobject]@{Path=$file.FullName;Sha256=Get-DleOsFileSha256 $file.FullName;StartedAtUtc=$item.StartedAtUtc;CompletedAtUtc=$item.CompletedAtUtc};break}
    }
    if($null-eq$launchTransaction){
        $launchStarted=[DateTimeOffset]::Parse([string]$launch.StartedAtUtc)
        foreach($directory in @(Get-ChildItem (Join-Path $repository '.tmp\windows-service-migration') -Directory|Sort-Object LastWriteTimeUtc -Descending)){
            $sqlRemovePath=Join-Path $directory.FullName 'sql-remove.json';$taskXmlPath=Join-Path $directory.FullName 'legacy-scheduled-task.xml';$rollbackRuntimePath=Join-Path $directory.FullName 'rollback-detached-runtime'
            if(-not(Test-Path $sqlRemovePath -PathType Leaf)-or-not(Test-Path $taskXmlPath -PathType Leaf)-or-not(Test-Path $rollbackRuntimePath -PathType Container)){continue}
            $sqlRemove=Get-Content -Raw $sqlRemovePath|ConvertFrom-Json;$sqlRemoveTime=[DateTimeOffset](Get-Item $sqlRemovePath).LastWriteTimeUtc;$elapsed=($launchStarted-$sqlRemoveTime).TotalSeconds
            if($sqlRemove.Verdict-cne'PASS'-or$sqlRemove.Mode-cne'Remove'-or[bool]$sqlRemove.After.LoginExists-or[bool]$sqlRemove.After.UserExists-or$elapsed-lt 0-or$elapsed-gt 30-or(Get-NormalizedLegacyTaskXmlSha256 $taskXmlPath)-cne(Get-NormalizedLegacyTaskXmlSha256 $taskSnapshot.XmlPath)){continue}
            $launchTransaction=[pscustomobject]@{Kind='GovernedWindowsServiceMigrationRollback';Path=$directory.FullName;SqlRemovePath=$sqlRemovePath;SqlRemoveSha256=Get-DleOsFileSha256 $sqlRemovePath;TaskXmlPath=$taskXmlPath;TaskXmlSha256=Get-DleOsFileSha256 $taskXmlPath;NormalizedTaskDefinitionSha256=Get-NormalizedLegacyTaskXmlSha256 $taskXmlPath;CurrentTaskEnabled=[bool]$taskSnapshot.Enabled;RollbackRuntimePath=$rollbackRuntimePath;RollbackWorkerStartedAtUtc=$launch.StartedAtUtc}
            $originallyLaunchedByScheduledTask=$false;$currentLaunchMechanism='GovernedServiceMigrationRollback';break
        }
    }
    if($null-eq$launchTransaction){throw 'The current worker cannot be correlated to the governed Scheduled Task rollback launch.'}
    $parentPresent=[bool](Get-CimInstance Win32_Process -Filter "ProcessId=$($worker.ParentProcessId)" -ErrorAction SilentlyContinue)
    [pscustomobject]@{Mechanism='ScheduledTaskLaunchDetachedWorker';CurrentLaunchMechanism=$currentLaunchMechanism;ProcessId=[int]$worker.ProcessId;ParentProcessId=[int]$worker.ParentProcessId;ParentStillPresent=$parentPresent;CurrentOwnership='DetachedHistoricalWorker';OriginallyLaunchedByScheduledTask=$originallyLaunchedByScheduledTask;Owner=$owner;StartScript=$legacyStartScript;StartScriptSha256=Get-DleOsFileSha256 $legacyStartScript;LaunchEvidence=$legacyLaunchEvidence;LaunchTransaction=$launchTransaction;HttpPrefixes=$prefixes;ScheduledTaskPresent=$true;ScheduledTask=$taskSnapshot}
}
function Start-LegacyRollbackRuntime{
    $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"{0}"'-f$legacyStartScript))
    $launcher=Start-Process powershell.exe -Credential $SqlAdministratorCredential -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if($launcher.ExitCode-ne 0){throw "Detached rollback launcher failed with exit code $($launcher.ExitCode)."}
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds(45);do{$workers=@(Get-FrontendWorkers);if($workers.Count-eq 1){$owner=Get-ProcessOwner $workers[0];if($owner-ine$legacyIdentity){throw "Rollback worker owner is $owner."};$auth=Get-HttpPrefixRegistration 'HTTPS://AUTH.INTERNAL.DLEMFG.COM:443/';if($auth.Registered-and$workers[0].ProcessId-in$auth.ProcessIds){return $workers[0]}};Start-Sleep -Milliseconds 250}while([DateTimeOffset]::UtcNow-lt$deadline);throw 'The exact detached rollback runtime was not restored.'
}
function Assert-SingleServiceWorker{
    $service=Wait-ServiceState Running 45;$workers=@(Get-FrontendWorkers)
    if($service.ProcessId-le 0-or$workers.Count-ne 1-or$workers[0].ProcessId-ne$service.ProcessId-or$workers[0].Name-ine'DleOs.DevelopmentFrontend.exe'){throw 'SCM does not directly own exactly one frontend executable.'}
    foreach($url in $urls){$registration=Get-HttpPrefixRegistration $url;if(-not$registration.Registered-or$service.ProcessId-notin$registration.ProcessIds){throw "SCM PID $($service.ProcessId) does not own $url."}}
    $evidence.ServiceProcessId=[int]$service.ProcessId
}
function Assert-HttpStatus([string]$Uri,[int]$Expected){$response=Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 20;if([int]$response.StatusCode-ne$Expected){throw "$Uri returned $($response.StatusCode), expected $Expected."}}
function Assert-LegacyIdentityHttpStatus([string]$Uri,[int]$Expected){
    $probe="`$ErrorActionPreference='Stop';try{`$response=Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -Uri '$Uri' -TimeoutSec 20;if([int]`$response.StatusCode-ne$Expected){exit 3};exit 0}catch{exit 2}"
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe));$process=Start-Process powershell.exe -Credential $SqlAdministratorCredential -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded) -WindowStyle Hidden -Wait -PassThru
    if($process.ExitCode-ne 0){throw "$Uri did not return $Expected under $legacyIdentity (probe exit $($process.ExitCode))."}
}
function Invoke-RollbackStep([string]$Name,[scriptblock]$Action){try{&$Action;$evidence[('Rollback_'+($Name-replace'[^A-Za-z0-9]','_'))]='PASS'}catch{$evidence[('Rollback_'+($Name-replace'[^A-Za-z0-9]','_'))]="FAIL: $($_.Exception.Message)"}}
function Set-TransactionStage([string]$Stage){$evidence.CurrentStage=$Stage;[pscustomobject]@{Stage=$Stage;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $workRoot 'stage.json') -Encoding utf8}

New-Item -ItemType Directory -Path $workRoot -Force|Out-Null
try{
    $canonicalPrefix=(Resolve-Path -LiteralPath $stateRoot).Path.TrimEnd('\')+'\'
    foreach($transactionDirectory in $BootstrapRequestDirectory,$BootstrapResponseDirectory){$resolved=(Resolve-Path -LiteralPath $transactionDirectory).Path;if(-not$resolved.StartsWith($canonicalPrefix,[StringComparison]::OrdinalIgnoreCase)){throw "Transaction state must be beneath canonical root $stateRoot; received $resolved."}}
    $evidence.CanonicalStateRootExists=$true;$evidence.NonCanonicalStateRootExists=[bool](Test-Path -LiteralPath $nonCanonicalStateRoot)
    if($evidence.NonCanonicalStateRootExists){throw "Noncanonical transaction root exists and must be reconciled before migration: $nonCanonicalStateRoot"}
    $handoff=Read-BootstrapHandoff
    $evidence.BootstrapTransactionId=$handoff.TransactionId;$evidence.BootstrapRequestSha256=$handoff.RequestSha256;$evidence.BootstrapResponseSha256=$handoff.ResponseSha256;$evidence.BootstrapSignatureValidated=$true
    if($ValidateBootstrapOnly){$evidence.Verdict='PASS';$evidence.ValidationOnly=$true;return [pscustomobject]$evidence}
    Assert-Administrator
    if(-not$ApproveMigration){throw 'Explicit -ApproveMigration is required.'}
    if($env:COMPUTERNAME-ine'DLE-OS-HOST'){throw 'This transaction must run locally on DLE-OS-HOST.'}
    if($SqlAdministratorCredential.UserName-ine$legacyIdentity){throw "The SQL/rollback credential must be exactly $legacyIdentity."}
    Add-Type -Path $accountRightsSource;[DleOsServiceAccountRights]::ValidateCredential($legacyIdentity,$SqlAdministratorCredential.Password);$evidence.SqlBootstrapCredentialValidated=$true
    $serviceCredential=[Management.Automation.PSCredential]::new($serviceIdentity,$handoff.SecurePassword)
    $remoteCredential=[Management.Automation.PSCredential]::new($fileServerIdentity,$handoff.SecurePassword)
    $evidence.KittingPreflight=Test-RemoteKittingBoundary $remoteCredential
    if(Get-LocalUser -Name $serviceAccountName -ErrorAction SilentlyContinue){throw 'The dedicated host account already exists.'}
    if(Get-Service -Name $serviceName -ErrorAction SilentlyContinue){throw "$serviceName already exists."}
    $sqlInspection=Invoke-SqlBootstrap Inspect;$evidence.SqlPrincipalBefore=$sqlInspection.After;if($sqlInspection.After.LoginExists-or$sqlInspection.After.UserExists){throw 'The dedicated DEV SQL principal already exists.'}
    $baseline=Get-LegacyBaseline;$evidence.RollbackBaseline=$baseline
    $evidence.SourceHead=(git -c "safe.directory=$($repository.Replace('\','/'))" -C $repository rev-parse HEAD);$evidence.GitBefore=@(git -c "safe.directory=$($repository.Replace('\','/'))" -C $repository status --porcelain=v1)
    $evidence.ProtectedBefore=Get-ProtectedSnapshot
    $urlAclBefore=@($urls|ForEach-Object{Get-UrlAclSnapshot $_});$evidence.UrlAclBefore=$urlAclBefore
    $evidence.SslDevBefore=(&netsh.exe http show sslcert 'hostnameport=dev.dle-os.internal.dlemfg.com:443' 2>&1|Out-String);$evidence.SslAuthBefore=(&netsh.exe http show sslcert 'hostnameport=auth.internal.dlemfg.com:443' 2>&1|Out-String)
    $evidence.CertificatePrivateKeyBefore=@(Get-CertificatePrivateKeySnapshot 'dev.dle-os.internal.dlemfg.com:443';Get-CertificatePrivateKeySnapshot 'auth.internal.dlemfg.com:443')
    Copy-Item -Path $runtime -Destination $rollbackRuntime -Recurse -Force
    &dotnet.exe publish $project -c Release -o $publish --artifacts-path $artifacts
    if($LASTEXITCODE-ne 0-or-not(Test-Path (Join-Path $publish 'DleOs.DevelopmentFrontend.exe'))){throw 'The Windows Service candidate publish failed.'}
    if(-not$PSCmdlet.ShouldProcess($serviceName,'replace the detached DEV frontend with the SCM-owned service')){throw 'Migration approval was declined.'}

    New-Item -ItemType Directory -Path $release -Force|Out-Null;$releaseCreated=$true
    Copy-Item -Path (Join-Path $publish '*') -Destination $release -Recurse -Force;Copy-Item $configurationSource $serviceConfiguration -Force
    $localAccountCreated=$true;New-LocalUser -Name $serviceAccountName -Password $handoff.SecurePassword -AccountNeverExpires -UserMayNotChangePassword -Description 'DLE-OS isolated DEV frontend Windows Service'|Out-Null
    Get-LocalGroup|ForEach-Object{Remove-LocalGroupMember -Group $_.Name -Member $serviceIdentity -ErrorAction SilentlyContinue}
    [DleOsServiceAccountRights]::ValidateCredential($serviceIdentity,$handoff.SecurePassword)
    if(-not[DleOsServiceAccountRights]::HasRight($serviceIdentity,$serviceLogonRight)){$serviceLogonRightAdded=$true;[DleOsServiceAccountRights]::AddRight($serviceIdentity,$serviceLogonRight)}
    if(-not[DleOsServiceAccountRights]::HasRight($serviceIdentity,$denyInteractiveRight)){$denyInteractiveRightAdded=$true;[DleOsServiceAccountRights]::AddRight($serviceIdentity,$denyInteractiveRight)}
    if(-not[DleOsServiceAccountRights]::HasRight($serviceIdentity,$denyRemoteInteractiveRight)){$denyRemoteInteractiveRightAdded=$true;[DleOsServiceAccountRights]::AddRight($serviceIdentity,$denyRemoteInteractiveRight)}
    $evidence.ServiceLogonRightAdded=$serviceLogonRightAdded;$evidence.DenyInteractiveRightAdded=$denyInteractiveRightAdded;$evidence.DenyRemoteInteractiveRightAdded=$denyRemoteInteractiveRightAdded
    Set-TransactionStage 'SqlGrant';$sqlPrincipalCreated=$true;$evidence.SqlGrant=Invoke-SqlBootstrap Grant;$evidence.SqlPrincipalCreated=$true
    $binaryPath=('"{0}" --dle-os-windows-service --service-config "{1}"'-f(Join-Path $release 'DleOs.DevelopmentFrontend.exe'),$serviceConfiguration)
    Set-TransactionStage 'ServiceInstall';$serviceCreated=$true;New-Service -Name $serviceName -BinaryPathName $binaryPath -Credential $serviceCredential -StartupType Automatic -DependsOn @('HTTP','DleOsKeycloak') -DisplayName 'DLE-OS Development Frontend'|Out-Null
    $null=Invoke-Native sc.exe @('failure',$serviceName,'reset=','86400','actions=','restart/60000/restart/120000/none/0');$null=Invoke-Native sc.exe @('failureflag',$serviceName,'1')
    $aclPaths=@($repository,$release,'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys','C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\issuer-private.pem','C:\ProgramData\DLE-OS\Keycloak\Secrets','C:\ProgramData\DLE-OS\Keycloak\Secrets\oidc-client-secret.dpapi','C:\ProgramData\DLE-OS\Keycloak\Secrets\provisioning-client-secret.dpapi')
    Set-TransactionStage 'FilesystemAcl';$aclBefore=@($aclPaths|ForEach-Object{Get-AclSnapshot $_});$evidence.FileSystemAclBefore=$aclBefore;$fileAclsChanged=$true
    Grant-Read $repository;Grant-Read $release;Grant-Traverse 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys';Grant-FileRead 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\issuer-private.pem';Grant-Traverse 'C:\ProgramData\DLE-OS\Keycloak\Secrets';Grant-FileRead 'C:\ProgramData\DLE-OS\Keycloak\Secrets\oidc-client-secret.dpapi';Grant-FileRead 'C:\ProgramData\DLE-OS\Keycloak\Secrets\provisioning-client-secret.dpapi'
    Set-TransactionStage 'LegacyTaskRetire';Set-LegacyTaskRetired
    Set-TransactionStage 'LegacyWorkerStopAndRelease';Stop-Process -Id $baseline.ProcessId -Force -Confirm:$false;$legacyStopped=$true;Wait-NoFrontendWorkers 45;Wait-Release @($baseline.HttpPrefixes) 45
    Set-TransactionStage 'UrlAclTransfer';$urlAclsChanged=$true;Set-ServiceUrlAcls
    Set-TransactionStage 'ServiceStart';Start-Service -Name $serviceName
    Set-TransactionStage 'SingletonOwnership';Assert-SingleServiceWorker
    $evidence.KittingQualification=[pscustomobject]@{Verdict='PASS';ExecutedAs=$serviceIdentity;Mechanism='SynchronousWindowsServiceBootstrap';ShortageRoot='\\DELEON-SERVER\Production\KITTING\KIT-SHORTAGES';CompleteRoot='\\DELEON-SERVER\Production\KITTING\KIT-COMPLETE';Proof='SCM service reached Running only after EnsureDirectoryReadable enumerated both roots.'}
    Set-TransactionStage 'HealthDevShared';Assert-HttpStatus 'https://dev.dle-os.internal.dlemfg.com/shared' 200
    Set-TransactionStage 'HealthAuthGateway';Assert-HttpStatus 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration' 200
    Set-TransactionStage 'Health5051Rollback';Assert-HttpStatus 'http://dle-os-host:5051/shared' 200
    Set-TransactionStage 'Health5052Read';Assert-HttpStatus 'http://DLE-OS-HOST:5052/api/platform/live/v1/sales-orders?page=1&pageSize=1' 200
    Set-TransactionStage 'Health5054Operational';Assert-LegacyIdentityHttpStatus 'http://DLE-OS-HOST:5054/health' 200
    $evidence.CertificatePrivateKeyAfter=@(Get-CertificatePrivateKeySnapshot 'dev.dle-os.internal.dlemfg.com:443';Get-CertificatePrivateKeySnapshot 'auth.internal.dlemfg.com:443')
    if(($evidence.CertificatePrivateKeyBefore|ConvertTo-Json -Depth 6 -Compress)-cne($evidence.CertificatePrivateKeyAfter|ConvertTo-Json -Depth 6 -Compress)){throw 'SSL binding or certificate private-key ACL changed during migration.'}
    $evidence.ProtectedAfter=Get-ProtectedSnapshot;foreach($port in $protectedPorts){if(($evidence.ProtectedBefore[[string]$port]-join',')-ne($evidence.ProtectedAfter[[string]$port]-join',')){throw "Protected listener $port changed."}}
    $evidence.LegacyRuntimeDisposition='Prior task-launched detached worker stopped; legacy Scheduled Task retained disabled.';$evidence.FileServerBootstrapDisposition='Retained as the approved service prerequisite.';$evidence.Verdict='PASS'
}catch{
    $errorText=$_.Exception.Message;$evidence.Error=$errorText;$evidence.RollbackAttempted=$true
    [pscustomobject]@{Stage=$evidence.CurrentStage;Error=$errorText;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $workRoot 'failure.json') -Encoding utf8
    Invoke-RollbackStep 'candidate service removal' {if($serviceCreated){Stop-Service $serviceName -Force -ErrorAction SilentlyContinue;sc.exe delete $serviceName|Out-Null}}
    Invoke-RollbackStep 'URL ACL restoration' {if($urlAclsChanged){Restore-UrlAcls $urlAclBefore}}
    Invoke-RollbackStep 'filesystem ACL restoration' {if($fileAclsChanged){Restore-Acls $aclBefore}}
    Invoke-RollbackStep 'prior runtime binaries' {if($legacyStopped-and(Test-Path $rollbackRuntime)){Copy-Item -Path (Join-Path $rollbackRuntime '*') -Destination $runtime -Recurse -Force}}
    Invoke-RollbackStep 'SQL principal removal' {if($sqlPrincipalCreated){$evidence.SqlRollback=Invoke-SqlBootstrap Remove}}
    Invoke-RollbackStep 'local account rights' {if($localAccountCreated){if($denyRemoteInteractiveRightAdded){[DleOsServiceAccountRights]::RemoveRight($serviceIdentity,$denyRemoteInteractiveRight)};if($denyInteractiveRightAdded){[DleOsServiceAccountRights]::RemoveRight($serviceIdentity,$denyInteractiveRight)};if($serviceLogonRightAdded){[DleOsServiceAccountRights]::RemoveRight($serviceIdentity,$serviceLogonRight)}}}
    Invoke-RollbackStep 'local account removal' {if($localAccountCreated-and(Get-LocalUser $serviceAccountName -ErrorAction SilentlyContinue)){Remove-LocalUser $serviceAccountName}}
    Invoke-RollbackStep 'detached runtime restoration' {if($legacyStopped){$worker=Start-LegacyRollbackRuntime;$evidence.RollbackWorkerId=[int]$worker.ProcessId;$evidence.RollbackRuntimeMechanism='DetachedStartDevelopmentFrontend'}}
    Invoke-RollbackStep 'legacy Scheduled Task restoration' {if($legacyTaskDisabled){Restore-LegacyTaskState;$evidence.RollbackLegacyScheduledTaskEnabled=[bool]$baseline.ScheduledTask.Enabled}}
    Invoke-RollbackStep 'protected listener verification' {if($evidence.Contains('ProtectedBefore')){$after=Get-ProtectedSnapshot;foreach($port in $protectedPorts){if(($evidence.ProtectedBefore[[string]$port]-join',')-ne($after[[string]$port]-join',')){throw "Protected listener $port changed during rollback."}};$evidence.ProtectedAfterRollback=$after}}
    $evidence.FileServerRollbackRequired=$true
    $evidence.FileServerRollbackExecutable='DleOsLegacyFileServerBootstrap.exe'
    $rollbackTransactionId=if($handoff){[string]$handoff.TransactionId}else{'UNAVAILABLE'}
    $evidence.FileServerRollbackArguments="rollback C:\ProgramData\DLE-OS\DevelopmentFrontend\Bootstrap\$rollbackTransactionId\fileserver-rollback-state.dpapi"
    throw $errorText
}finally{
    if($handoff-and$handoff.SecurePassword){$handoff.SecurePassword.Dispose()};$serviceCredential=$null;$remoteCredential=$null;$SqlAdministratorCredential=$null
    $evidence.CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');$evidence|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $evidencePath -Encoding utf8
}
[pscustomobject]$evidence
