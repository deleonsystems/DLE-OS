[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$')]
    [string]$ReleaseId,

    [Parameter(Mandatory=$true)]
    [string]$Stage,

    [string]$EvidenceRoot='C:\DLE-OS\Qualification\DevResilience\Phase2'
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$serviceName='DleOsDevelopmentOperationalControl5054'
$runtimeIdentity='DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$candidatePath='\'
$candidateName='DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath='\DLE-OS\Development\'
$legacyName='Operational ControlHost 5054'
$releaseRoot='C:\DLE-OS\Development\OperationalControlHost5054\Releases'
$manifestRoot='C:\DLE-OS\Development\OperationalControlHost5054\Manifests'
$serviceRoot='C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Service'
$configurationPath=Join-Path $serviceRoot 'service-config.json'
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runRoot=Join-Path $EvidenceRoot ('phase2-service-registration-'+$stamp)
$result=[ordered]@{
    Schema='dle-os.phase2-service-registration.v1'
    StartedUtc=[DateTimeOffset]::UtcNow
    ReleaseId=$ReleaseId
    ServiceName=$serviceName
    RuntimeIdentity=$runtimeIdentity
    PasswordCapturedInEvidence=$false
    CandidateTaskChanged=$false
    LegacyTaskChanged=$false
    Port5054Interrupted=$false
    Passed=$false
}
$credential=$null
$rightAdded=$false
$serviceCreated=$false
$releaseInstalled=$false
$temporary=$null

function Assert-AdministratorMiguel {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=[Security.Principal.WindowsPrincipal]::new($identity)
    if(-not$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)-or
       -not[string]::Equals($identity.Name,'DLE-OS-HOST\Miguel',[StringComparison]::OrdinalIgnoreCase)){
        throw 'Windows Service registration requires elevated DLE-OS-HOST\Miguel.'
    }
}
function Get-XmlHash([string]$TaskPath,[string]$TaskName){
    $xml=Export-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    $sha=[Security.Cryptography.SHA256]::Create()
    try{([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($xml)))).Replace('-','')}
    finally{$sha.Dispose()}
}
function Assert-Manifest([string]$Path,$Manifest){
    $root=[IO.Path]::GetFullPath($Path).TrimEnd('\')+'\'
    $actual=@(Get-ChildItem -LiteralPath $Path -File -Recurse -Force)
    if($actual.Count-ne@($Manifest.files).Count){throw "Release file count mismatch: $($actual.Count) / $(@($Manifest.files).Count)."}
    foreach($entry in $Manifest.files){
        $file=[IO.Path]::GetFullPath((Join-Path $Path $entry.relativePath))
        if(-not$file.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'A manifest path escaped the immutable release.'}
        if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw "Release file is absent: $($entry.relativePath)"}
        $item=Get-Item -LiteralPath $file
        if($item.Length-ne[int64]$entry.length-or(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash-ne$entry.sha256){
            throw "Release integrity failed: $($entry.relativePath)"
        }
    }
}
function Set-ExactAcl([string]$Path,[string]$RuntimeRights){
    $acl=Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true,$false)
    foreach($rule in @($acl.Access)){$null=$acl.RemoveAccessRuleAll($rule)}
    $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    $none=[Security.AccessControl.PropagationFlags]::None
    $allow=[Security.AccessControl.AccessControlType]::Allow
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('NT AUTHORITY\SYSTEM','FullControl',$inherit,$none,$allow))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('BUILTIN\Administrators','FullControl',$inherit,$none,$allow))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($runtimeIdentity,$RuntimeRights,$inherit,$none,$allow))
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Invoke-Sc([string[]]$Arguments){
    $output=@(& sc.exe @Arguments 2>&1)
    if($LASTEXITCODE-ne0){throw "sc.exe $($Arguments[0]) failed with exit code $LASTEXITCODE`: $($output-join' ')"}
    $output
}

