[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param(
    [Parameter(Mandatory)]
    [switch]$ApproveDevelopmentDeployment
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'DevFrontendDeployment.Common.ps1')

$serviceName = 'DleOsDevelopmentFrontend'
$serviceIdentity = 'DLE-OS-HOST\DLE-OS-DEV-FRONTEND'
$rejectedTaskName = 'DLE-OS Development Authenticated Frontend 5051'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$project = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DleOs.DevelopmentFrontend.csproj'
$configurationSource = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\service-runtime.Development.json'
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$workRoot = Join-Path $repository ".tmp\windows-service-deployment\$stamp"
$publish = Join-Path $workRoot 'publish'
$artifacts = Join-Path $workRoot 'artifacts'
$evidencePath = Join-Path $workRoot 'deployment.json'
$release = "C:\ProgramData\DLE-OS\DevelopmentFrontend\Service\releases\$stamp"
$serviceConfiguration = Join-Path $release 'service-runtime.json'
$authenticationStateRoot = 'C:\ProgramData\DLE-OS\DevelopmentFrontend\AuthState'
$authenticationKeyRoot = Join-Path $authenticationStateRoot 'DataProtectionKeys'
$authenticationTicketRoot = Join-Path $authenticationStateRoot 'Tickets'
$protectedPorts = 5041,5042,5043,5052,5053,5054
$urls = @(
    'http://dle-os-host:5051/',
    'http://192.168.0.105:5051/',
    'https://dev.dle-os.internal.dlemfg.com:443/',
    'https://auth.internal.dlemfg.com:443/'
)
$evidence = [ordered]@{
    StartedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    ServiceName=$serviceName
    ProductionDeploymentPerformed=$false
    Phase63Preserved=$true
    KeycloakMetadataChanged=$false
}
$previousBinaryPath = $null
$serviceStopped = $false

function Invoke-Native([string]$File,[string[]]$Arguments) {
    $output=& $File @Arguments 2>&1|Out-String
    if($LASTEXITCODE-ne 0){throw "$File failed ($LASTEXITCODE): $output"}
    $output
}
function Assert-Administrator {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=[Security.Principal.WindowsPrincipal]::new($identity)
    if(-not$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
        throw 'DEV Windows Service deployment requires an elevated administrator token.'
    }
    $evidence.OperatorIdentity=$identity.Name
}
function Get-ListenerOwners([int]$Port){
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue|
        Select-Object -ExpandProperty OwningProcess|Sort-Object -Unique)
}
function Get-ProtectedSnapshot{
    $result=[ordered]@{}
    foreach ($port in $protectedPorts) { $result[[string]$port]=@(Get-ListenerOwners $port) }
    $result
}
function Get-FrontendWorkers{
    @(Get-CimInstance Win32_Process -Filter "Name='dotnet.exe' OR Name='DleOs.DevelopmentFrontend.exe'"|
        Where-Object{$_.CommandLine-like'*DleOs.DevelopmentFrontend*'})
}
function Get-HttpPrefixRegistration([string]$Prefix){
    $state=Invoke-Native netsh.exe @('http','show','servicestate','view=requestq')
    $prefixForms=@(Get-DleOsHttpPrefixDisplayForms $Prefix)
    $blocks=@($state-split'(?im)(?=^Request queue name:)'|Where-Object{
        $block=$_.ToUpperInvariant();@($prefixForms|Where-Object{$block.Contains($_)}).Count-gt 0
    })
    $ids=@($blocks|ForEach-Object{[regex]::Matches($_,'(?im)^\s*ID:\s*(\d+),')|ForEach-Object{[int]$_.Groups[1].Value}}|Sort-Object -Unique)
    [pscustomobject]@{Registered=$blocks.Count-gt 0;ProcessIds=$ids}
}
function Wait-ServiceState([string]$State,[int]$Seconds=45){
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do{$service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
        if($service-and[string]$service.State-eq$State){return $service};Start-Sleep -Milliseconds 250
    }while([DateTimeOffset]::UtcNow-lt$deadline)
    throw "$serviceName did not reach $State. Last state=$($service.State)."
}
function Wait-Release([int]$PriorPid,[int]$Seconds=45){
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    do{$process=Get-Process -Id $PriorPid -ErrorAction SilentlyContinue;$tcp=@(Get-ListenerOwners 5051)
        $registered=@($urls|ForEach-Object{Get-HttpPrefixRegistration $_}|Where-Object Registered)
        if(-not$process-and$tcp.Count-eq 0-and$registered.Count-eq 0){return};Start-Sleep -Milliseconds 250
    }while([DateTimeOffset]::UtcNow-lt$deadline)
    throw "Service release timeout. PID=$PriorPid; TCP=$($tcp-join','); registrations=$($registered.Count)."
}
function Assert-ServiceCandidate([object]$ExpectedRuntimeInfo=$null){
    $service=Wait-ServiceState Running 45
    $workers=@(Get-FrontendWorkers)
    if($service.ProcessId-le 0-or$workers.Count-ne 1-or$workers[0].ProcessId-ne$service.ProcessId-or
        $workers[0].Name-ine'DleOs.DevelopmentFrontend.exe'){
        throw 'SCM does not directly own exactly one DEV frontend process.'
    }
    foreach ($url in $urls) {$registration=Get-HttpPrefixRegistration $url
        if(-not$registration.Registered-or$service.ProcessId-notin$registration.ProcessIds){throw "SCM PID $($service.ProcessId) does not own $url."}}
    foreach ($uri in 'https://dev.dle-os.internal.dlemfg.com/shared','https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration','http://dle-os-host:5051/shared') {
        $response=Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 20
        if([int]$response.StatusCode-ne 200){throw "$uri did not return 200."}
    }
    if($ExpectedRuntimeInfo){
        $runtimeInfo=Invoke-RestMethod -UseBasicParsing -Uri 'https://dev.dle-os.internal.dlemfg.com/api/runtime/info' -TimeoutSec 20
        if($runtimeInfo.environment-ne'Development'-or
           $runtimeInfo.releaseId-ne$ExpectedRuntimeInfo.releaseId-or
           $runtimeInfo.gitHead-ne$ExpectedRuntimeInfo.gitHead-or
           $runtimeInfo.sourceDirty-ne$ExpectedRuntimeInfo.sourceDirty-or
           $runtimeInfo.sourceDigestSha256-ne$ExpectedRuntimeInfo.sourceDigestSha256){
            throw 'The served runtime identity does not match the deployment candidate.'
        }
        $evidence.RuntimeInfoQualified=$true
    }
    $evidence.ServiceProcessId=[int]$service.ProcessId
}
function Set-ServiceBinaryPath([string]$BinaryPath){
    $null=Invoke-Native sc.exe @('config',$serviceName,'binPath=',$BinaryPath)
}
function Initialize-AuthenticationStateStorage([string]$ExpectedServiceSid){
    New-Item -ItemType Directory -Path $authenticationStateRoot -Force|Out-Null
    $null=Invoke-Native icacls.exe @($authenticationStateRoot,'/inheritance:r')
    $null=Invoke-Native icacls.exe @($authenticationStateRoot,'/grant:r',
        'NT AUTHORITY\SYSTEM:(OI)(CI)(F)','BUILTIN\Administrators:(OI)(CI)(F)',
        "${serviceIdentity}:(OI)(CI)(M)")
    New-Item -ItemType Directory -Path $authenticationKeyRoot,$authenticationTicketRoot -Force|Out-Null

    $acl=Get-Acl -LiteralPath $authenticationStateRoot
    $forbiddenSids=@('S-1-1-0','S-1-5-11','S-1-5-32-545')
    $serviceModify=$false
    foreach($rule in $acl.Access){
        $ruleSid=try{$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value}catch{''}
        if($ruleSid-eq$ExpectedServiceSid-and$rule.AccessControlType-eq'Allow'-and
           ($rule.FileSystemRights-band[Security.AccessControl.FileSystemRights]::Modify)){$serviceModify=$true}
        if($ruleSid-in$forbiddenSids-and$rule.AccessControlType-eq'Allow'){
            throw "DEV authentication state grants a forbidden broad principal: $ruleSid."
        }
    }
    if(-not$serviceModify){throw 'The DEV frontend service identity lacks Modify access to authentication state.'}
    [ordered]@{
        Root=$authenticationStateRoot
        DataProtection='DPAPI LocalMachine plus restricted filesystem ACL'
        TicketProtection='ASP.NET Core Data Protection purpose isolation'
        ServiceSid=$ExpectedServiceSid
        BroadLocalAccess=$false
        Qualified=$true
    }
}

