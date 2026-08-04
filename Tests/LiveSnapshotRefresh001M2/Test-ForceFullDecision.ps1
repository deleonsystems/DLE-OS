[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$module = Join-Path (
    Resolve-Path (Join-Path $PSScriptRoot '..\..')
) 'Tools\LiveSnapshotRefresh\RefreshDecision.psm1'
Import-Module -Name $module -Force

function Assert-Equal {
    param([object] $Actual, [object] $Expected, [string] $Name)
    if ($Actual -cne $Expected) {
        throw "$Name expected $Expected; actual $Actual."
    }
}

Assert-Equal (
    Get-LiveSnapshotRefreshDisposition `
        -SourceUnchanged $true `
        -ForceFullExtraction $false `
        -QualificationCurrentFixture $false
) 'NO_SOURCE_CHANGES' 'normal unchanged source'
Assert-Equal (
    Get-LiveSnapshotRefreshDisposition `
        -SourceUnchanged $false `
        -ForceFullExtraction $false `
        -QualificationCurrentFixture $false
) 'FULL_EXTRACTION' 'normal changed source'
Assert-Equal (
    Get-LiveSnapshotRefreshDisposition `
        -SourceUnchanged $true `
        -ForceFullExtraction $true `
        -QualificationCurrentFixture $false
) 'FULL_EXTRACTION' 'force-full unchanged source'
Assert-Equal (
    Get-LiveSnapshotRefreshDisposition `
        -SourceUnchanged $false `
        -ForceFullExtraction $true `
        -QualificationCurrentFixture $false
) 'FULL_EXTRACTION' 'force-full changed source'
Assert-Equal (
    Get-LiveSnapshotRefreshDisposition `
        -SourceUnchanged $true `
        -ForceFullExtraction $false `
        -QualificationCurrentFixture $true
) 'QUALIFICATION_CURRENT_FIXTURE' 'fixture remains separate'

$rejected = $false
try {
    Get-LiveSnapshotRefreshDisposition `
        -SourceUnchanged $true `
        -ForceFullExtraction $true `
        -QualificationCurrentFixture $true | Out-Null
}
catch {
    $rejected = $_.Exception.Message -match 'mutually exclusive'
}
if (-not $rejected) {
    throw 'Force-full plus current-fixture was not rejected.'
}

[ordered]@{
    Verdict = 'PASS'
    Assertions = 6
    NormalUnchanged = 'NO_SOURCE_CHANGES'
    ForceFullUnchanged = 'FULL_EXTRACTION'
    QualificationCurrentFixture = 'SEPARATE'
} | ConvertTo-Json
