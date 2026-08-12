[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$diagnosticPath = Join-Path $PSScriptRoot `
    '..\..\.tmp\development-runtime\startup-task-installer-error.log'
trap {
    $safeError = [ordered]@{
        FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        Message = $_.Exception.Message
        ScriptName = $_.InvocationInfo.ScriptName
        ScriptLineNumber = $_.InvocationInfo.ScriptLineNumber
        OffsetInLine = $_.InvocationInfo.OffsetInLine
    }
    $safeError | ConvertTo-Json | Set-Content -LiteralPath $diagnosticPath `
        -Encoding UTF8
    exit 1
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Installing DEV backend startup tasks requires elevation.'
}

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class DleOsBatchLogonRight
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_UNICODE_STRING
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES
    {
        public uint Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint LsaOpenPolicy(
        IntPtr systemName, ref LSA_OBJECT_ATTRIBUTES attributes,
        uint desiredAccess, out IntPtr policyHandle);

    [DllImport("advapi32.dll")]
    private static extern uint LsaAddAccountRights(
        IntPtr policyHandle, byte[] accountSid,
        LSA_UNICODE_STRING[] userRights, uint countOfRights);

    [DllImport("advapi32.dll")]
    private static extern uint LsaNtStatusToWinError(uint status);

    [DllImport("advapi32.dll")]
    private static extern uint LsaClose(IntPtr policyHandle);

    public static void Add(string account, string right)
    {
        var sid = (SecurityIdentifier)new NTAccount(account).Translate(
            typeof(SecurityIdentifier));
        var sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);
        var attributes = new LSA_OBJECT_ATTRIBUTES();
        attributes.Length = (uint)Marshal.SizeOf(attributes);
        IntPtr policy;
        uint status = LsaOpenPolicy(IntPtr.Zero, ref attributes, 0x00000810,
            out policy);
        if (status != 0)
            throw new Win32Exception((int)LsaNtStatusToWinError(status));
        IntPtr buffer = Marshal.StringToHGlobalUni(right);
        try
        {
            var rights = new[] { new LSA_UNICODE_STRING {
                Buffer = buffer,
                Length = (ushort)(right.Length * 2),
                MaximumLength = (ushort)((right.Length + 1) * 2)
            }};
            status = LsaAddAccountRights(policy, sidBytes, rights, 1);
            if (status != 0)
                throw new Win32Exception((int)LsaNtStatusToWinError(status));
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
            LsaClose(policy);
        }
    }
}
'@

foreach ($account in 'DLE-OS-HOST\DLE-OS-LIVE-API', 'DLE-OS-HOST\DLE-OS') {
    [DleOsBatchLogonRight]::Add($account, 'SeBatchLogonRight')
}

$taskPath = '\DLE-OS\Development\'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$runtime5054 =
    'C:\DLE-OS\Development\OperationalControlHost5054\20260810T222000Z'
$log5054 =
    'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Logs\startup'
$runtime5052 = 'C:\ProgramData\DLE-OS\DevelopmentCanonicalApi'
$startup5052Source = Join-Path $repository `
    'Tools\DevelopmentRuntime\Start-DevelopmentCanonicalApiAtStartup.ps1'
$startup5052Runtime = Join-Path $runtime5052 `
    'Start-DevelopmentCanonicalApiAtStartup.ps1'
if (-not (Test-Path -LiteralPath $startup5052Source -PathType Leaf)) {
    throw 'The governed 5052 startup wrapper is absent.'
}
Copy-Item -LiteralPath $startup5052Source -Destination $startup5052Runtime `
    -Force
$log5052 = Join-Path $runtime5052 'Logs'
New-Item -ItemType Directory -Path $log5052 -Force | Out-Null
$aclResult = & icacls.exe $log5052 /grant `
    'DLE-OS-HOST\DLE-OS-LIVE-API:(OI)(CI)(M)'
if ($LASTEXITCODE -ne 0) {
    throw "Unable to grant the DEV API log ACL: $aclResult"
}

$trigger5052 = New-ScheduledTaskTrigger -AtStartup
$trigger5052.Delay = 'PT30S'
$trigger5054 = New-ScheduledTaskTrigger -AtStartup
$trigger5054.Delay = 'PT45S'
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

$action5052 = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument (
        '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
        '-File "' + $repository +
        '\Tools\DevelopmentRuntime\Provision-DevelopmentCanonicalApiStartupTask.ps1"') `
    -WorkingDirectory $repository
$principal5052 = New-ScheduledTaskPrincipal `
    -UserId 'DLE-OS-HOST\DLE-OS' `
    -LogonType Password `
    -RunLevel Highest

$action5054 = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument (
        '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
        '-File "' + $repository +
        '\Tools\DevelopmentRuntime\Start-DevOperationalControlHost5054WithEnvironment.ps1" ' +
        '-Runtime "' + $runtime5054 + '" ' +
        '-LogPrefix "' + $log5054 + '"') `
    -WorkingDirectory $repository
$principal5054 = New-ScheduledTaskPrincipal `
    -UserId 'DLE-OS-HOST\DLE-OS' `
    -LogonType Password `
    -RunLevel Highest

