[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Scenario,
    [Parameter(Mandatory)][string]$Protocol,
    [Parameter(Mandatory)][string]$Mission,
    [Parameter(Mandatory)][string]$AttemptId,
    [Parameter(Mandatory)][string]$GracefulSignal,
    [Parameter(Mandatory)][string]$Source
)
$ErrorActionPreference = 'Stop'
function Add-Event {
    param([string]$Type, [hashtable]$Extra=@{})
    $event = [ordered]@{
        protocolVersion='1.0'; mission=$Mission; attemptId=$AttemptId
        timestampUtc=[DateTimeOffset]::UtcNow.ToString('O'); processId=$PID
        eventType=$Type; sourceAccessMode='O_RDONLY'; writeCount=0; lockCount=0
    }
    foreach ($key in $Extra.Keys) { $event[$key]=$Extra[$key] }
    ($event | ConvertTo-Json -Compress) | Add-Content -LiteralPath $Protocol -Encoding UTF8
}
if ($Scenario -eq 'exit-before') { exit 9 }
if ($Scenario -eq 'retry-once') {
    $state = Join-Path $PSScriptRoot 'retry-once.state'
    if (-not (Test-Path $state)) {
        'first failure' | Set-Content $state
        exit 9
    }
    $Scenario = 'success'
}
if ($Scenario -eq 'malformed') { '{bad json' | Set-Content $Protocol; Start-Sleep -Seconds 1; exit 0 }
if ($Scenario -eq 'no-first') { Start-Sleep -Seconds 5; exit 0 }
Add-Event 'QUALIFIER_STARTED'
if ($Scenario -eq 'missing-complete') { exit 0 }
if ($Scenario -in @('no-progress','progress-stall','hard-runtime','graceful-success','graceful-force')) {
    if ($Scenario -eq 'progress-stall') { Add-Event 'PROGRESS' @{ recordsExamined=1 } }
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds(8)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        if ($Scenario -eq 'graceful-success' -and (Test-Path $GracefulSignal)) { exit 0 }
        Start-Sleep -Milliseconds 100
    }
    exit 0
}
Add-Event 'SOURCE_PREFLIGHT_COMPLETE'
Add-Event 'SOURCE_OPENED'
Add-Event 'PROGRESS' @{ recordsExamined=1; recordsSelected=1 }
if ($Scenario -eq 'source-mismatch') {
    Add-Content -LiteralPath $Source -Value 'controlled local mutation'
}
$writeCount = if ($Scenario -eq 'write-count') { 1 } else { 0 }
$lockCount = if ($Scenario -eq 'lock-count') { 1 } else { 0 }
Add-Event 'SOURCE_CLOSED'
Add-Event 'QUALIFIER_COMPLETE' @{
    verdict='PASS'; sourceCounts=@{fixture=1}; sourceFingerprints=@{fixture='TEST'}
    sourceIdentityBefore=@{}; sourceIdentityAfter=@{}
    writeCount=$writeCount; lockCount=$lockCount; elapsedMilliseconds=20
    outputFiles=@(); outputHashes=@{}
}
exit 0
