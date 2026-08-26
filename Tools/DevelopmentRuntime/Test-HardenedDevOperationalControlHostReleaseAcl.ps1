[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$')]
    [string]$ReleaseId,
    [Parameter(Mandatory=$true)][string]$ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$errorEvidence=$ReportPath+'.error.json'
trap{[ordered]@{timestamp=(Get-Date).ToUniversalTime().ToString('o');message=$_.Exception.Message;position=$_.InvocationInfo.PositionMessage;stack=$_.ScriptStackTrace}|ConvertTo-Json -Depth 5|Set-Content $errorEvidence -Encoding utf8;exit 1}
if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Elevation is required.'}

$account='DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$releaseRoot='C:\DLE-OS\Development\OperationalControlHost5054'
$release=Join-Path (Join-Path $releaseRoot 'Releases') $ReleaseId
$manifest=Join-Path (Join-Path $releaseRoot 'Manifests') ($ReleaseId+'.json')
$pointer=Join-Path (Join-Path $releaseRoot 'Pointers') 'pointer-state.json'
$mutableEvidence=Join-Path 'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Evidence' ($ReleaseId+'-release-acl.json')
$governedEvidence=Join-Path (Join-Path (Join-Path $releaseRoot 'Evidence') $ReleaseId) 'runtime-identity-acl-qualification.json'
$taskName='DLE-OS DEV 5054 Release ACL '+[guid]::NewGuid().ToString('N')
foreach($path in $release,$manifest,$pointer){if(-not(Test-Path -LiteralPath $path)){throw "Qualification target absent: $path"}}
Remove-Item -LiteralPath $mutableEvidence -Force -ErrorAction SilentlyContinue

function New-TransientPassword {
    $bytes=New-Object byte[] 48;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
    $plain=[Convert]::ToBase64String($bytes)+'!aA7';[Array]::Clear($bytes,0,$bytes.Length)
    [pscustomobject]@{Plain=$plain;Secure=(ConvertTo-SecureString $plain -AsPlainText -Force)}
}

$payload=@'
$ErrorActionPreference='Stop'
$release='__RELEASE__';$manifest='__MANIFEST__';$pointer='__POINTER__';$evidence='__EVIDENCE__'
trap{[ordered]@{timestamp=(Get-Date).ToUniversalTime().ToString('o');identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;release='__RELEASE_ID__';verdict='ERROR';message=$_.Exception.Message;position=$_.InvocationInfo.PositionMessage}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $evidence -Encoding utf8;exit 1}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DleOsFileAccessProbe {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string n,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 static bool Open(string p,uint access){var h=CreateFile(p,access,7,IntPtr.Zero,3,0x80,IntPtr.Zero);if(h==new IntPtr(-1))return false;CloseHandle(h);return true;}
 public static bool CanWrite(string p){return Open(p,0x40000000);}
 public static bool CanDelete(string p){return Open(p,0x00010000);}
 public static bool CanChangeAcl(string p){return Open(p,0x00040000);}
 public static bool CanTakeOwnership(string p){return Open(p,0x00080000);}
}
"@
$targets=@(
  (Join-Path $release 'DleOs.DevOperationalControlHost.exe'),
  (Join-Path $release 'DleOs.DevOperationalControlHost.dll'),
  (Join-Path $release 'Start-DevOperationalControlHost5054.ps1'),
  $manifest,$pointer
)
$rows=@($targets|ForEach-Object{[ordered]@{path=$_;readable=([IO.File]::OpenRead($_).Dispose()-eq$null);writeOpen=[DleOsFileAccessProbe]::CanWrite($_);deleteOpen=[DleOsFileAccessProbe]::CanDelete($_);changeAclOpen=[DleOsFileAccessProbe]::CanChangeAcl($_);takeOwnershipOpen=[DleOsFileAccessProbe]::CanTakeOwnership($_)}})
$result=[ordered]@{timestamp=(Get-Date).ToUniversalTime().ToString('o');identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;release='__RELEASE_ID__';targets=$rows}
$result.verdict=if($result.identity-eq'DLE-OS-HOST\DLE-OS-DEV-CONTROL'-and@($rows|Where-Object{-not$_.readable-or$_.writeOpen-or$_.deleteOpen-or$_.changeAclOpen-or$_.takeOwnershipOpen}).Count-eq0){'PASS'}else{'FAIL'}
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $evidence -Encoding utf8
'@
$payload=$payload.Replace('__RELEASE__',$release.Replace("'","''")).Replace('__MANIFEST__',$manifest.Replace("'","''")).Replace('__POINTER__',$pointer.Replace("'","''")).Replace('__EVIDENCE__',$mutableEvidence.Replace("'","''")).Replace('__RELEASE_ID__',$ReleaseId)
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($payload))
$credential=New-TransientPassword
Set-LocalUser -Name 'DLE-OS-DEV-CONTROL' -Password $credential.Secure
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"
$principal=New-ScheduledTaskPrincipal -UserId $account -LogonType Password -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task=New-ScheduledTask -Action $action -Principal $principal -Settings $settings
try{
    Register-ScheduledTask -TaskPath '\' -TaskName $taskName -InputObject $task -User $account -Password $credential.Plain -Force|Out-Null
    Start-ScheduledTask -TaskPath '\' -TaskName $taskName
    $deadline=(Get-Date).AddSeconds(90)
    do{Start-Sleep -Milliseconds 500;$info=Get-ScheduledTaskInfo -TaskPath '\' -TaskName $taskName}until((Test-Path $mutableEvidence)-or($info.LastTaskResult-ne267009-and$info.LastRunTime-gt[datetime]'2000-01-01')-or(Get-Date)-gt$deadline)
    if(-not(Test-Path $mutableEvidence)){throw "The ACL qualification produced no evidence. LastTaskResult=$($info.LastTaskResult)"}
    $result=Get-Content $mutableEvidence -Raw|ConvertFrom-Json
    Copy-Item $mutableEvidence $ReportPath -Force
    if($result.verdict-ne'PASS'){throw 'The runtime-identity release ACL qualification failed.'}
    Copy-Item $mutableEvidence $governedEvidence -Force
}finally{
    Unregister-ScheduledTask -TaskPath '\' -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    $credential.Secure.Dispose();$credential=$null
    $final=New-TransientPassword;Set-LocalUser -Name 'DLE-OS-DEV-CONTROL' -Password $final.Secure;$final.Secure.Dispose();$final=$null
}
$result