$credential = Get-Credential -UserName 'DLE-OS-HOST\DLE-OS' -Message (
    'Enter the existing DLE-OS operator credential once so Windows Task ' +
    'Scheduler can start DEV backends when nobody is logged in.')
if ($credential.UserName -ine 'DLE-OS-HOST\DLE-OS') {
    throw 'The startup tasks require the existing DLE-OS-HOST\DLE-OS identity.'
}
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
    $credential.Password)
try {
    $taskPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        $passwordPointer)
    $task5052 = New-ScheduledTask -Action $action5052 -Trigger $trigger5052 `
        -Settings $settings -Principal $principal5052 `
        -Description 'Starts the read-only DLE-OS DEV canonical API after Windows boot.'
    $task5054 = New-ScheduledTask -Action $action5054 -Trigger $trigger5054 `
        -Settings $settings -Principal $principal5054 `
        -Description 'Starts the isolated DLE-OS DEV operational ControlHost after 5052 is ready.'
    Register-ScheduledTask -TaskPath $taskPath -TaskName 'Canonical API 5052 Provisioner' `
        -InputObject $task5052 -User $credential.UserName -Password $taskPassword `
        -Force | Out-Null
    Register-ScheduledTask -TaskPath $taskPath `
        -TaskName 'Operational ControlHost 5054' `
        -InputObject $task5054 -User $credential.UserName -Password $taskPassword `
        -Force | Out-Null
}
finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $taskPassword = $null
    $credential = $null
}

Start-ScheduledTask -TaskPath $taskPath -TaskName 'Canonical API 5052 Provisioner'
$provisionDeadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Seconds 1
    $canonicalTask = Get-ScheduledTask -TaskPath $taskPath `
        -TaskName 'Canonical API 5052' -ErrorAction SilentlyContinue
} until (($null -ne $canonicalTask -and
        $canonicalTask.Principal.UserId -in @(
            'DLE-OS-HOST\DLE-OS-LIVE-API', 'DLE-OS-LIVE-API')) -or
    (Get-Date) -gt $provisionDeadline)
if ($null -eq $canonicalTask -or
    $canonicalTask.Principal.UserId -notin @(
        'DLE-OS-HOST\DLE-OS-LIVE-API', 'DLE-OS-LIVE-API')) {
    throw 'The permanent 5052 task was not provisioned under its runtime identity.'
}
Start-ScheduledTask -TaskPath $taskPath -TaskName 'Canonical API 5052'
$deadline = (Get-Date).AddSeconds(45)
do {
    Start-Sleep -Seconds 1
    $ready5052 = $false
    try {
        $readiness = Invoke-RestMethod -UseDefaultCredentials `
            -Uri 'http://dle-os-host:5052/api/platform/live/v1/readiness' `
            -TimeoutSec 2
        $ready5052 = $readiness.readinessVerdict -eq 'Ready'
    }
    catch {}
} until ($ready5052 -or (Get-Date) -gt $deadline)
if (-not $ready5052) { throw '5052 did not become ready from its startup task.' }

Unregister-ScheduledTask -TaskPath $taskPath `
    -TaskName 'Canonical API 5052 Provisioner' -Confirm:$false

Remove-Item -Force -ErrorAction SilentlyContinue `
    'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Logs\startup.evidence.json'
Start-ScheduledTask -TaskPath $taskPath -TaskName 'Operational ControlHost 5054'
$deadline = (Get-Date).AddSeconds(60)
do {
    Start-Sleep -Seconds 1
    $startup5054Evidence = Get-Content -Raw -ErrorAction SilentlyContinue `
        'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Logs\startup.evidence.json' |
        ConvertFrom-Json -ErrorAction SilentlyContinue
    $ready5054 = $startup5054Evidence.Verdict -eq 'PASS' -and
        $startup5054Evidence.Dependency5052 -eq 'Ready'
} until ($ready5054 -or (Get-Date) -gt $deadline)
if (-not $ready5054) { throw '5054 did not become ready from its startup task.' }

$evidence = [ordered]@{
    Verdict = 'PASS'
    InstalledAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    InstallerIdentity = $identity.Name
    CanonicalApi = $readiness
    OperationalControlHost = $startup5054Evidence
    Tasks = @(Get-ScheduledTask -TaskPath $taskPath | ForEach-Object {
        $info = Get-ScheduledTaskInfo $_
        [ordered]@{
            Name = $_.TaskName
            State = [string]$_.State
            User = $_.Principal.UserId
            LogonType = [string]$_.Principal.LogonType
            LastRunTime = $info.LastRunTime
            LastTaskResult = $info.LastTaskResult
            TriggerDelay = $_.Triggers.Delay
            Action = $_.Actions.Execute + ' ' + $_.Actions.Arguments
        }
    })
}
$evidencePath = Join-Path $repository `
    '.tmp\development-runtime\backend-startup-installation.json'
$evidence | ConvertTo-Json -Depth 10 | Set-Content $evidencePath -Encoding UTF8
[pscustomobject]$evidence
