[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Stage,
    [Parameter(Mandatory=$true)][switch]$ApproveHardenedReleaseCreation
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(-not $ApproveHardenedReleaseCreation){throw 'Explicit hardened release creation approval is required.'}
if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Elevation is required.'}

$governedRoot='C:\DLE-OS\Development\OperationalControlHost5054'
$releases=Join-Path $governedRoot 'Releases'
$manifests=Join-Path $governedRoot 'Manifests'
$evidenceRoot=Join-Path $governedRoot 'Evidence'
$pointers=Join-Path $governedRoot 'Pointers'
$runtimeAccount='DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$manifestSource=Join-Path $Stage 'release-manifest.json'
$publishSource=Join-Path $Stage 'publish'
$qualificationSource=Join-Path $Stage 'evidence'
if(-not(Test-Path $manifestSource -PathType Leaf)-or-not(Test-Path $publishSource -PathType Container)){throw 'The qualified release stage is incomplete.'}
$manifest=Get-Content $manifestSource -Raw|ConvertFrom-Json
$releaseId=[string]$manifest.releaseId
if($releaseId-notmatch'^dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$'){throw 'The release ID is invalid.'}
$releasePath=Join-Path $releases $releaseId
if(Test-Path $releasePath){throw 'The immutable governed release already exists.'}
$taskXmlBefore=Export-ScheduledTask -TaskPath '\DLE-OS\Development\' -TaskName 'Operational ControlHost 5054'
$taskHashBefore=([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash([Text.Encoding]::Unicode.GetBytes($taskXmlBefore)))).Replace('-','')
if(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue){throw '5054 is listening; refusing release installation.'}

function Set-ExactDirectoryAcl([string]$Path,[string]$AdministratorRights,[string]$RuntimeRights){
    $null=New-Item -ItemType Directory -Path $Path -Force
    $acl=Get-Acl $Path;$acl.SetAccessRuleProtection($true,$false)
    foreach($rule in @($acl.Access)){$null=$acl.RemoveAccessRuleAll($rule)}
    $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit';$none=[Security.AccessControl.PropagationFlags]::None;$allow=[Security.AccessControl.AccessControlType]::Allow
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('SYSTEM','FullControl',$inherit,$none,$allow))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('Administrators',$AdministratorRights,$inherit,$none,$allow))
    if($RuntimeRights){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($runtimeAccount,$RuntimeRights,$inherit,$none,$allow))}
    Set-Acl $Path $acl
}
function Assert-Manifest([string]$Path,$Manifest){
    $actual=@(Get-ChildItem $Path -File -Recurse)
    if($actual.Count-ne@($Manifest.files).Count){throw 'Installed file count differs from the manifest.'}
    foreach($entry in $Manifest.files){$file=[IO.Path]::GetFullPath((Join-Path $Path $entry.relativePath));if(-not$file.StartsWith([IO.Path]::GetFullPath($Path).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'A manifest path escaped the release.'};if(-not(Test-Path $file)){throw "Installed file missing: $($entry.relativePath)"};$item=Get-Item $file;if($item.Length-ne[int64]$entry.length-or(Get-FileHash $file -Algorithm SHA256).Hash-ne$entry.sha256){throw "Installed hash mismatch: $($entry.relativePath)"}}
}

Set-ExactDirectoryAcl $releases 'FullControl' 'ReadAndExecute'
Set-ExactDirectoryAcl $manifests 'FullControl' 'ReadAndExecute'
Set-ExactDirectoryAcl $evidenceRoot 'FullControl' 'ReadAndExecute'
Set-ExactDirectoryAcl $pointers 'FullControl' 'ReadAndExecute'
$temporary=Join-Path $releases ('.install-'+[guid]::NewGuid().ToString('N'))
try{
    Copy-Item $publishSource $temporary -Recurse
    Assert-Manifest $temporary $manifest
    Set-ExactDirectoryAcl $temporary 'ReadAndExecute' 'ReadAndExecute'
    Rename-Item $temporary $releaseId
    Copy-Item $manifestSource (Join-Path $manifests ($releaseId+'.json'))
    $releaseEvidence=Join-Path $evidenceRoot $releaseId
    Copy-Item $qualificationSource $releaseEvidence -Recurse
    $pointerState=Join-Path $pointers 'pointer-state.json'
    if(-not(Test-Path $pointerState)){
        [ordered]@{schemaVersion=1;current=$null;lastKnownGood=$null;updatedTimestampUtc=(Get-Date).ToUniversalTime().ToString('o');note='Pointers remain null until transactional deployment and runtime qualification.'}|ConvertTo-Json|Set-Content $pointerState -Encoding utf8
    }
    Assert-Manifest $releasePath $manifest
    $taskXmlAfter=Export-ScheduledTask -TaskPath '\DLE-OS\Development\' -TaskName 'Operational ControlHost 5054'
    $sha=[Security.Cryptography.SHA256]::Create();try{$taskHashAfter=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($taskXmlAfter)))).Replace('-','')}finally{$sha.Dispose()}
    if($taskHashAfter-ne$taskHashBefore){throw 'The legacy 5054 task changed during release installation.'}
    [ordered]@{releaseId=$releaseId;installedTimestampUtc=(Get-Date).ToUniversalTime().ToString('o');releasePath=$releasePath;manifestPath=(Join-Path $manifests ($releaseId+'.json'));taskHashBefore=$taskHashBefore;taskHashAfter=$taskHashAfter;taskUnchanged=$true;candidateStarted=$false;currentPointer=$null;lastKnownGoodPointer=$null}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $releaseEvidence 'immutable-installation.json') -Encoding utf8
}catch{
    if(Test-Path $temporary){Remove-Item $temporary -Recurse -Force}
    throw
}

[pscustomobject]@{ReleaseId=$releaseId;ReleasePath=$releasePath;ManifestPath=(Join-Path $manifests ($releaseId+'.json'));EvidencePath=(Join-Path $evidenceRoot $releaseId);TaskUnchanged=$true}
