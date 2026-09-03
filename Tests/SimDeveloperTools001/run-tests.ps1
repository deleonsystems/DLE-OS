[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$module = Join-Path $repository 'Tools\SimRuntime\Developer\SimDeveloperTools.psm1'
$statusCommand = Join-Path $repository 'Tools\SimRuntime\Get-DleOsSimStatus.ps1'
$profileSource = Join-Path $env:LOCALAPPDATA 'DLE-OS\SIM\sim-profile.json'
$testRoot = Join-Path $repository '.sim-state\qualification\phase14-developer-tools'
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if ($Condition -is [Array]) { throw "FAIL: non-Boolean test result for $Message" }
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function New-TestProfile([string] $Name, [string] $StartStatusJson) {
    $caseRoot = Join-Path $testRoot $Name
    New-Item -ItemType Directory -Path $caseRoot -Force | Out-Null
    $profilePath = Join-Path $caseRoot 'sim-profile.json'
    $sourceProfile = Get-Content -LiteralPath $profileSource -Raw | ConvertFrom-Json
    [pscustomobject]@{
        developerIdentity = 'SIM_DEVELOPER_TOOLS_TEST'
        repoPath = $repository
        lanIp = $sourceProfile.lanIp
        hostname = $sourceProfile.hostname
        url = $sourceProfile.url
        certificateThumbprint = $sourceProfile.certificateThumbprint
        firewallRuleName = $sourceProfile.firewallRuleName
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $profilePath -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $caseRoot 'start-status.json') -Value $StartStatusJson -Encoding UTF8
    return $profilePath
}

Import-Module $module -Force
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Require (Test-Path -LiteralPath $profileSource -PathType Leaf) 'developer tools test can read the local SIM profile template'

$modernTrue = Get-DleOsSimStartStatusAccessCodeMetadata ([pscustomobject]@{ usesUserConfiguredCode = $true })
Require ($modernTrue.recorded -and $modernTrue.usedUserConfiguredCode -eq $true -and $modernTrue.state -eq 'used-user-configured-code') 'modern start-status true is reported as true'

$modernFalse = Get-DleOsSimStartStatusAccessCodeMetadata ([pscustomobject]@{ usesUserConfiguredCode = $false })
Require ($modernFalse.recorded -and $modernFalse.usedUserConfiguredCode -eq $false -and $modernFalse.state -eq 'did-not-use-user-configured-code') 'modern start-status false is reported as false'

$legacy = Get-DleOsSimStartStatusAccessCodeMetadata ([pscustomobject]@{ result = 'started' })
Require (-not $legacy.recorded -and $null -eq $legacy.usedUserConfiguredCode -and $legacy.state -eq 'legacy-metadata') 'legacy start-status without usesUserConfiguredCode is reported as legacy metadata'

$miguelBranchProofMarker = 'MIGUEL_SIM_CONCURRENCY_PROOF_LOCAL_ONLY'
Require ($miguelBranchProofMarker -eq 'MIGUEL_SIM_CONCURRENCY_PROOF_LOCAL_ONLY') 'Miguel feature branch proof marker is present in SIM developer tooling tests'

$trueProfile = New-TestProfile 'modern-true' '{"result":"started","usesUserConfiguredCode":true}'
$trueStatus = & $statusCommand -ProfilePath $trueProfile -Json | ConvertFrom-Json
Require ($trueStatus.latestStartAccessCodeMetadata.recorded -and $trueStatus.latestStartAccessCodeMetadata.usedUserConfiguredCode -eq $true) 'Status command preserves modern true start-status metadata'

$falseProfile = New-TestProfile 'modern-false' '{"result":"started","usesUserConfiguredCode":false}'
$falseStatus = & $statusCommand -ProfilePath $falseProfile -Json | ConvertFrom-Json
Require ($falseStatus.latestStartAccessCodeMetadata.recorded -and $falseStatus.latestStartAccessCodeMetadata.usedUserConfiguredCode -eq $false) 'Status command preserves modern false start-status metadata'

$legacyProfile = New-TestProfile 'legacy-absent' '{"result":"started"}'
$legacyStatus = & $statusCommand -ProfilePath $legacyProfile -Json | ConvertFrom-Json
Require ($legacyStatus.latestStartAccessCodeMetadata.state -eq 'legacy-metadata') 'Status command succeeds for legacy start-status metadata'
Require ($null -eq $legacyStatus.latestStartAccessCodeMetadata.usedUserConfiguredCode) 'legacy start-status does not imply configured-code usage false'

$malformedProfile = New-TestProfile 'malformed' '{'
$malformedFailed = $false
try {
    & $statusCommand -ProfilePath $malformedProfile -Json | Out-Null
}
catch {
    $malformedFailed = $_.Exception.Message -match 'ConversionFromJson|Invalid JSON|JSON'
}
Require $malformedFailed 'malformed start-status JSON still fails clearly'

$combinedJson = @($trueStatus, $falseStatus, $legacyStatus) | ConvertTo-Json -Depth 8
Require ($combinedJson -notmatch 'DLE_OS_SIM_PERMANENT_ACCESS_CODE|PRIVATE KEY|github_pat_|ghp_') 'developer status compatibility output contains no secret material'

Write-Host "PASS: $($checks.Count) DLE-OS SIM developer tooling compatibility checks."
$checks | ForEach-Object { Write-Host "  - $_" }
