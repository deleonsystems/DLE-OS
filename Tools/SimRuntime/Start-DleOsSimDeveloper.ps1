[CmdletBinding()]
param([string] $ProfilePath, [string] $LifecyclePath)

$ErrorActionPreference = 'Stop'
function Write-Lifecycle([string] $Event, [string] $ErrorId = '', $Details = $null) {
    if (-not $LifecyclePath) { return }
    try {
        @{event=$Event;timestampUtc=[DateTimeOffset]::UtcNow.ToString('O');runnerProcessId=$PID;sessionId=(Get-Process -Id $PID).SessionId;errorId=$ErrorId;nativeExitCode=$LASTEXITCODE;details=$Details} |
            ConvertTo-Json -Compress -Depth 8 | Add-Content -LiteralPath $LifecyclePath -Encoding UTF8
    } catch {}
}
Write-Lifecycle 'runner-start'
try {
$module = Join-Path $PSScriptRoot 'Developer\SimDeveloperTools.psm1'
Import-Module $module -Force

$profile = Get-DleOsSimProfile $ProfilePath
# Explicit per-profile opt-in; ordinary SIM profiles keep the adapter disabled.
$env:DLE_OS_SIM_OPERATIONS_IMPORT = if ($profile.PSObject.Properties['developmentalOperationsImport'] -and $profile.developmentalOperationsImport -eq $true) { 'true' } else { 'false' }
$runtime = Get-DleOsSimRuntimeStatus $profile
if ($runtime.running -and $runtime.binding -eq $profile.url) {
    [pscustomobject]@{
        result = 'already-running'
        processId = $runtime.processId
        url = $profile.url
    } | ConvertTo-Json -Depth 4
    return
}

$preflight = Test-DleOsSimPreflight $ProfilePath
Write-Lifecycle 'preflight' '' $preflight
if (-not $preflight.passed) {
    $failed = $preflight.checks | Where-Object { -not $_.passed }
    throw ('DLE-OS SIM developer preflight failed. No launch was attempted. ' + ($failed | ConvertTo-Json -Compress -Depth 6))
}

& (Join-Path $profile.repoPath 'Tools\SimRuntime\Start-DleOsSim.ps1') `
    -Lan `
    -LanAddress $profile.lanIp `
    -LanHostName $profile.hostname `
    -CertificateThumbprint $profile.certificateThumbprint

} catch {
    Write-Lifecycle 'runner-error' $_.FullyQualifiedErrorId
    throw
} finally {
    Write-Lifecycle 'runner-exit'
}
