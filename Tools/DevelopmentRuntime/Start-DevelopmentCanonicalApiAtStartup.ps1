[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$diagnostic = 'C:\ProgramData\DLE-OS\DevelopmentCanonicalApi\Logs\startup-task-error.json'
trap {
    [ordered]@{
        FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
        Message = $_.Exception.Message
        ScriptLineNumber = $_.InvocationInfo.ScriptLineNumber
    } | ConvertTo-Json | Set-Content $diagnostic -Encoding UTF8
    exit 1
}
$expected = 'DLE-OS-HOST\DLE-OS-LIVE-API'
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ine $expected) {
    throw "The 5052 startup task must run as $expected."
}

function Get-Listener([int] $Port) {
    $row = netstat.exe -ano -p tcp | Select-String -Pattern (
        '^\s*TCP\s+\S+:' + $Port + '\s+\S+\s+LISTENING\s+\d+\s*$') |
        Select-Object -First 1
    if ($null -eq $row) { return $null }
    [int]((-split $row.Line)[-1])
}

$before = [ordered]@{ Frontend = Get-Listener 5041; Api = Get-Listener 5042 }
$bothPresent = $null -ne $before.Frontend -and $null -ne $before.Api
$bothAbsent = $null -eq $before.Frontend -and $null -eq $before.Api
if (-not ($bothPresent -or $bothAbsent)) {
    throw 'LIVE listeners 5041 and 5042 are in a mixed state; DEV startup fails closed.'
}

$runtime = 'C:\ProgramData\DLE-OS\DevelopmentCanonicalApi'
$exe = Join-Path $runtime 'DleOs.DevelopmentApi.exe'
$logRoot = Join-Path $runtime 'Logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$process = Start-Process -FilePath $exe -WorkingDirectory $runtime -PassThru `
    -RedirectStandardOutput (Join-Path $logRoot 'startup-task.stdout.log') `
    -RedirectStandardError (Join-Path $logRoot 'startup-task.stderr.log')

$ready = $null
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) { throw 'The DEV canonical API exited before readiness.' }
    try {
        $ready = Invoke-RestMethod -UseDefaultCredentials `
            -Uri 'http://127.0.0.1:5052/api/platform/live/v1/readiness' `
            -TimeoutSec 2
        if ($ready.readinessVerdict -eq 'Ready') { break }
    }
    catch {}
}
if ($null -eq $ready -or $ready.readinessVerdict -ne 'Ready') {
    throw 'The DEV canonical API did not become ready.'
}
$after = [ordered]@{ Frontend = Get-Listener 5041; Api = Get-Listener 5042 }
if ($after.Frontend -ne $before.Frontend -or $after.Api -ne $before.Api) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'A LIVE listener changed during DEV startup.'
}
[ordered]@{
    Verdict = 'PASS'; StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ProcessId = $process.Id; Identity = $expected; Endpoint = 'http://DLE-OS-HOST:5052'
    ProductionBefore = $before; ProductionAfter = $after; Readiness = $ready
} | ConvertTo-Json -Depth 10 | Set-Content `
    (Join-Path $logRoot 'startup-task-evidence.json') -Encoding UTF8

$process.WaitForExit()
exit $process.ExitCode
