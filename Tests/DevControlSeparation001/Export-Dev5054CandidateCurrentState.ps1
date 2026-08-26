[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Elevation required.'
}

$release = 'C:\DLE-OS\Development\OperationalControlHost5054\Releases\dev5054-20260825T170328Z-4e01176a73ea'
$executable = Join-Path $release 'DleOs.DevOperationalControlHost.exe'
$manifestPath = 'C:\DLE-OS\Development\OperationalControlHost5054\Manifests\dev5054-20260825T170328Z-4e01176a73ea.json'
$outputPath = Join-Path $PSScriptRoot 'dev5054-candidate-current-state.json'
$candidatePath = '\'
$candidateName = 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyPath = '\DLE-OS\Development\'
$legacyName = 'Operational ControlHost 5054'

function Invoke-WebProbe([string]$Uri, [bool]$Json) {
    try {
        if ($Json) {
            return [ordered]@{ Passed = $true; Status = 200; Body = Invoke-RestMethod -Uri $Uri -TimeoutSec 15 }
        }
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 15
        return [ordered]@{ Passed = $response.StatusCode -eq 200; Status = [int]$response.StatusCode }
    }
    catch { return [ordered]@{ Passed = $false; Error = $_.Exception.Message } }
}

function Get-TaskSummary([string]$TaskPath, [string]$TaskName) {
    $task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    $info = Get-ScheduledTaskInfo -TaskPath $TaskPath -TaskName $TaskName
    [ordered]@{
        State = [string]$task.State
        Enabled = [bool]$task.Settings.Enabled
        UserId = $task.Principal.UserId
        LogonType = [string]$task.Principal.LogonType
        RunLevel = [string]$task.Principal.RunLevel
        LastRunTime = $info.LastRunTime
        LastTaskResult = [int64]$info.LastTaskResult
        ExecutionTimeLimit = [string]$task.Settings.ExecutionTimeLimit
        Actions = @($task.Actions | Select-Object Execute, Arguments, WorkingDirectory)
    }
}

$processes = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath -ieq $executable
} | ForEach-Object {
    $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
    [ordered]@{
        ProcessId = [int]$_.ProcessId
        ParentProcessId = [int]$_.ParentProcessId
        ExecutablePath = $_.ExecutablePath
        CommandLine = $_.CommandLine
        CreationDate = $_.CreationDate
        WorkingSetSize = [int64]$_.WorkingSetSize
        Owner = if ($owner.ReturnValue -eq 0) { "$($owner.Domain)\$($owner.User)" } else { $null }
    }
})

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$releaseFiles = @($manifest.files | ForEach-Object {
    $path = Join-Path $release $_.relativePath
    [ordered]@{
        RelativePath = $_.relativePath
        ExpectedSha256 = $_.sha256
        ActualSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        ExpectedLength = [int64]$_.length
        ActualLength = (Get-Item -LiteralPath $path).Length
    }
})

$started = (Get-ScheduledTaskInfo -TaskPath $candidatePath -TaskName $candidateName).LastRunTime
$result = [ordered]@{
    Schema = 'dle-os.dev5054-candidate-current-state.v1'
    CapturedUtc = [DateTimeOffset]::UtcNow
    ElevatedIdentity = $identity.Name
    Candidate = Get-TaskSummary $candidatePath $candidateName
    Legacy = Get-TaskSummary $legacyPath $legacyName
    Processes = $processes
    Listener5054 = @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess)
    ReleaseFileCount = $releaseFiles.Count
    ReleaseMismatchCount = @($releaseFiles | Where-Object { $_.ActualSha256 -ne $_.ExpectedSha256 -or $_.ActualLength -ne $_.ExpectedLength }).Count
    ReleaseFiles = $releaseFiles
    Frontend = Invoke-WebProbe 'http://dle-os-host:5051/shared' $false
    CanonicalReadiness = Invoke-WebProbe 'http://127.0.0.1:5052/api/platform/live/v1/readiness' $true
    CanonicalGuard = Invoke-WebProbe 'http://127.0.0.1:5052/api/development/v1/security' $true
    Keycloak = Invoke-WebProbe 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration' $false
    Services = @('WinDefend','BrAmSvc','mpssvc','sshd','MSSQL$SQLEXPRESS','DleOsKeycloak','DleOsDevelopmentFrontend') | ForEach-Object {
        Get-Service -Name $_ -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType
    }
    SacState = [int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
    SecureBoot = try { [bool](Confirm-SecureBootUEFI) } catch { $null }
    DeviceGuard = Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard -ErrorAction SilentlyContinue | Select-Object VirtualizationBasedSecurityStatus, SecurityServicesConfigured, SecurityServicesRunning, CodeIntegrityPolicyEnforcementStatus, UsermodeCodeIntegrityPolicyEnforcementStatus
    Defender = Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, BehaviorMonitorEnabled, RealTimeProtectionEnabled, IsTamperProtected
    Firewall = @(Get-NetFirewallRule -DisplayName 'OpenSSH SSH Server (sshd)' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | ForEach-Object {
        [ordered]@{ Name = $_.Name; RemoteAddress = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $_ | Select-Object -ExpandProperty RemoteAddress) }
    })
    CodeIntegrityEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-CodeIntegrity/Operational'; StartTime = $started } -ErrorAction SilentlyContinue | Where-Object {
        $_.Message -match 'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea'
    } | Select-Object TimeCreated, RecordId, Id, LevelDisplayName, Message)
    DefenderEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Windows Defender/Operational'; StartTime = $started } -ErrorAction SilentlyContinue | Where-Object {
        $_.Message -match 'DleOs\.DevOperationalControlHost|dev5054-20260825T170328Z-4e01176a73ea'
    } | Select-Object TimeCreated, RecordId, Id, LevelDisplayName, Message)
    LiveListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 5041,5042,5043 } | Select-Object LocalAddress, LocalPort, OwningProcess)
}

$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $outputPath -Encoding utf8
$result | ConvertTo-Json -Depth 8
