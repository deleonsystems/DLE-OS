[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedIdentity = 'DLE-OS-HOST\DLE-OS-LIVE-API'
$readinessUri =
    'http://DLE-OS-HOST:5042/api/platform/live/v1/readiness'
$manualEvidencePath =
    'C:\DLE-OS\Repositories\DLE-OS-Server\Artifacts\LiveApi001\ManualRuntime\manual-launch-evidence.json'
$logPath =
    'C:\ProgramData\DLE-OS\LiveCanonicalApi\Logs\live-api.stdout.log'
$outputRoot =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\LiveViewer001\RuntimeEvidence'
$outputPath = Join-Path $outputRoot 'live-runtime-evidence.json'

$principal =
    New-Object Security.Principal.WindowsPrincipal (
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )
if (
    -not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
) {
    throw 'Live runtime evidence capture requires an elevated operator token.'
}
if (-not (Test-Path -LiteralPath $outputRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
}
trap {
    $_ |
        Out-String |
        Set-Content `
            -LiteralPath (Join-Path $outputRoot 'capture-failure.log') `
            -Encoding UTF8
    exit 1
}

$row =
    netstat.exe -ano -p tcp |
    Select-String -Pattern '^\s*TCP\s+\S+:5042\s+\S+\s+LISTENING\s+\d+\s*$' |
    Select-Object -First 1
if ($null -eq $row) {
    throw 'No LIVE listener is present on port 5042.'
}
$processId = [int]((-split $row.Line)[-1])
$process =
    Get-CimInstance `
        -ClassName Win32_Process `
        -Filter "ProcessId=$processId" `
        -ErrorAction Stop
$owner =
    Invoke-CimMethod `
        -InputObject $process `
        -MethodName GetOwner `
        -ErrorAction Stop
$identity = "$($owner.Domain)\$($owner.User)"
if ($identity -ne $expectedIdentity) {
    throw "LIVE listener owner mismatch: $identity."
}
if (
    $process.Name -ne 'dotnet.exe' -or
    $process.ExecutablePath -ne 'C:\Program Files\dotnet\dotnet.exe' -or
    $process.CommandLine -notlike
        '*C:\Program Files\DLE-OS\LiveCanonicalApi\DLE-OS-Server.dll*' -or
    $process.CommandLine -notlike '*--environment Live*'
) {
    throw 'LIVE listener process is outside the approved runtime boundary.'
}

$readiness =
    Invoke-RestMethod `
        -Uri $readinessUri `
        -TimeoutSec 10 `
        -ErrorAction Stop
if (
    $readiness.readinessVerdict -ne 'Ready' -or
    $readiness.dataEnvironment -ne 'LIVE' -or
    $readiness.database -ne 'DLE_OS_CANONICAL_LIVE' -or
    $readiness.totalCount -ne 42322
) {
    throw 'LIVE readiness metadata does not match the qualified boundary.'
}
if (-not (Test-Path -LiteralPath $manualEvidencePath -PathType Leaf)) {
    throw 'Approved manual-launch evidence is absent.'
}
$manualEvidence =
    Get-Content -LiteralPath $manualEvidencePath -Raw |
    ConvertFrom-Json
if (
    $manualEvidence.Verdict -ne 'PASS' -or
    $manualEvidence.ProcessId -ne $processId -or
    $manualEvidence.WindowsIdentity -ne $expectedIdentity
) {
    throw 'Manual-launch evidence does not match the active LIVE process.'
}
if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
    throw 'The approved LIVE runtime log is absent.'
}
$log = Get-Content -LiteralPath $logPath -Raw
$listenerLogLine =
    (
        $log -split '\r?\n' |
        Where-Object { $_ -match 'Now listening on:\s+http://\S+:5042' } |
        Select-Object -Last 1
    )
if ([string]::IsNullOrWhiteSpace($listenerLogLine)) {
    throw 'The LIVE runtime log does not prove the qualified listener.'
}

$evidence = [ordered]@{
    Mission = 'LIVE-VIEWER-001'
    CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ServerProcessId = $processId
    ProcessOwner = $identity
    ProcessName = $process.Name
    ExecutablePath = $process.ExecutablePath
    CommandLine = $process.CommandLine
    Port = 5042
    ReadinessUri = $readinessUri
    ReadinessVerdict = $readiness.readinessVerdict
    DataEnvironment = $readiness.dataEnvironment
    Database = $readiness.database
    TotalCount = $readiness.totalCount
    ImportRunId = $readiness.currentImportRunId
    MirrorRunId = $readiness.mirrorRunId
    PackageHash = $readiness.packageHash
    LogPath = $logPath
    LogLength = (Get-Item -LiteralPath $logPath).Length
    ListenerLogLine = $listenerLogLine.Trim()
    ManualLaunchEvidencePath = $manualEvidencePath
    ManualLaunchEvidenceVerdict = $manualEvidence.Verdict
    Verdict = 'PASS'
}
$evidence |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $outputPath -Encoding UTF8
$evidence | ConvertTo-Json -Depth 5
