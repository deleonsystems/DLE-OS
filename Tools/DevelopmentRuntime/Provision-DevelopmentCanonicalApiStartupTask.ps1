[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$operator = 'DLE-OS-HOST\DLE-OS'
$apiIdentity = 'DLE-OS-HOST\DLE-OS-LIVE-API'
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $operator) {
    throw "The 5052 task provisioner must run as $operator."
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DleOsCredentialReader {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct C { public uint Flags,Type; public string TargetName,Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint BlobSize; public IntPtr Blob; public uint Persist,AttributeCount; public IntPtr Attributes; public string Alias,UserName; }
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Read(string target,uint type,uint flags,out IntPtr credential);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
}
'@
$pointer = [IntPtr]::Zero
$secure = [Security.SecureString]::new()
$plainPointer = [IntPtr]::Zero
try {
    if (-not [DleOsCredentialReader]::Read('DLE-OS/LIVE-CANONICAL-API/RUNTIME',1,0,[ref]$pointer)) { throw 'The managed API credential is unavailable.' }
    $stored = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer,[type][DleOsCredentialReader+C])
    if ($stored.UserName -ine $apiIdentity) { throw 'The managed credential has an unexpected identity.' }
    for ($i=0;$i -lt [int]($stored.BlobSize/2);$i++) { $secure.AppendChar([char][Runtime.InteropServices.Marshal]::ReadInt16($stored.Blob,$i*2)) }
    $secure.MakeReadOnly(); $plainPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($plainPointer)
    $runtime='C:\ProgramData\DLE-OS\DevelopmentCanonicalApi'
    $startupScript=Join-Path $runtime 'Start-DevelopmentCanonicalApiAtStartup.ps1'
    $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$startupScript+'"') -WorkingDirectory $runtime
    $trigger=New-ScheduledTaskTrigger -AtStartup; $trigger.Delay='PT1M'
    $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    $principal=New-ScheduledTaskPrincipal -UserId $apiIdentity -LogonType Password -RunLevel Highest
    $task=New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Starts the read-only DLE-OS DEV canonical API after Windows boot.'
    Register-ScheduledTask -TaskPath '\DLE-OS\Development\' -TaskName 'Canonical API 5052' -InputObject $task -User $apiIdentity -Password $password -Force | Out-Null
}
finally {
    if($plainPointer-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($plainPointer)}
    if($pointer-ne[IntPtr]::Zero){[DleOsCredentialReader]::CredFree($pointer)}
    $password=$null; $secure.Dispose()
}
