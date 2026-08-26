[CmdletBinding()]
param([string]$OutputRoot='C:\DLE-OS\Qualification\DevResilience\Phase2')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)-or$identity.Name-ine'DLE-OS-HOST\Miguel'){throw 'Elevated Miguel is required.'}
$stamp=[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$root=Join-Path $OutputRoot ('phase2-security-status-'+$stamp)
$null=New-Item -ItemType Directory -Path $root -Force
$secureBoot=try{[bool](Confirm-SecureBootUEFI)}catch{$null}
$result=[ordered]@{
    Schema='dle-os.phase2-security-status.v1'
    CapturedUtc=[DateTimeOffset]::UtcNow
    Identity=$identity.Name
    SacState=[int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
    SecureBoot=$secureBoot
    Defender=(Get-MpComputerStatus|Select-Object AMServiceEnabled,AntivirusEnabled,BehaviorMonitorEnabled,RealTimeProtectionEnabled,IsTamperProtected,AntivirusSignatureLastUpdated)
    Services=@(Get-Service WinDefend,BrAmSvc,mpssvc|Select-Object Name,Status,StartType)
    DeviceGuard=(Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard|Select-Object VirtualizationBasedSecurityStatus,SecurityServicesConfigured,SecurityServicesRunning,CodeIntegrityPolicyEnforcementStatus,UsermodeCodeIntegrityPolicyEnforcementStatus)
    ReadOnly=$true
    ChangesMade=$false
}
$path=Join-Path $root 'phase2-security-status.json'
$result|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $path -Encoding UTF8
Write-Output $path
