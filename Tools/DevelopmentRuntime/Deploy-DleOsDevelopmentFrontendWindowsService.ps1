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
$rollbackRelease = "C:\ProgramData\DLE-OS\DevelopmentFrontend\Service\releases\$stamp-rollback"
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
$rollbackBinaryPath = $null
$rollbackValidation = $null
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
function Test-AuthenticationBoundary{
    Add-Type -AssemblyName System.Net.Http
    $handler=[Net.Http.HttpClientHandler]::new()
    $handler.UseDefaultCredentials=$true
    $handler.AllowAutoRedirect=$false
    $client=[Net.Http.HttpClient]::new($handler)
    $response=$null
    try{
        $response=$client.GetAsync('https://dev.dle-os.internal.dlemfg.com/api/auth/me').GetAwaiter().GetResult()
        $status=[int]$response.StatusCode
        if($status-notin 200,401,403){throw "The authentication boundary returned unexpected HTTP status $status."}
        [ordered]@{StatusCode=$status;Qualified=$true}
    }finally{
        if($response){$response.Dispose()};$client.Dispose();$handler.Dispose()
    }
}
function Assert-ServedFrontendManifestFile([string]$ManifestPath){
    $manifest=Get-Content -LiteralPath $ManifestPath -Raw|ConvertFrom-Json
    $probe=$null;$relativePath=$null
    foreach($entry in @($manifest.files)){
        $candidateRelativePath=if($entry.PSObject.Properties.Name-contains'RelativePath'){
            [string]$entry.RelativePath
        }else{[string]$entry.Path}
        if($candidateRelativePath-eq'ASSETS/ICONS/apple-touch-icon.png'){
            $probe=$entry;$relativePath=$candidateRelativePath;break
        }
    }
    if(-not$probe){throw 'The frontend manifest lacks the governed public branding probe asset.'}
    $uri='https://dev.dle-os.internal.dlemfg.com/apple-touch-icon.png'
    Add-Type -AssemblyName System.Net.Http
    $handler=[Net.Http.HttpClientHandler]::new();$handler.UseDefaultCredentials=$true
    $client=[Net.Http.HttpClient]::new($handler)
    try{
        $bytes=$client.GetByteArrayAsync($uri).GetAwaiter().GetResult()
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','')}
        finally{$sha.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
        if($hash-ine[string]$probe.Sha256){throw 'Served frontend bytes do not match the immutable release manifest.'}
        [ordered]@{RelativePath=$relativePath;Sha256=$hash;Qualified=$true}
    }finally{$client.Dispose();$handler.Dispose()}
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
    $evidence.AuthenticationBoundary=Test-AuthenticationBoundary
    if($ExpectedRuntimeInfo){
        $runtimeInfo=Invoke-RestMethod -UseBasicParsing -Uri 'https://dev.dle-os.internal.dlemfg.com/api/runtime/info' -TimeoutSec 20
        if($runtimeInfo.environment-ne'Development'-or
           $runtimeInfo.releaseId-ne$ExpectedRuntimeInfo.releaseId-or
           $runtimeInfo.gitHead-ne$ExpectedRuntimeInfo.gitHead-or
           $runtimeInfo.sourceDirty-ne$ExpectedRuntimeInfo.sourceDirty-or
           $runtimeInfo.sourceDigestSha256-ne$ExpectedRuntimeInfo.sourceDigestSha256-or
           $runtimeInfo.frontendManifestSha256-ne$ExpectedRuntimeInfo.frontendManifestSha256-or
           $runtimeInfo.frontendFileCount-ne$ExpectedRuntimeInfo.frontendFileCount-or
           $runtimeInfo.frontendContentRootIdentity-ne'release/frontend'){
            throw 'The served runtime identity does not match the deployment candidate.'
        }
        $evidence.ServedFrontendFile=Assert-ServedFrontendManifestFile `
            (Join-Path $release 'frontend-manifest.json')
        $evidence.RuntimeInfoQualified=$true
    }
    $evidence.ServiceProcessId=[int]$service.ProcessId
}
function Set-ServiceBinaryPath([string]$BinaryPath){
    $null=Invoke-Native sc.exe @('config',$serviceName,'binPath=',$BinaryPath)
}
function Get-ServiceLaunchParts([string]$BinaryPath){
    $match=[regex]::Match($BinaryPath,
        '^\s*(?:"(?<Executable>[^"]+)"|(?<Executable>\S+))\s+--dle-os-windows-service\s+--service-config\s+(?:"(?<Configuration>[^"]+)"|(?<Configuration>\S+))\s*$')
    if(-not$match.Success){throw 'The existing DEV service command line is outside the governed release format.'}
    [pscustomobject]@{
        Executable=[IO.Path]::GetFullPath($match.Groups['Executable'].Value)
        Configuration=[IO.Path]::GetFullPath($match.Groups['Configuration'].Value)
    }
}
function Assert-RollbackTarget{
    if(-not$rollbackValidation){throw 'No validated rollback target is available.'}
    foreach($path in $rollbackValidation.Executable,$rollbackValidation.Configuration){
        if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Rollback artifact is absent: $path"}
    }
    $config=Get-Content -LiteralPath $rollbackValidation.Configuration -Raw|ConvertFrom-Json
    $configuredRoot=[IO.Path]::GetFullPath([string]$config.($rollbackValidation.ConfigurationProperty))
    if($configuredRoot-ine$rollbackValidation.ContentRoot){
        throw 'The rollback configuration no longer references its immutable frontend snapshot.'
    }
    $null=Assert-DleOsFrontendSnapshot -ContentRoot $rollbackValidation.ContentRoot `
        -ManifestPath $rollbackValidation.ManifestPath `
        -ExpectedManifestSha256 $rollbackValidation.ManifestSha256 `
        -ExpectedFileCount $rollbackValidation.FileCount `
        -ExpectedReleaseId $rollbackValidation.ReleaseId `
        -ExpectedSourceGitHead $rollbackValidation.GitHead
}
function Assert-RollbackRuntime{
    Assert-RollbackTarget
    $runtimeInfo=Invoke-RestMethod -UseBasicParsing `
        -Uri 'https://dev.dle-os.internal.dlemfg.com/api/runtime/info' -TimeoutSec 20
    if($runtimeInfo.releaseId-ne$rollbackValidation.RuntimeReleaseId){
        throw 'The restored runtime release identity does not match the validated rollback target.'
    }
    $evidence.RollbackAuthenticationBoundary=Test-AuthenticationBoundary
    $evidence.RollbackServedFrontendFile=Assert-ServedFrontendManifestFile `
        $rollbackValidation.ManifestPath
    $evidence.RollbackRuntimeQualified=$true
}
function Initialize-RollbackTarget([string]$CurrentBinaryPath){
    $parts=Get-ServiceLaunchParts $CurrentBinaryPath
    if(-not(Test-Path -LiteralPath $parts.Executable -PathType Leaf)-or
       -not(Test-Path -LiteralPath $parts.Configuration -PathType Leaf)){
        throw 'The existing DEV service release is incomplete and cannot be preserved for rollback.'
    }
    $currentRelease=Split-Path -Parent $parts.Executable
    $currentBuildPath=Join-Path $currentRelease 'runtime-build-info.json'
    $currentRollbackInfoPath=Join-Path $currentRelease 'rollback-release-info.json'
    $currentConfig=Get-Content -LiteralPath $parts.Configuration -Raw|ConvertFrom-Json
    $currentBuild=if(Test-Path -LiteralPath $currentBuildPath -PathType Leaf){
        Get-Content -LiteralPath $currentBuildPath -Raw|ConvertFrom-Json
    }else{$null}
    if($currentBuild-and[int]$currentBuild.schemaVersion-eq 2-and
       $currentConfig.PSObject.Properties.Name-contains'frontendContentRoot'){
        $contentRoot=[IO.Path]::GetFullPath([string]$currentConfig.frontendContentRoot)
        $expectedRoot=[IO.Path]::GetFullPath((Join-Path $currentRelease 'frontend'))
        if($contentRoot-ine$expectedRoot-or$currentConfig.PSObject.Properties.Name-contains'repositoryRoot'){
            throw 'The existing immutable DEV release has an invalid content-root boundary.'
        }
        $script:rollbackValidation=[pscustomobject]@{
            Executable=$parts.Executable;Configuration=$parts.Configuration
            ConfigurationProperty='frontendContentRoot';ContentRoot=$contentRoot
            ManifestPath=(Join-Path $currentRelease 'frontend-manifest.json')
            ManifestSha256=[string]$currentBuild.frontendManifestSha256
            FileCount=[int]$currentBuild.frontendFileCount
            ReleaseId=[string]$currentBuild.releaseId;GitHead=[string]$currentBuild.gitHead
            RuntimeReleaseId=[string]$currentBuild.releaseId
        }
        $script:rollbackBinaryPath=$CurrentBinaryPath
    }elseif(Test-Path -LiteralPath $currentRollbackInfoPath -PathType Leaf){
        $currentRollbackInfo=Get-Content -LiteralPath $currentRollbackInfoPath -Raw|ConvertFrom-Json
        $contentRoot=[IO.Path]::GetFullPath([string]$currentConfig.repositoryRoot)
        $expectedRoot=[IO.Path]::GetFullPath((Join-Path $currentRelease 'frontend'))
        if([int]$currentRollbackInfo.schemaVersion-ne 1-or
           $currentRollbackInfo.sourceDirty-or$contentRoot-ine$expectedRoot-or
           $currentRollbackInfo.frontendContentRootIdentity-ne'release/frontend'){
            throw 'The preserved legacy rollback release is outside the immutable boundary.'
        }
        $currentRollbackManifestPath=Join-Path $currentRelease 'frontend-manifest.json'
        $currentRollbackManifest=Get-Content -LiteralPath $currentRollbackManifestPath -Raw|ConvertFrom-Json
        $script:rollbackValidation=[pscustomobject]@{
            Executable=$parts.Executable;Configuration=$parts.Configuration
            ConfigurationProperty='repositoryRoot';ContentRoot=$contentRoot
            ManifestPath=$currentRollbackManifestPath
            ManifestSha256=[string]$currentRollbackInfo.frontendManifestSha256
            FileCount=[int]$currentRollbackInfo.frontendFileCount
            ReleaseId=[string]$currentRollbackManifest.releaseId
            GitHead=[string]$currentRollbackInfo.sourceGitHead
            RuntimeReleaseId=[string]$currentBuild.releaseId
        }
        $script:rollbackBinaryPath=$CurrentBinaryPath
    }else{
        if(-not$currentBuild-or[string]::IsNullOrWhiteSpace([string]$currentBuild.releaseId)){
            throw 'The legacy DEV release has no runtime identity to verify after rollback.'
        }
        if(-not($currentConfig.PSObject.Properties.Name-contains'repositoryRoot')){
            throw 'The legacy DEV release does not identify the frontend source required for rollback preservation.'
        }
        $legacyContentRoot=[IO.Path]::GetFullPath([string]$currentConfig.repositoryRoot)
        $legacySourceIdentity=Get-DleOsDevelopmentFrontendSourceIdentity $legacyContentRoot
        if($legacySourceIdentity.SourceDirty){
            throw 'The legacy DEV frontend source is dirty; an immutable rollback cannot be created safely.'
        }
        New-Item -ItemType Directory -Path $rollbackRelease -Force|Out-Null
        Copy-Item -Path (Join-Path $currentRelease '*') -Destination $rollbackRelease -Recurse -Force
        $rollbackFrontend=Join-Path $rollbackRelease 'frontend'
        $rollbackManifest=Join-Path $rollbackRelease 'frontend-manifest.json'
        $snapshot=New-DleOsFrontendSnapshot -SourceRoot $legacyContentRoot `
            -DestinationRoot $rollbackFrontend -ManifestPath $rollbackManifest `
            -ReleaseId $stamp -SourceGitHead $legacySourceIdentity.GitHead
        $rollbackConfiguration=Join-Path $rollbackRelease 'service-runtime.json'
        $currentConfig.repositoryRoot=$rollbackFrontend
        $currentConfig|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $rollbackConfiguration -Encoding utf8
        $rollbackExecutable=Join-Path $rollbackRelease ([IO.Path]::GetFileName($parts.Executable))
        $script:rollbackValidation=[pscustomobject]@{
            Executable=$rollbackExecutable;Configuration=$rollbackConfiguration
            ConfigurationProperty='repositoryRoot';ContentRoot=$rollbackFrontend
            ManifestPath=$rollbackManifest;ManifestSha256=$snapshot.ManifestSha256
            FileCount=$snapshot.FileCount;ReleaseId=$stamp;GitHead=$legacySourceIdentity.GitHead
            RuntimeReleaseId=[string]$currentBuild.releaseId
        }
        $script:rollbackBinaryPath=('"{0}" --dle-os-windows-service --service-config "{1}"'-f
            $rollbackExecutable,$rollbackConfiguration)
        $rollbackRecord=[ordered]@{
            schemaVersion=1;createdAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
            originalServicePath=$CurrentBinaryPath;sourceGitHead=$legacySourceIdentity.GitHead
            snapshotReleaseId=$stamp
            frontendManifestSha256=$snapshot.ManifestSha256;frontendFileCount=$snapshot.FileCount
            frontendContentRootIdentity='release/frontend';sourceDirty=$false
        }
        $rollbackRecord|ConvertTo-Json -Depth 8|Set-Content `
            -LiteralPath (Join-Path $rollbackRelease 'rollback-release-info.json') -Encoding utf8
    }
    Assert-RollbackTarget
    $evidence.RollbackRelease=[ordered]@{
        ServicePath=$rollbackBinaryPath
        ContentRootIdentity='release/frontend'
        ManifestSha256=$rollbackValidation.ManifestSha256
        FileCount=$rollbackValidation.FileCount
        Validated=$true
    }
}
function Assert-ImmutableCandidateOnDisk([object]$RuntimeInfo){
    $config=Get-Content -LiteralPath $serviceConfiguration -Raw|ConvertFrom-Json
    $expectedRoot=[IO.Path]::GetFullPath((Join-Path $release 'frontend'))
    if($config.PSObject.Properties.Name-contains'repositoryRoot'-or
       [IO.Path]::GetFullPath([string]$config.frontendContentRoot)-ine$expectedRoot){
        throw 'The candidate service configuration can fall back to mutable repository content.'
    }
    $null=Assert-DleOsFrontendSnapshot -ContentRoot $expectedRoot `
        -ManifestPath (Join-Path $release 'frontend-manifest.json') `
        -ExpectedManifestSha256 $RuntimeInfo.frontendManifestSha256 `
        -ExpectedFileCount $RuntimeInfo.frontendFileCount `
        -ExpectedReleaseId $RuntimeInfo.releaseId -ExpectedSourceGitHead $RuntimeInfo.gitHead
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
    if($sourceIdentity.SourceDirty){
        throw 'Immutable DEV releases must be built from a clean governed source tree.'
    }
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
    Initialize-RollbackTarget $previousBinaryPath
    $evidence.ReleasePath=$release
    $evidence.ProtectedBefore=Get-ProtectedSnapshot

    & dotnet.exe publish $project -c Release -o $publish --artifacts-path $artifacts
    if($LASTEXITCODE-ne 0){throw 'DEV Windows Service publish failed.'}
    New-Item -ItemType Directory -Path $release -Force|Out-Null
    Copy-Item -Path (Join-Path $publish '*') -Destination $release -Recurse -Force
    $frontendSnapshot=New-DleOsFrontendSnapshot -SourceRoot $repository `
        -DestinationRoot (Join-Path $release 'frontend') `
        -ManifestPath (Join-Path $release 'frontend-manifest.json') `
        -ReleaseId $stamp -SourceGitHead $sourceIdentity.GitHead
    $sourceIdentityAfterSnapshot=Get-DleOsDevelopmentFrontendSourceIdentity $repository
    if($sourceIdentityAfterSnapshot.SourceDirty-or
       $sourceIdentityAfterSnapshot.GitHead-ne$sourceIdentity.GitHead-or
       $sourceIdentityAfterSnapshot.SourceDigestSha256-ne$sourceIdentity.SourceDigestSha256-or
       $sourceIdentityAfterSnapshot.SourceFileCount-ne$sourceIdentity.SourceFileCount){
        throw 'Governed source identity changed during immutable release construction.'
    }
    $runtimeBuildInfo=[ordered]@{
        schemaVersion=2
        environment='Development'
        releaseId=$stamp
        builtAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
        gitHead=$sourceIdentity.GitHead
        sourceDirty=$false
        sourceDigestSha256=$sourceIdentity.SourceDigestSha256
        sourceFileCount=[int]$sourceIdentity.SourceFileCount
        frontendManifestSha256=$frontendSnapshot.ManifestSha256
        frontendFileCount=[int]$frontendSnapshot.FileCount
        frontendContentRootIdentity='release/frontend'
        serviceName=$serviceName
        serviceIdentity=$serviceIdentity
    }
    $runtimeBuildInfo|ConvertTo-Json -Depth 5|Set-Content `
        -LiteralPath (Join-Path $release 'runtime-build-info.json') -Encoding utf8
    $releaseConfiguration=Get-Content -LiteralPath $configurationSource -Raw|ConvertFrom-Json
    $releaseConfiguration.frontendContentRoot=Join-Path $release 'frontend'
    $releaseConfiguration|ConvertTo-Json -Depth 12|Set-Content `
        -LiteralPath $serviceConfiguration -Encoding utf8
    Assert-ImmutableCandidateOnDisk $runtimeBuildInfo
    $evidence.RuntimeIdentity=$runtimeBuildInfo
    $evidence.FrontendRelease=[ordered]@{
        ContentRootIdentity='release/frontend'
        ManifestSha256=$frontendSnapshot.ManifestSha256
        FileCount=$frontendSnapshot.FileCount
        SourceDigestSha256=$frontendSnapshot.SourceDigestSha256
        Validated=$true
    }
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
        if($serviceStopped-and$rollbackBinaryPath){Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
            $null=Wait-ServiceState Stopped 45;Assert-RollbackTarget;Set-ServiceBinaryPath $rollbackBinaryPath;Start-Service -Name $serviceName;Assert-ServiceCandidate;Assert-RollbackRuntime
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
