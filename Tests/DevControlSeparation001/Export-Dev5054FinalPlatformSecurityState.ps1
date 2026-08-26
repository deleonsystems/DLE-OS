[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
if(-not([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw'Elevation required.'}
$candidate=Get-ScheduledTask -TaskPath '\' -TaskName 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacy=Get-ScheduledTask -TaskPath '\DLE-OS\Development\' -TaskName 'Operational ControlHost 5054'
$dg=Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard
$result=[ordered]@{Schema='dle-os.dev5054-final-platform-security.v1';CapturedUtc=[DateTimeOffset]::UtcNow;ElevatedIdentity=$id.Name;SecureBoot=[bool](Confirm-SecureBootUEFI);SacState=[int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState;DeviceGuard=[ordered]@{VirtualizationBasedSecurityStatus=$dg.VirtualizationBasedSecurityStatus;SecurityServicesConfigured=@($dg.SecurityServicesConfigured);SecurityServicesRunning=@($dg.SecurityServicesRunning);CodeIntegrityPolicyEnforcementStatus=$dg.CodeIntegrityPolicyEnforcementStatus;UsermodeCodeIntegrityPolicyEnforcementStatus=$dg.UsermodeCodeIntegrityPolicyEnforcementStatus};Candidate=[ordered]@{State=[string]$candidate.State;Enabled=[bool]$candidate.Settings.Enabled;ExecutionTimeLimit=[string]$candidate.Settings.ExecutionTimeLimit};Legacy=[ordered]@{State=[string]$legacy.State;Enabled=[bool]$legacy.Settings.Enabled};Listener5054Count=@(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue).Count}
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'dev5054-final-platform-security.json') -Encoding utf8