try{
    Assert-AdministratorMiguel
    $null=New-Item -ItemType Directory -Path $runRoot -Force
    $Stage=[IO.Path]::GetFullPath($Stage)
    $stageManifest=Join-Path $Stage 'release-manifest.json'
    $stagePublish=Join-Path $Stage 'publish'
    if(-not(Test-Path -LiteralPath $stageManifest -PathType Leaf)-or-not(Test-Path -LiteralPath $stagePublish -PathType Container)){
        throw 'The service-qualified release stage is incomplete.'
    }
    $manifest=Get-Content -Raw -LiteralPath $stageManifest|ConvertFrom-Json
    if([string]$manifest.releaseId-cne$ReleaseId){throw 'The staged manifest release ID differs from the authorized release.'}
    if([string]$manifest.sourceCommit-notmatch'^[0-9a-f]{40}$'-or-not$ReleaseId.EndsWith(([string]$manifest.sourceCommit).Substring(0,12))){
        throw 'The immutable release ID is not bound to its exact source commit.'
    }
    Assert-Manifest $stagePublish $manifest
    if(-not(Test-Path -LiteralPath (Join-Path $stagePublish 'Microsoft.Extensions.Hosting.WindowsServices.dll'))){
        throw 'The release does not contain standard .NET Windows Service lifetime support.'
    }

    if(Get-Service -Name $serviceName -ErrorAction SilentlyContinue){throw 'The DEV 5054 Windows Service already exists.'}
    $candidate=Get-ScheduledTask -TaskPath $candidatePath -TaskName $candidateName
    $legacy=Get-ScheduledTask -TaskPath $legacyPath -TaskName $legacyName
    if(-not$candidate.Settings.Enabled-or$candidate.State-ne'Running'-or[int]$candidate.Settings.RestartCount-ne0){
        throw 'The healthy scheduled-task fallback is not in its exact expected state.'
    }
    if($legacy.Settings.Enabled-or$legacy.State-ne'Disabled'){throw 'The legacy mixed-purpose task is not disabled.'}
    $candidateHashBefore=Get-XmlHash $candidatePath $candidateName
    $legacyHashBefore=Get-XmlHash $legacyPath $legacyName
    $listenerBefore=@(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction Stop)
    if($listenerBefore.Count-eq0){throw 'The healthy fallback is not listening on 5054.'}
    $frontendBefore=Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -TimeoutSec 20 -Uri 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history'
    if([int]$frontendBefore.StatusCode-ne200){throw 'The healthy 5051-to-5054 fallback probe failed.'}
    $groups=@(Get-LocalGroup|ForEach-Object{$group=$_;if(Get-LocalGroupMember -Group $group.Name -ErrorAction SilentlyContinue|Where-Object Name -IEq $runtimeIdentity){$group.Name}})
    if($groups-contains'Administrators'){throw 'The DEV 5054 runtime identity is unexpectedly administrative.'}

    $rightsSource='C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\DleOsServiceAccountRights.cs'
    Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath $rightsSource) -Language CSharp
    $recoverySource='C:\DLE-OS\Repositories\DLE-OS\Tools\DevelopmentRuntime\DleOsServiceRecoveryConfiguration.cs'
    Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath $recoverySource) -Language CSharp
    $hadServiceLogonRight=[DleOsServiceAccountRights]::HasRight($runtimeIdentity,'SeServiceLogonRight')
    $credential=Get-Credential -UserName $runtimeIdentity -Message 'Enter the existing DLE-OS-DEV-CONTROL password to register the staged DEV 5054 Windows Service. It will not be logged or stored in evidence.'
    if($null-eq$credential-or$credential.UserName-ine$runtimeIdentity){throw 'The service credential prompt was cancelled or returned a different identity.'}
    [DleOsServiceAccountRights]::ValidateBatchCredential($runtimeIdentity,$credential.Password)
    if(-not$hadServiceLogonRight){
        [DleOsServiceAccountRights]::AddRight($runtimeIdentity,'SeServiceLogonRight')
        $rightAdded=$true
    }

    $releasePath=Join-Path $releaseRoot $ReleaseId
    $manifestPath=Join-Path $manifestRoot ($ReleaseId+'.json')
    if(Test-Path -LiteralPath $releasePath){
        Assert-Manifest $releasePath $manifest
    }else{
        $temporary=Join-Path $releaseRoot ('.service-install-'+[guid]::NewGuid().ToString('N'))
        Copy-Item -LiteralPath $stagePublish -Destination $temporary -Recurse
        Assert-Manifest $temporary $manifest
        Set-ExactAcl $temporary 'ReadAndExecute,Synchronize'
        Rename-Item -LiteralPath $temporary -NewName $ReleaseId
        $temporary=$null
        Copy-Item -LiteralPath $stageManifest -Destination $manifestPath
        $releaseInstalled=$true
    }
    Assert-Manifest $releasePath $manifest

    $null=New-Item -ItemType Directory -Path $serviceRoot -Force
    Set-ExactAcl $serviceRoot 'ReadAndExecute,Synchronize'
    $configuration=[ordered]@{
        Environment='Development'
        RuntimeMode='DEV_OPERATIONAL_ONLY'
        ReleaseId=$ReleaseId
        SourceIdentity=[string]$manifest.sourceCommit
        RequiredRuntimeIdentity=$runtimeIdentity
        ControlPrefix='http://dle-os-host:5054'
        OperationalDatabase='DLE_OS_OPERATIONAL_DEV'
        SecurityDatabase='DLE_OS_SECURITY_DEV'
        CanonicalApiBaseUrl='http://DLE-OS-HOST:5052'
        DevDataRoot='C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data'
        IdentitySigningPublicKeyPath='C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'
        DevLogRoot='C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs'
    }
    $configuration|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $configurationPath -Encoding UTF8
    Set-ExactAcl $serviceRoot 'ReadAndExecute,Synchronize'

    $executable=Join-Path $releasePath 'DleOs.DevOperationalControlHost.exe'
    $binaryPath='"'+$executable+'" --dle-os-windows-service --service-config "'+$configurationPath+'"'
    $null=New-Service -Name $serviceName -BinaryPathName $binaryPath -DisplayName 'DLE-OS DEV Operational ControlHost 5054' `
        -Description 'DEV-only DLE-OS operational ControlHost on TCP 5054.' -StartupType Manual -Credential $credential
    $serviceCreated=$true
    [DleOsServiceRecoveryConfiguration]::ConfigureBoundedRecovery($serviceName,86400,120000)
    $recoveryState=[DleOsServiceRecoveryConfiguration]::Query($serviceName)
    $queryOutput=Invoke-Sc @('qfailure',$serviceName)
    $firstFourActions=@($recoveryState.Actions|Select-Object -First 4)
    if($recoveryState.ResetPeriodSeconds-ne86400-or@($recoveryState.Actions).Count-ne5-or
       @($firstFourActions|Where-Object{$_.Type-ne1-or$_.DelayMilliseconds-ne120000}).Count-ne0-or
       $recoveryState.Actions[4].Type-ne0-or$recoveryState.Actions[4].DelayMilliseconds-ne0){
        throw 'SCM failure actions are not exactly four delayed restarts followed by NONE.'
    }
    $service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    if($service.State-ne'Stopped'-or$service.StartMode-ne'Manual'-or$service.StartName-ine$runtimeIdentity){
        throw 'The staged service identity/start state differs from the approved boundary.'
    }
    if(-not[DleOsServiceAccountRights]::HasRight($runtimeIdentity,'SeServiceLogonRight')){throw 'The required service logon right is absent.'}
    $candidateHashAfter=Get-XmlHash $candidatePath $candidateName
    $legacyHashAfter=Get-XmlHash $legacyPath $legacyName
    if($candidateHashAfter-cne$candidateHashBefore-or$legacyHashAfter-cne$legacyHashBefore){throw 'A scheduled task changed during service staging.'}
    $listenerAfter=@(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction Stop)
    if($listenerAfter.Count-eq0){throw 'Service staging interrupted the healthy 5054 fallback.'}
    $frontendAfter=Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -TimeoutSec 20 -Uri 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history'
    if([int]$frontendAfter.StatusCode-ne200){throw 'Service staging interrupted 5051-to-5054.'}

    $result.Service=[ordered]@{Name=$service.Name;State=$service.State;StartMode=$service.StartMode;StartName=$service.StartName;PathName=$service.PathName}
    $result.Release=[ordered]@{Path=$releasePath;ManifestPath=$manifestPath;FileCount=@($manifest.files).Count;IntegrityPassed=$true;InstalledThisRun=$releaseInstalled}
    $result.Configuration=[ordered]@{Path=$configurationPath;Sha256=(Get-FileHash -LiteralPath $configurationPath -Algorithm SHA256).Hash;ContainsSecrets=$false}
    $result.Recovery=[ordered]@{ResetPeriodSeconds=[uint32]$recoveryState.ResetPeriodSeconds;Actions=@($recoveryState.Actions|ForEach-Object{[ordered]@{Type=[int]$_.Type;Action=if($_.Type-eq1){'RESTART'}else{'NONE'};DelayMilliseconds=[uint32]$_.DelayMilliseconds}});TerminalAction='NONE';QueryOutput=$queryOutput;Bounded=$true}
    $result.ServiceLogonRight=[ordered]@{PresentBefore=$hadServiceLogonRight;AddedThisRun=$rightAdded;PresentAfter=$true}
    $result.RuntimeIdentityGroups=$groups
    $result.CandidateTaskHashBefore=$candidateHashBefore;$result.CandidateTaskHashAfter=$candidateHashAfter
    $result.LegacyTaskHashBefore=$legacyHashBefore;$result.LegacyTaskHashAfter=$legacyHashAfter
    $result.CandidateTaskChanged=$false;$result.LegacyTaskChanged=$false
    $result.Listener5054Preserved=$true;$result.Frontend5051To5054Preserved=$true
    $result.Passed=$true
}catch{
    $result.Error=$_.Exception.Message
    $result.ErrorDetail=[string]$_
    if($_.Exception.InnerException){$result.InnerError=$_.Exception.InnerException.Message}
    if($serviceCreated){
        try{Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue}catch{}
        try{$null=Invoke-Sc @('delete',$serviceName)}catch{$result.ServiceCleanupError=$_.Exception.Message}
    }
    if($rightAdded){
        try{[DleOsServiceAccountRights]::RemoveRight($runtimeIdentity,'SeServiceLogonRight')}catch{$result.ServiceRightCleanupError=$_.Exception.Message}
    }
    if($temporary-and(Test-Path -LiteralPath $temporary)){
        $resolved=[IO.Path]::GetFullPath($temporary)
        $expected=[IO.Path]::GetFullPath($releaseRoot).TrimEnd('\')+'\'
        if($resolved.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $resolved -Recurse -Force}
    }
    throw
}finally{
    $credential=$null
    $result.CompletedUtc=[DateTimeOffset]::UtcNow
    if(-not(Test-Path -LiteralPath $runRoot)){try{$null=New-Item -ItemType Directory -Path $runRoot -Force}catch{}}
    try{$result|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $runRoot 'phase2-service-registration.json') -Encoding UTF8}catch{}
}

Write-Output (Join-Path $runRoot 'phase2-service-registration.json')
