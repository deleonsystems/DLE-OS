[CmdletBinding()]
param(
    [string] $SourceRoot =
        'C:\DLE-OS\Repositories\DLE-OS',
    [string] $PublicationRoot =
        'C:\ProgramData\DLE-OS\Frontend',
    [DateTimeOffset] $PublishedAtUtc =
        [DateTimeOffset]::UtcNow,
    [switch] $DoNotPromote
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$entryFile = Join-Path $SourceRoot 'DLE_Work_Center_v4.0.0.html'
$sourceDirectories = @('SRC', 'ASSETS')
if (-not (Test-Path -LiteralPath $entryFile -PathType Leaf)) {
    throw "Frontend entry file is absent: $entryFile"
}
foreach ($directory in $sourceDirectories) {
    if (-not (
        Test-Path -LiteralPath (
            Join-Path $SourceRoot $directory) -PathType Container
    )) {
        throw "Frontend source directory is absent: $directory"
    }
}

function Get-RelativePath {
    param([string] $Root, [string] $Path)
    $Path.Substring($Root.Length).TrimStart('\')
}

function Get-ManifestMaterial {
    param([object[]] $Rows)
    ($Rows |
        Sort-Object Path |
        ForEach-Object {
            "$($_.Path)`0$($_.Length)`0$($_.Sha256)"
        }) -join "`n"
}

function Get-Sha256Text {
    param([string] $Text)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        ([BitConverter]::ToString(
            $algorithm.ComputeHash($bytes))).Replace('-', '')
    }
    finally {
        $algorithm.Dispose()
    }
}

$sourceFiles = @(
    Get-Item -LiteralPath $entryFile
    foreach ($directory in $sourceDirectories) {
        Get-ChildItem `
            -LiteralPath (Join-Path $SourceRoot $directory) `
            -Recurse -File
    }
)
$sourceRows = foreach ($file in $sourceFiles) {
    [pscustomobject]@{
        Path = Get-RelativePath $SourceRoot $file.FullName
        Length = [long]$file.Length
        Sha256 = (
            Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
        ).Hash
    }
}
$sourceHash = Get-Sha256Text (Get-ManifestMaterial $sourceRows)
$publishedAt = $PublishedAtUtc.ToUniversalTime()
$buildId =
    $publishedAt.ToString('yyyyMMddTHHmmssZ') +
    '-' +
    $sourceHash.Substring(0, 12)

$buildsRoot = Join-Path $PublicationRoot 'Builds'
$finalBuild = Join-Path $buildsRoot $buildId
$stageRoot = Join-Path $PublicationRoot (
    '.build-' + $buildId + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$textExtensions = @(
    '.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg', '.txt'
)
function Convert-FrontendText {
    param([string] $Text)
    $result = $Text
    foreach ($quote in @('"', "'")) {
        $result = $result.Replace(
            "${quote}SRC/",
            "${quote}/assets/$buildId/SRC/")
        $result = $result.Replace(
            "${quote}ASSETS/",
            "${quote}/assets/$buildId/ASSETS/")
    }
    $result = [regex]::Replace(
        $result,
        '\?v=[0-9]{8}-[0-9]{2}',
        '')
    return $result
}

try {
    foreach ($file in $sourceFiles) {
        $relative = Get-RelativePath $SourceRoot $file.FullName
        $targetRelative =
            if ($relative -eq 'DLE_Work_Center_v4.0.0.html') {
                'index.html'
            } else {
                $relative
            }
        $target = Join-Path $stageRoot $targetRelative
        $targetDirectory = Split-Path -Parent $target
        New-Item -ItemType Directory -Path $targetDirectory -Force |
            Out-Null

        if ($file.Extension.ToLowerInvariant() -in $textExtensions) {
            $text = Convert-FrontendText (
                [IO.File]::ReadAllText($file.FullName))
            if ($targetRelative -eq 'index.html') {
                $diagnostic = @"
  <meta name="dle-frontend-build-id" content="$buildId">
  <meta name="dle-frontend-published-at" content="$($publishedAt.ToString('O'))">
  <script>
    (() => {
      "use strict";
      const build = Object.freeze({
        frontendBuildId: "$buildId",
        loadedFrontendBuildId: "$buildId",
        publishedAtUtc: "$($publishedAt.ToString('O'))"
      });
      window.DLEFrontendBuild = build;
      window.checkDleFrontendBuild = async function checkDleFrontendBuild() {
        const response = await fetch("/api/frontend/v1/build", {
          cache: "no-store",
          headers: { "Accept": "application/json" }
        });
        if (!response.ok) {
          throw new Error("Frontend build diagnostic request failed.");
        }
        const expected = await response.json();
        const mismatch =
          expected.frontendBuildId !== build.loadedFrontendBuildId;
        if (mismatch) {
          const recoveryKey =
            "dle-build-recovery:" + expected.frontendBuildId;
          if (sessionStorage.getItem(recoveryKey) !== "attempted") {
            sessionStorage.setItem(recoveryKey, "attempted");
            location.replace("/");
            return { mismatch: true, recoveryStarted: true, expected };
          }
          window.DLEFrontendBuildMismatch = Object.freeze({
            expectedFrontendBuildId: expected.frontendBuildId,
            loadedFrontendBuildId: build.loadedFrontendBuildId
          });
          document.dispatchEvent(new CustomEvent(
            "dle:frontend-build-mismatch",
            { detail: window.DLEFrontendBuildMismatch }));
        }
        return { mismatch, recoveryStarted: false, expected };
      };
    })();
  </script>
"@
                $headIndex = $text.IndexOf(
                    '<head>',
                    [StringComparison]::OrdinalIgnoreCase)
                if ($headIndex -lt 0) {
                    throw 'Frontend entry file does not contain <head>.'
                }
                $text = $text.Insert(
                    $headIndex + '<head>'.Length,
                    "`r`n$diagnostic")
                if (
                    ([regex]::Matches(
                        $text,
                        'name="dle-frontend-build-id"')).Count -ne 1
                ) {
                    throw 'Frontend build diagnostic was not injected exactly once.'
                }
            }
            [IO.File]::WriteAllText(
                $target,
                $text,
                [Text.UTF8Encoding]::new($false))
        }
        else {
            Copy-Item -LiteralPath $file.FullName -Destination $target
        }
    }

    $assetRows = Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
        Sort-Object FullName |
        ForEach-Object {
            [pscustomobject]@{
                Path = Get-RelativePath $stageRoot $_.FullName
                Length = [long]$_.Length
                Sha256 = (
                    Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
                ).Hash
            }
        }
    $assetManifest = [ordered]@{
        FrontendBuildId = $buildId
        PublishedAtUtc = $publishedAt.ToString('O')
        SourceManifestSha256 = $sourceHash
        AssetCount = $assetRows.Count
        Assets = @($assetRows)
    }
    $assetManifestPath = Join-Path $stageRoot 'asset-manifest.json'
    [IO.File]::WriteAllText(
        $assetManifestPath,
        ($assetManifest | ConvertTo-Json -Depth 8) +
            [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
    $manifestHash = (
        Get-FileHash -LiteralPath $assetManifestPath -Algorithm SHA256
    ).Hash

    if (Test-Path -LiteralPath $finalBuild) {
        $existingHash = (
            Get-FileHash `
                -LiteralPath (
                    Join-Path $finalBuild 'asset-manifest.json') `
                -Algorithm SHA256
        ).Hash
        if ($existingHash -ne $manifestHash) {
            throw 'Frontend build ID collision with different content.'
        }
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
    else {
        New-Item -ItemType Directory -Path $buildsRoot -Force |
            Out-Null
        Move-Item -LiteralPath $stageRoot -Destination $finalBuild
    }

    $release = [ordered]@{
        BuildId = $buildId
        PublishedAtUtc = $publishedAt.ToString('O')
        ManifestSha256 = $manifestHash
    }

    if (-not $DoNotPromote) {
        $currentPath = Join-Path $PublicationRoot 'current-release.json'
        $previousPath = Join-Path $PublicationRoot 'previous-release.json'
        if (Test-Path -LiteralPath $currentPath -PathType Leaf) {
            Copy-Item `
                -LiteralPath $currentPath `
                -Destination $previousPath `
                -Force
        }
        $stagePointer = Join-Path $PublicationRoot (
            '.current-release.' + [Guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText(
            $stagePointer,
            ($release | ConvertTo-Json -Depth 4) +
                [Environment]::NewLine,
            [Text.UTF8Encoding]::new($false))
        Move-Item `
            -LiteralPath $stagePointer `
            -Destination $currentPath `
            -Force
    }

    [pscustomobject]@{
        Verdict = 'PASS'
        FrontendBuildId = $buildId
        PublishedAtUtc = $publishedAt.ToString('O')
        SourceManifestSha256 = $sourceHash
        AssetManifestSha256 = $manifestHash
        AssetCount = $assetRows.Count
        BuildPath = $finalBuild
        Promoted = -not $DoNotPromote
    } | ConvertTo-Json -Depth 5
}
catch {
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
    throw
}
