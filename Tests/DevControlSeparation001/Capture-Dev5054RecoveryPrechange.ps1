[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Elevation required.'
}

$release = 'C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$manifest = 'C:\DLE-OS\Development\OperationalControlHost5054\Manifests\dev5054-20260825T170328Z-4e01176a73ea.json'
$output = 'C:\DLE-OS\Repositories\DLE-OS\Tests\DevControlSeparation001\dev5054-recovery-prechange.json'

$tasks = @()
Get-ScheduledTask | Where-Object { $_.TaskName -match '5054' } | ForEach-Object {
    $task = $_
    $info = Get-ScheduledTaskInfo -TaskPath $task.TaskPath -TaskName $task.TaskName
    $xml = Export-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $xmlHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($xml)))).Replace('-', '') }
    finally { $sha.Dispose() }
    $tasks += [ordered]@{
        TaskPath = $task.TaskPath; TaskName = $task.TaskName; State = [string]$task.State
        Enabled = [bool]$task.Settings.Enabled
        Principal = [ordered]@{ UserId = $task.Principal.UserId; LogonType = [string]$task.Principal.LogonType; RunLevel = [string]$task.Principal.RunLevel }
        Actions = @($task.Actions | ForEach-Object { [ordered]@{ Execute = $_.Execute; Arguments = $_.Arguments; WorkingDirectory = $_.WorkingDirectory } })
        LastRunTime = $info.LastRunTime; LastTaskResult = [int64]$info.LastTaskResult; XmlSha256 = $xmlHash; Xml = $xml
    }
}

$releaseManifest = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$checks = @()
foreach ($entry in $releaseManifest.files) {
    $path = Join-Path $release $entry.relativePath
    $checks += [ordered]@{
        RelativePath = $entry.relativePath; ExpectedSha256 = $entry.sha256
        ActualSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        ExpectedLength = [int64]$entry.length; ActualLength = (Get-Item -LiteralPath $path).Length
    }
}

$services = @()
foreach ($name in 'WinDefend', 'BrAmSvc', 'mpssvc', 'sshd', 'MSSQL$SQLEXPRESS', 'DleOsKeycloak', 'DleOsDevelopmentFrontend') {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($service) {
        $escapedName = $name.Replace("'", "''")
        $win32 = Get-CimInstance Win32_Service -Filter "Name='$escapedName'"
        $services += [ordered]@{ Name = $name; Status = [string]$service.Status; StartType = [string]$service.StartType; ProcessId = $win32.ProcessId; PathName = $win32.PathName; StartName = $win32.StartName }
    }
}

$account = Get-LocalUser -Name 'DLE-OS-DEV-CONTROL'
$adminMembers = @(Get-LocalGroupMember -Group 'Administrators' | ForEach-Object { $_.Name })
$ciRaw = & 'C:\Windows\System32\CiTool.exe' --list-policies --json 2>&1
if ($LASTEXITCODE -ne 0) { throw "CiTool failed: $($ciRaw -join ' ')" }
$start = (Get-Date).AddDays(-2)
$ciEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-CodeIntegrity/Operational'; StartTime = $start } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match '(?i)OperationalControlHost|dev5054|5054' } | Select-Object TimeCreated, Id, LevelDisplayName, Message)
$defenderEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; StartTime = $start } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match '(?i)OperationalControlHost|dev5054|5054' } | Select-Object TimeCreated, Id, LevelDisplayName, Message)
$hpLogs = @(Get-WinEvent -ListLog * -ErrorAction SilentlyContinue | Where-Object { $_.LogName -match '(?i)HP|Sure|Wolf' } | Select-Object LogName, RecordCount, IsEnabled)
$firewallRules = @(Get-NetFirewallRule -DisplayName 'OpenSSH SSH Server (sshd)' -ErrorAction SilentlyContinue |
    Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' })
$deviceGuard = Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard -ErrorAction SilentlyContinue

$result = [ordered]@{
    CapturedUtc = [DateTimeOffset]::UtcNow; ElevatedIdentity = $id.Name
    Windows = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' | Select-Object ProductName, DisplayVersion, CurrentBuild, UBR
    Sac = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' | Select-Object VerifiedAndReputablePolicyState, SAC_PreviousState, SAC_EnforcementReason
    Policies = ($ciRaw -join "`n" | ConvertFrom-Json)
    Release = [ordered]@{
        Path = $release; ManifestPath = $manifest; ManifestSha256 = (Get-FileHash $manifest -Algorithm SHA256).Hash; Files = $checks
        ReleaseAcl = Get-Acl $release | Select-Object Owner, AreAccessRulesProtected, AccessToString
        LauncherSha256 = (Get-FileHash (Join-Path $release 'Start-DevOperationalControlHost5054.ps1') -Algorithm SHA256).Hash
        ExecutableSha256 = (Get-FileHash (Join-Path $release 'DleOs.DevOperationalControlHost.exe') -Algorithm SHA256).Hash
    }
    Tasks = $tasks
    RuntimeIdentity = [ordered]@{ Enabled = $account.Enabled; Sid = [string]$account.Sid; IsAdministrator = ($adminMembers -contains 'DLE-OS-HOST\DLE-OS-DEV-CONTROL'); AdminMembers = $adminMembers }
    Services = $services
    Listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 22, 5041, 5042, 5043, 5051, 5052, 5054 } | Select-Object LocalAddress, LocalPort, OwningProcess)
    Defender = Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, BehaviorMonitorEnabled, RealTimeProtectionEnabled, IsTamperProtected
    SshFirewall = [ordered]@{ RuleCount = $firewallRules.Count; RemoteAddress = @($firewallRules | Get-NetFirewallAddressFilter | Select-Object -ExpandProperty RemoteAddress) }
    DeviceGuard = $deviceGuard | Select-Object VirtualizationBasedSecurityStatus, SecurityServicesConfigured, SecurityServicesRunning, CodeIntegrityPolicyEnforcementStatus, UsermodeCodeIntegrityPolicyEnforcementStatus
    SecureBoot = $(try { Confirm-SecureBootUEFI } catch { $null })
    CodeIntegrityEvents = $ciEvents; DefenderEvents = $defenderEvents; HpLogs = $hpLogs
    Http = [ordered]@{
        Frontend = $(try { (Invoke-WebRequest -UseBasicParsing -UseDefaultCredentials -Uri 'http://dle-os-host:5051/shared' -TimeoutSec 15).StatusCode } catch { $_.Exception.Message })
        CanonicalReadiness = $(try { Invoke-RestMethod -UseDefaultCredentials -Uri 'http://127.0.0.1:5052/api/platform/live/v1/readiness' -TimeoutSec 15 } catch { $_.Exception.Message })
        CanonicalGuard = $(try { Invoke-RestMethod -UseDefaultCredentials -Uri 'http://127.0.0.1:5052/api/development/v1/security' -TimeoutSec 15 } catch { $_.Exception.Message })
        Keycloak = $(try { (Invoke-WebRequest -UseBasicParsing -Uri 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration' -TimeoutSec 15).StatusCode } catch { $_.Exception.Message })
    }
}

$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $output -Encoding utf8