New-Item -ItemType Directory -Path $workRoot -Force|Out-Null
try{
    Assert-Administrator
    if(-not$ApproveDevelopmentDeployment){throw 'Explicit -ApproveDevelopmentDeployment is required.'}
    if(-not$PSCmdlet.ShouldProcess($serviceName,'deploy a new versioned DEV frontend release')){throw 'Deployment approval was declined.'}
    $null=Assert-DleOsDevelopmentFrontendConfiguration $configurationSource
    $sourceIdentity=Get-DleOsDevelopmentFrontendSourceIdentity $repository
    $runtimeBuildInfo=[ordered]@{
        schemaVersion=1
        environment='Development'
        releaseId=$stamp
        builtAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
        gitHead=$sourceIdentity.GitHead
        sourceDirty=[bool]$sourceIdentity.SourceDirty
        sourceDigestSha256=$sourceIdentity.SourceDigestSha256
        sourceFileCount=[int]$sourceIdentity.SourceFileCount
        serviceName=$serviceName
        serviceIdentity=$serviceIdentity
    }
    $evidence.RuntimeIdentity=$runtimeBuildInfo
    $evidence.SourceHead=$sourceIdentity.GitHead
    $evidence.SourceDirty=[bool]$sourceIdentity.SourceDirty
    $evidence.SourceDigestSha256=$sourceIdentity.SourceDigestSha256
    $evidence.SourceFileCount=[int]$sourceIdentity.SourceFileCount
    $evidence.SourceStatus=@($sourceIdentity.StatusEntries)
    $service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
    $expectedServiceSid=Get-DleOsAccountSid $serviceIdentity
    $actualServiceSid=Get-DleOsAccountSid ([string]$service.StartName)
    if($actualServiceSid-ne$expectedServiceSid){throw "$serviceName uses unexpected identity $($service.StartName)."}
    $evidence.ServiceIdentity=[ordered]@{Configured=[string]$service.StartName;Sid=$actualServiceSid}
    $evidence.AuthenticationState=Initialize-AuthenticationStateStorage $expectedServiceSid
    $retainedTask=Get-ScheduledTask -TaskName $rejectedTaskName -ErrorAction SilentlyContinue
    if($retainedTask-and([bool]$retainedTask.Settings.Enabled-or[string]$retainedTask.State-eq'Running')){throw 'The retained legacy Scheduled Task is enabled or running; SCM must remain the only active frontend owner.'}
    $evidence.LegacyScheduledTask=if($retainedTask){[pscustomobject]@{Retained=$true;Enabled=$false;State=[string]$retainedTask.State}}else{[pscustomobject]@{Retained=$false}}
    $previousBinaryPath=[string]$service.PathName
    $evidence.PreviousBinaryPath=$previousBinaryPath
    $evidence.ReleasePath=$release
    $evidence.ProtectedBefore=Get-ProtectedSnapshot

    & dotnet.exe publish $project -c Release -o $publish --artifacts-path $artifacts
    if($LASTEXITCODE-ne 0){throw 'DEV Windows Service publish failed.'}
    $runtimeBuildInfo|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $publish 'runtime-build-info.json') -Encoding utf8
    New-Item -ItemType Directory -Path $release -Force|Out-Null
    Copy-Item -Path (Join-Path $publish '*') -Destination $release -Recurse -Force
    Copy-Item -LiteralPath $configurationSource -Destination $serviceConfiguration -Force
    $null=Invoke-Native icacls.exe @($release,'/grant:r',"${serviceIdentity}:(OI)(CI)(RX)")
    $evidence.ReleaseManifest=@(Get-ChildItem -LiteralPath $release -File -Recurse|ForEach-Object{
        [ordered]@{Path=$_.FullName.Substring($release.Length+1);Sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash}})

    $priorPid=[int]$service.ProcessId
    Stop-Service -Name $serviceName
    $serviceStopped=$true
    $null=Wait-ServiceState Stopped 45
    Wait-Release $priorPid 45
    $candidateBinaryPath=('"{0}" --dle-os-windows-service --service-config "{1}"'-f(Join-Path $release 'DleOs.DevelopmentFrontend.exe'),$serviceConfiguration)
    Set-ServiceBinaryPath $candidateBinaryPath
    Start-Service -Name $serviceName
    Assert-ServiceCandidate $runtimeBuildInfo
    $evidence.ProtectedAfter=Get-ProtectedSnapshot
    foreach ($port in $protectedPorts) {if(($evidence.ProtectedBefore[[string]$port]-join',')-ne($evidence.ProtectedAfter[[string]$port]-join',')){throw "Protected listener $port changed."}}
    $evidence.Verdict='PASS'
}catch{
    $evidence.Error=$_.Exception.Message
    $evidence.RollbackAttempted=$true
    try{
        if($serviceStopped-and$previousBinaryPath){Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
            $null=Wait-ServiceState Stopped 45;Set-ServiceBinaryPath $previousBinaryPath;Start-Service -Name $serviceName;Assert-ServiceCandidate
            $evidence.PreviousReleaseRestored=$true}
        if($evidence.Contains('ProtectedBefore')){
            $evidence.ProtectedAfterRollback=Get-ProtectedSnapshot
            foreach ($port in $protectedPorts) {if(($evidence.ProtectedBefore[[string]$port]-join',')-ne($evidence.ProtectedAfterRollback[[string]$port]-join',')){throw "Protected listener $port changed during rollback."}}
            $evidence.ProtectedRollbackVerified=$true
        }
    }catch{$evidence.RollbackError=$_.Exception.Message}
    throw
}finally{
    $evidence.CompletedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    $evidence|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $evidencePath -Encoding utf8
}
[pscustomobject]$evidence
