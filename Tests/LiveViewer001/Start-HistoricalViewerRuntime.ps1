[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedIdentity = 'DLE-OS-HOST\DLE-OS'
$readinessUri = 'http://127.0.0.1:5041/api/platform/v1/readiness'
$snapshotUri = 'http://127.0.0.1:5041/api/platform/v1/snapshot'
$browserOrigin = 'http://DLE-OS-HOST:5041'
$serverRoot = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$assembly = Join-Path $serverRoot 'bin\Release\net8.0\DLE-OS-Server.dll'
$dotnetPath = 'C:\Program Files\dotnet\dotnet.exe'
$artifactRoot =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\LiveViewer001\HistoricalRuntime'
$logPath = Join-Path $artifactRoot 'historical-api.log'
$errorLogPath = Join-Path $artifactRoot 'historical-api.stderr.log'
$evidencePath = Join-Path $artifactRoot 'historical-runtime-evidence.json'

function Get-ListeningProcessId {
    $row =
        netstat.exe -ano -p tcp |
        Select-String -Pattern '^\s*TCP\s+\S+:5041\s+\S+\s+LISTENING\s+\d+\s*$' |
        Select-Object -First 1
    if ($null -eq $row) {
        return $null
    }
    return [int]((-split $row.Line)[-1])
}

function Get-ProcessOwner {
    param([int]$ProcessId)

    $process =
        Get-CimInstance `
            -ClassName Win32_Process `
            -Filter "ProcessId=$ProcessId" `
            -ErrorAction Stop
    $owner =
        Invoke-CimMethod `
            -InputObject $process `
            -MethodName GetOwner `
            -ErrorAction Stop
    return [pscustomobject]@{
        Identity = "$($owner.Domain)\$($owner.User)"
        Process = $process
    }
}

$currentIdentity =
    [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($currentIdentity -ne $expectedIdentity) {
    throw (
        "Historical runtime launch requires $expectedIdentity; " +
        "actual identity is $currentIdentity."
    )
}
if (-not (Test-Path -LiteralPath $assembly -PathType Leaf) -or
    -not (Test-Path -LiteralPath $dotnetPath -PathType Leaf)) {
    throw 'The fixed historical runtime boundary is incomplete.'
}
if (-not (Test-Path -LiteralPath $artifactRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
}

$existingProcessId = Get-ListeningProcessId
$launcherProcessId = $null
$launchDisposition = 'PRESERVED_EXISTING'
if ($null -eq $existingProcessId) {
    $created = Start-Process `
        -FilePath $dotnetPath `
        -ArgumentList "`"$assembly`"" `
        -WorkingDirectory $serverRoot `
        -RedirectStandardOutput $logPath `
        -RedirectStandardError $errorLogPath `
        -WindowStyle Hidden `
        -PassThru
    $launcherProcessId = [int]$created.Id
    $launchDisposition = 'DETACHED_CREATED'
}

$deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
$serverProcessId = $null
$readiness = $null
do {
    Start-Sleep -Milliseconds 250
    $serverProcessId = Get-ListeningProcessId
    if ($null -ne $serverProcessId) {
        try {
            $readiness =
                Invoke-RestMethod `
                    -Uri $readinessUri `
                    -TimeoutSec 2 `
                    -ErrorAction Stop
        }
        catch {
            $readiness = $null
        }
    }
}
until (
    (
        $null -ne $readiness -and
        $readiness.status -eq 'Ready'
    ) -or
    [DateTimeOffset]::UtcNow -ge $deadline
)

if ($null -eq $readiness -or $readiness.status -ne 'Ready') {
    if ($null -ne $launcherProcessId) {
        Stop-Process -Id $launcherProcessId -ErrorAction SilentlyContinue
    }
    throw 'The detached historical API did not reach Ready.'
}

$snapshot =
    Invoke-RestMethod `
        -Uri $snapshotUri `
        -TimeoutSec 10 `
        -ErrorAction Stop
if ($snapshot.totalCount -ne 26902) {
    throw 'The historical snapshot count is not 26,902.'
}

if ($null -ne $launcherProcessId) {
    # HTTP.sys can report the long-lived apphost registration PID instead of
    # the newly launched dotnet host. Qualify the exact process we created;
    # readiness above independently proves that the fixed port is serving.
    $serverProcessId = $launcherProcessId
}
$processOwner = Get-ProcessOwner -ProcessId $serverProcessId
if ($processOwner.Identity -ne $expectedIdentity) {
    throw (
        'Historical listener owner mismatch. Expected ' +
        "$expectedIdentity; actual $($processOwner.Identity)."
    )
}
$isQualifiedDotnet =
    $processOwner.Process.Name -eq 'dotnet.exe' -and
    $processOwner.Process.CommandLine -like
        '*DLE-OS-Server\bin\Release\net8.0\DLE-OS-Server.dll*'
$isExistingDevelopmentHost =
    $launchDisposition -eq 'PRESERVED_EXISTING' -and
    $processOwner.Process.Name -eq 'DLE-OS-Server.exe' -and
    $processOwner.Process.CommandLine -eq
        '"C:\DLE-OS\Repositories\DLE-OS-Server\bin\Debug\net8.0\DLE-OS-Server.exe"'
if (-not $isQualifiedDotnet -and -not $isExistingDevelopmentHost) {
    if ($null -ne $launcherProcessId) {
        Stop-Process -Id $launcherProcessId -ErrorAction SilentlyContinue
    }
    throw (
        'Historical listener command line is outside the fixed boundary. ' +
        "Name=$($processOwner.Process.Name); " +
        "CommandLine=$($processOwner.Process.CommandLine)"
    )
}
if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
    throw 'Historical runtime log was not created.'
}
$log = Get-Content -LiteralPath $logPath -Raw
if ($log -notmatch 'Now listening on:\s+http://0\.0\.0\.0:5041') {
    throw 'Historical runtime log does not prove the fixed listener.'
}

$evidence = [ordered]@{
    Mission = 'LIVE-VIEWER-001'
    CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    LaunchMethod = 'Start-Process detached dotnet'
    LaunchDisposition = $launchDisposition
    LauncherProcessId = $launcherProcessId
    ServerProcessId = $serverProcessId
    ProcessOwner = $processOwner.Identity
    ProcessName = $processOwner.Process.Name
    CommandLine = $processOwner.Process.CommandLine
    Port = 5041
    BrowserOrigin = $browserOrigin
    ReadinessUri = $readinessUri
    ReadinessVerdict = $readiness.status
    SnapshotTotalCount = $snapshot.totalCount
    LogPath = $logPath
    ErrorLogPath = $errorLogPath
    LogLength = (Get-Item -LiteralPath $logPath).Length
    Verdict = 'PASS'
}
$evidence |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $evidencePath -Encoding UTF8
$evidence | ConvertTo-Json -Depth 5
