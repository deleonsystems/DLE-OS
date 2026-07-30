[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$publisher = Join-Path $repository (
    'Tools\PlatformFreshnessCache\Publish-VersionedFrontend.ps1')
$rollback = Join-Path $repository (
    'Tools\PlatformFreshnessCache\Rollback-VersionedFrontend.ps1')
$artifact = Join-Path $repository (
    'Artifacts\PlatformFreshnessCache001\' +
    'PLATFORMFRESHNESSCACHE001-20260730T010815Z\' +
    'CACHE_VERSIONING_LOCAL_QUALIFICATION.json')
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) (
    'DLE-OS-PlatformFreshnessCache-' + [Guid]::NewGuid().ToString('N'))
$publicationRoot = Join-Path $tempRoot 'Frontend'
New-Item -ItemType Directory -Path $publicationRoot -Force | Out-Null

$assertions = [Collections.Generic.List[object]]::new()
function Assert-Result {
    param([string] $Name, [bool] $Passed)
    $assertions.Add([pscustomobject]@{
        Name = $Name
        Passed = $Passed
    })
    if (-not $Passed) { throw "Assertion failed: $Name" }
}

try {
    $a = @(
        & $publisher `
            -SourceRoot $repository `
            -PublicationRoot $publicationRoot `
            -PublishedAtUtc (
                [DateTimeOffset]'2026-07-30T01:00:00Z')
    ) -join [Environment]::NewLine | ConvertFrom-Json
    $aShell = Get-Content -LiteralPath (
        Join-Path $a.BuildPath 'index.html') -Raw
    $aManifest = Get-Content -LiteralPath (
        Join-Path $a.BuildPath 'asset-manifest.json') -Raw |
        ConvertFrom-Json

    $b = @(
        & $publisher `
            -SourceRoot $repository `
            -PublicationRoot $publicationRoot `
            -PublishedAtUtc (
                [DateTimeOffset]'2026-07-30T01:00:01Z')
    ) -join [Environment]::NewLine | ConvertFrom-Json
    $bShell = Get-Content -LiteralPath (
        Join-Path $b.BuildPath 'index.html') -Raw
    $current = Get-Content -LiteralPath (
        Join-Path $publicationRoot 'current-release.json') -Raw |
        ConvertFrom-Json
    $previous = Get-Content -LiteralPath (
        Join-Path $publicationRoot 'previous-release.json') -Raw |
        ConvertFrom-Json

    Assert-Result 'Unique build IDs' ($a.FrontendBuildId -cne $b.FrontendBuildId)
    Assert-Result 'Build A shell embeds A' (
        $aShell.Contains($a.FrontendBuildId))
    Assert-Result 'Build B shell embeds B' (
        $bShell.Contains($b.FrontendBuildId))
    Assert-Result 'Build B shell excludes A' (
        -not $bShell.Contains($a.FrontendBuildId))
    Assert-Result 'Build diagnostic injected exactly once' (
        ([regex]::Matches(
            $bShell,
            'name="dle-frontend-build-id"')).Count -eq 1)
    Assert-Result 'Main initialization script remains intact' (
        $bShell.Contains('async function initializeDleWorkCenter()') -and
        $bShell.Contains(
            'initializeDleWorkCenter().catch(error => {'))
    Assert-Result 'No stable SRC script URLs' (
        $bShell -notmatch '(src|href)=["'']SRC/')
    Assert-Result 'No stable ASSETS URLs' (
        $bShell -notmatch '(src|href)=["'']ASSETS/')
    Assert-Result 'No manual version query remains' (
        $bShell -notmatch '\?v=[0-9]{8}-[0-9]{2}')
    Assert-Result 'Current pointer is build B' (
        $current.BuildId -ceq $b.FrontendBuildId)
    Assert-Result 'Previous pointer is build A' (
        $previous.BuildId -ceq $a.FrontendBuildId)
    Assert-Result 'Both complete builds retained' (
        (Test-Path -LiteralPath $a.BuildPath -PathType Container) -and
        (Test-Path -LiteralPath $b.BuildPath -PathType Container))
    Assert-Result 'Manifest has assets' (
        $aManifest.AssetCount -gt 0 -and
        $aManifest.Assets.Count -eq $aManifest.AssetCount)

    $rollbackA = @(
        & $rollback -PublicationRoot $publicationRoot
    ) -join [Environment]::NewLine | ConvertFrom-Json
    Assert-Result 'Rollback activates complete build A' (
        $rollbackA.ActiveBuildId -ceq $a.FrontendBuildId)
    $rollbackB = @(
        & $rollback -PublicationRoot $publicationRoot
    ) -join [Environment]::NewLine | ConvertFrom-Json
    Assert-Result 'Roll-forward restores complete build B' (
        $rollbackB.ActiveBuildId -ceq $b.FrontendBuildId)

    $result = [ordered]@{
        Verdict = 'PASS'
        AssertionsPassed = $assertions.Count
        BuildA = $a
        BuildB = $b
        Rollback = $rollbackA
        RollForward = $rollbackB
        Assertions = @($assertions)
    }
    [IO.File]::WriteAllText(
        $artifact,
        ($result | ConvertTo-Json -Depth 8) + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
    $result | ConvertTo-Json -Depth 8
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        $resolved = (Resolve-Path -LiteralPath $tempRoot).Path
        $tempBase = [IO.Path]::GetFullPath(
            [IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not $resolved.StartsWith(
            $tempBase,
            [StringComparison]::OrdinalIgnoreCase)) {
            throw "Unsafe qualification cleanup path: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
