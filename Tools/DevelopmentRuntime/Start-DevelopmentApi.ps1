[CmdletBinding()]
param(
    [switch] $ElevatedStage,
    [string] $EvidencePath,
    [switch] $ReplaceDevelopmentApi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$operatorIdentity = 'DLE-OS-HOST\DLE-OS'
$runtimeIdentity = 'DLE-OS-HOST\DLE-OS-LIVE-API'
$credentialTarget = 'DLE-OS/LIVE-CANONICAL-API/RUNTIME'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$sourceRuntimeRoot = Join-Path $repository (
    'Tools\DevelopmentRuntime\DleOs.DevelopmentApi\bin\Release\net8.0')
$runtimeRoot = 'C:\ProgramData\DLE-OS\DevelopmentCanonicalApi'
$apiAssembly = Join-Path $runtimeRoot 'DleOs.DevelopmentApi.dll'
$sourceApiAssembly = Join-Path $sourceRuntimeRoot 'DleOs.DevelopmentApi.dll'
$dotnetPath = 'C:\Program Files\dotnet\dotnet.exe'
$readinessUri =
    'http://127.0.0.1:5052/api/platform/live/v1/readiness'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Listener {
    param([int] $Port)
    $row = netstat.exe -ano -p tcp |
        Select-String -Pattern (
            '^\s*TCP\s+\S+:' + $Port +
            '\s+\S+\s+LISTENING\s+\d+\s*$') |
        Select-Object -First 1
    if ($null -eq $row) { return $null }
    return [int]((-split $row.Line)[-1])
}

if (-not $ElevatedStage) {
    if (Test-Elevated) {
        throw 'Start the development launcher from the normal operator token.'
    }
    if (
        [Security.Principal.WindowsIdentity]::GetCurrent().Name -ine
        $operatorIdentity
    ) {
        throw "Launcher requires $operatorIdentity."
    }
    if ($null -ne (Get-Listener 5052)) {
        if (-not $ReplaceDevelopmentApi) {
            throw 'Port 5052 is already in use.'
        }
    }

    $evidenceDirectory = Join-Path $repository '.tmp\development-runtime'
    New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
    $EvidencePath = Join-Path $evidenceDirectory '5052-launch.json'
    $arguments = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`"",
        '-ElevatedStage',
        '-EvidencePath', "`"$EvidencePath`""
    )
    if ($ReplaceDevelopmentApi) {
        $arguments += '-ReplaceDevelopmentApi'
    }
    $child = Start-Process powershell.exe `
        -ArgumentList $arguments `
        -Verb RunAs `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    if (
        $child.ExitCode -ne 0 -or
        -not (Test-Path -LiteralPath $EvidencePath -PathType Leaf)
    ) {
        throw "Development API launch failed. Evidence: $EvidencePath"
    }
    $result = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json
    if ($result.Verdict -ne 'PASS') {
        throw "Development API launch verdict: $($result.Verdict)."
    }
    $result
    exit 0
}

if (-not (Test-Elevated)) {
    throw 'Elevated development launch stage was not elevated.'
}
if ([string]::IsNullOrWhiteSpace($EvidencePath)) {
    throw 'Elevated development launch evidence path is required.'
}
if (-not (Test-Path -LiteralPath $sourceApiAssembly -PathType Leaf)) {
    throw "Development API assembly is absent: $sourceApiAssembly"
}
if (-not (Test-Path -LiteralPath $dotnetPath -PathType Leaf)) {
    throw "The fixed .NET runtime is absent: $dotnetPath"
}
$existingDevelopmentPid = Get-Listener 5052
if ($null -ne $existingDevelopmentPid) {
    if (-not $ReplaceDevelopmentApi) {
        throw 'Port 5052 is already in use.'
    }
    $previousEvidencePath = Join-Path (
        Split-Path -Parent $EvidencePath) '5052-launch.json'
    $previousEvidence = Get-Content -LiteralPath $previousEvidencePath -Raw |
        ConvertFrom-Json
    if (
        $previousEvidence.Verdict -ne 'PASS' -or
        [int]$previousEvidence.ProcessId -ne $existingDevelopmentPid
    ) {
        throw 'The existing 5052 listener is not the qualified development API.'
    }
    Stop-Process -Id $existingDevelopmentPid -Force
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($null -eq (Get-Listener 5052)) { break }
        Start-Sleep -Milliseconds 250
    }
    if ($null -ne (Get-Listener 5052)) {
        throw 'Existing development API did not release port 5052.'
    }
}

$productionBefore = [ordered]@{
    Frontend = Get-Listener 5041
    Api = Get-Listener 5042
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Copy-Item `
    -Path (Join-Path $sourceRuntimeRoot '*') `
    -Destination $runtimeRoot `
    -Recurse `
    -Force
$aclResult = & icacls.exe $runtimeRoot /grant (
    "${runtimeIdentity}:(OI)(CI)(RX)") /T /C
if ($LASTEXITCODE -ne 0) {
    throw "Unable to grant development runtime read access: $aclResult"
}
if (-not (Test-Path -LiteralPath $apiAssembly -PathType Leaf)) {
    throw "Staged development API assembly is absent: $apiAssembly"
}
if ($null -eq $productionBefore.Frontend -or $null -eq $productionBefore.Api) {
    throw 'Both production listeners must be present before development launch.'
}

if (-not ('DleOs.Development.ReadCredential' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace DleOs.Development
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct StoredCredential
    {
        public UInt32 Flags;
        public UInt32 Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public static class ReadCredential
    {
        [DllImport("advapi32.dll", EntryPoint = "CredReadW",
            CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CredRead(
            string target,
            UInt32 type,
            UInt32 flags,
            out IntPtr credential);

        [DllImport("advapi32.dll", SetLastError = false)]
        public static extern void CredFree(IntPtr buffer);
    }
}
'@
}

$credentialPointer = [IntPtr]::Zero
$password = [Security.SecureString]::new()
$credential = $null
$process = $null
$evidence = [ordered]@{
    Verdict = 'FAIL'
    CheckedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Endpoint = 'http://DLE-OS-HOST:5052'
    WindowsIdentity = $runtimeIdentity
    ProductionBefore = $productionBefore
    RuntimeRoot = $runtimeRoot
}

try {
    if (
        -not [DleOs.Development.ReadCredential]::CredRead(
            $credentialTarget,
            1,
            0,
            [ref] $credentialPointer)
    ) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "Managed credential is unavailable (Win32 $errorCode)."
    }
    $stored = [Runtime.InteropServices.Marshal]::PtrToStructure(
        $credentialPointer,
        [type][DleOs.Development.StoredCredential])
    if ($stored.UserName -ne $runtimeIdentity) {
        throw 'Managed credential belongs to an unexpected identity.'
    }
    $characterCount = [int]($stored.CredentialBlobSize / 2)
    for ($index = 0; $index -lt $characterCount; $index++) {
        $password.AppendChar(
            [char][Runtime.InteropServices.Marshal]::ReadInt16(
                $stored.CredentialBlob,
                $index * 2))
    }
    $password.MakeReadOnly()
    $credential = [Management.Automation.PSCredential]::new(
        $runtimeIdentity,
        $password)

    $process = Start-Process `
        -FilePath $dotnetPath `
        -Credential $credential `
        -ArgumentList "`"$apiAssembly`"" `
        -WorkingDirectory $runtimeRoot `
        -WindowStyle Hidden `
        -LoadUserProfile `
        -PassThru

    $readiness = $null
    $readinessProbeError = $null
    $listenerReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 250
        $process.Refresh()
        if ($process.HasExited) {
            throw (
                'Development API exited before readiness with code ' +
                $process.ExitCode + '.')
        }
        try {
            $response = Invoke-WebRequest `
                -Uri $readinessUri `
                -UseBasicParsing `
                -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $readiness = $response.Content | ConvertFrom-Json
                break
            }
        }
        catch {
            $readinessProbeError = $_.Exception.Message
        }
        if ((Get-Listener 5052) -eq $process.Id) {
            $listenerReady = $true
            if ($attempt -ge 8) {
                break
            }
        }
    }
    if (-not $listenerReady -and $null -eq $readiness) {
        throw (
            'Development API did not reach its owned listener. Probe: ' +
            $readinessProbeError)
    }

    $productionAfter = [ordered]@{
        Frontend = Get-Listener 5041
        Api = Get-Listener 5042
    }
    if (
        $productionAfter.Frontend -ne $productionBefore.Frontend -or
        $productionAfter.Api -ne $productionBefore.Api
    ) {
        throw 'A production listener changed during development launch.'
    }

    $evidence.ProcessId = $process.Id
    $evidence.Readiness = $readiness
    $evidence.ReadinessProbeError = $readinessProbeError
    $evidence.ProductionAfter = $productionAfter
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}
finally {
    $evidence |
        ConvertTo-Json -Depth 10 |
        Set-Content -LiteralPath $EvidencePath -Encoding utf8
    if ($credentialPointer -ne [IntPtr]::Zero) {
        [DleOs.Development.ReadCredential]::CredFree($credentialPointer)
    }
    $credential = $null
    $password.Dispose()
}

if ($evidence.Verdict -ne 'PASS') {
    throw $evidence.Error
}
