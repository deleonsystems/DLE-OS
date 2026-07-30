[CmdletBinding()]
param(
    [string] $PublicationRoot =
        'C:\ProgramData\DLE-OS\Frontend'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$currentPath = Join-Path $PublicationRoot 'current-release.json'
$previousPath = Join-Path $PublicationRoot 'previous-release.json'
if (-not (Test-Path -LiteralPath $previousPath -PathType Leaf)) {
    throw 'No previous frontend release pointer is available.'
}

$current = Get-Content -LiteralPath $currentPath -Raw
$previous = Get-Content -LiteralPath $previousPath -Raw |
    ConvertFrom-Json
$previousBuild = Join-Path (
    Join-Path $PublicationRoot 'Builds') $previous.BuildId
if (-not (
    Test-Path -LiteralPath (
        Join-Path $previousBuild 'index.html') -PathType Leaf
) -or -not (
    Test-Path -LiteralPath (
        Join-Path $previousBuild 'asset-manifest.json') -PathType Leaf
)) {
    throw 'Previous frontend release is incomplete; rollback refused.'
}

$stageCurrent = Join-Path $PublicationRoot (
    '.rollback-current.' + [Guid]::NewGuid().ToString('N'))
$stagePrevious = Join-Path $PublicationRoot (
    '.rollback-previous.' + [Guid]::NewGuid().ToString('N'))
[IO.File]::WriteAllText(
    $stageCurrent,
    (Get-Content -LiteralPath $previousPath -Raw),
    [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText(
    $stagePrevious,
    $current,
    [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $stageCurrent -Destination $currentPath -Force
Move-Item -LiteralPath $stagePrevious -Destination $previousPath -Force

[pscustomobject]@{
    Verdict = 'PASS'
    ActiveBuildId = [string]$previous.BuildId
    RollbackWasAtomic = $true
} | ConvertTo-Json
