[CmdletBinding()]
param([string] $ProfilePath)

$ErrorActionPreference = 'Stop'
$module = Join-Path $PSScriptRoot 'Developer\SimDeveloperTools.psm1'
Import-Module $module -Force

$profile = Get-DleOsSimProfile $ProfilePath
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
if (-not $preflight.passed) {
    $failed = $preflight.checks | Where-Object { -not $_.passed }
    $failed | Format-Table -AutoSize | Out-String | Write-Error
    throw 'DLE-OS SIM developer preflight failed. No launch was attempted.'
}

& (Join-Path $profile.repoPath 'Tools\SimRuntime\Start-DleOsSim.ps1') `
    -Lan `
    -LanAddress $profile.lanIp `
    -LanHostName $profile.hostname `
    -CertificateThumbprint $profile.certificateThumbprint
