[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedIdentity = 'DLE-OS-HOST\DLE-OS'
$runner =
    'C:\DLE-OS\Canonical\LiveMirror\Refresh\Invoke-LiveSnapshotRefresh.ps1'
$logRoot = 'C:\DLE-OS\Canonical\LiveMirror\Refresh\Logs'
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$stdout = Join-Path $logRoot "force-full-$stamp.stdout.log"
$stderr = Join-Path $logRoot "force-full-$stamp.stderr.log"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $expectedIdentity) {
    throw (
        "Force-full refresh requires $expectedIdentity; actual identity is " +
        "$identity."
    )
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    throw "The governed refresh runner is absent: $runner"
}
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$process = Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList @(
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        "`"$runner`"",
        '-ForceFullExtraction'
    ) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

[ordered]@{
    Verdict = 'STARTED'
    Intent = 'FORCE_FULL_EXTRACTION'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ExecutionIdentity = $identity
    ProcessId = $process.Id
    Runner = $runner
    StandardOutput = $stdout
    StandardError = $stderr
} | ConvertTo-Json -Depth 4
