[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repository=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repository 'Tools\DevelopmentRuntime\DevFrontendDeployment.Common.ps1')
$checks=[Collections.Generic.List[string]]::new()
function Check([bool]$Condition,[string]$Name){if(-not$Condition){throw "FAILED: $Name"};$checks.Add($Name)}
function Expect-Rejected([scriptblock]$Action,[string]$Name){
    $rejected=$false
    try{&$Action}catch{$rejected=$true}
    Check $rejected $Name
}

$fixture=Join-Path ([IO.Path]::GetTempPath()) ('dle-os-immutable-frontend-'+[guid]::NewGuid())
try{
    $source=Join-Path $fixture 'source'
    New-Item -ItemType Directory -Path (Join-Path $source 'SRC'),(Join-Path $source 'ASSETS\ICONS'), `
        (Join-Path $source 'Tools\SimRuntime'),(Join-Path $source '.sim-state') -Force|Out-Null
    '<html>fixture</html>'|Set-Content -LiteralPath (Join-Path $source 'DLE_Work_Center_v4.0.0.html') -Encoding utf8
    'export const fixture=true;'|Set-Content -LiteralPath (Join-Path $source 'SRC\fixture.js') -Encoding utf8
    'fixture-icon'|Set-Content -LiteralPath (Join-Path $source 'ASSETS\ICONS\fixture.txt') -Encoding utf8
    'excluded runtime source'|Set-Content -LiteralPath (Join-Path $source 'Tools\SimRuntime\fixture.txt') -Encoding utf8
    'excluded mutable state'|Set-Content -LiteralPath (Join-Path $source '.sim-state\fixture.json') -Encoding utf8

    $release=Join-Path $fixture 'release'
    New-Item -ItemType Directory -Path $release|Out-Null
    $frontend=Join-Path $release 'frontend'
    $manifest=Join-Path $release 'frontend-manifest.json'
    $gitHead='0123456789abcdef0123456789abcdef01234567'
    $snapshot=New-DleOsFrontendSnapshot -SourceRoot $source -DestinationRoot $frontend `
        -ManifestPath $manifest -ReleaseId '20260904T120000Z' -SourceGitHead $gitHead
    Check ($snapshot.FileCount-eq 3-and$snapshot.ManifestSha256-match'^[0-9A-F]{64}$') `
        'snapshot records exact file count and SHA-256 manifest identity'
    $manifestDocument=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
    Check (@($manifestDocument.files|Where-Object{[string]::IsNullOrWhiteSpace([string]$_.RelativePath)}).Count-eq 0) `
        'manifest names every entry by normalized relativePath'
    Check (-not(Test-Path -LiteralPath (Join-Path $frontend 'Tools'))-and
           -not(Test-Path -LiteralPath (Join-Path $frontend '.sim-state'))) `
        'snapshot excludes SIM tooling and runtime state'

    Add-Content -LiteralPath (Join-Path $frontend 'SRC\fixture.js') -Value 'tampered'
    Expect-Rejected {
        $null=Assert-DleOsFrontendSnapshot -ContentRoot $frontend -ManifestPath $manifest `
            -ExpectedManifestSha256 $snapshot.ManifestSha256 -ExpectedFileCount 3 `
            -ExpectedReleaseId '20260904T120000Z' -ExpectedSourceGitHead $gitHead
    } 'changed release byte fails integrity validation'
    Remove-Item -LiteralPath $frontend -Recurse -Force
    Remove-Item -LiteralPath $manifest -Force
    $snapshot=New-DleOsFrontendSnapshot -SourceRoot $source -DestinationRoot $frontend `
        -ManifestPath $manifest -ReleaseId '20260904T120000Z' -SourceGitHead $gitHead
    'extra'|Set-Content -LiteralPath (Join-Path $frontend 'SRC\unmanifested.js') -Encoding utf8
    Expect-Rejected {
        $null=Assert-DleOsFrontendSnapshot -ContentRoot $frontend -ManifestPath $manifest `
            -ExpectedManifestSha256 $snapshot.ManifestSha256 -ExpectedFileCount 3 `
            -ExpectedReleaseId '20260904T120000Z' -ExpectedSourceGitHead $gitHead
    } 'unmanifested release file fails closed'

    $commonSource=Get-Content -LiteralPath (Join-Path $repository 'Tools\DevelopmentRuntime\DevFrontendDeployment.Common.ps1') -Raw
    $programSource=Get-Content -LiteralPath (Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\Program.cs') -Raw
    Check ($commonSource.Contains('ReparsePoint')-and$commonSource.Contains("relative.Contains(':')")) `
        'snapshot boundary rejects reparse points and drive-qualified traversal paths'
    Check ($programSource.Contains('Path.Combine(AppContext.BaseDirectory, "frontend")')-and
           -not$programSource.Contains('DLE_OS_REPOSITORY_ROOT')) `
        'Windows service runtime has no mutable repository fallback'
}
finally{
    if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Recurse -Force}
}

Write-Output "PASS: $($checks.Count) immutable frontend release checks."
$checks|ForEach-Object{Write-Output "  $_"}
