Set-StrictMode -Version Latest

function Get-DleOsNormalizedAccountName {
    param(
        [Parameter(Mandatory)][string]$AccountName,
        [string]$ComputerName = $env:COMPUTERNAME
    )
    $value = $AccountName.Trim()
    if ($value.StartsWith('.\', [StringComparison]::Ordinal)) {
        return "$ComputerName\$($value.Substring(2))"
    }
    $value
}

function Get-DleOsAccountSid {
    param(
        [Parameter(Mandatory)][string]$AccountName,
        [string]$ComputerName = $env:COMPUTERNAME
    )
    $qualified = Get-DleOsNormalizedAccountName $AccountName $ComputerName
    ([Security.Principal.NTAccount]::new($qualified)).Translate(
        [Security.Principal.SecurityIdentifier]).Value
}

function Get-DleOsHttpPrefixDisplayForms {
    param([Parameter(Mandatory)][string]$Prefix)
    $forms = [Collections.Generic.List[string]]::new()
    $forms.Add($Prefix.ToUpperInvariant())
    if ($Prefix -match '^(?<scheme>https?)://(?<host>(?:\d{1,3}\.){3}\d{1,3}):(?<port>\d+)/$') {
        $forms.Add(('{0}://{1}:{2}:{1}/' -f
            $Matches.scheme, $Matches.host, $Matches.port).ToUpperInvariant())
    }
    @($forms | Select-Object -Unique)
}

function Assert-DleOsDevelopmentFrontendConfiguration {
    param([Parameter(Mandatory)][string]$ConfigurationPath)
    $config = Get-Content -LiteralPath $ConfigurationPath -Raw | ConvertFrom-Json
    if ($config.environment -ne 'Development' -or
        $config.runtimeMarker -ne 'ISOLATED_DEVELOPMENT' -or
        $config.applicationOrigin -ne 'https://dev.dle-os.internal.dlemfg.com' -or
        $config.securityDatabase -ne 'DLE_OS_SECURITY_DEV' -or
        $config.frontendContentRoot -ne '__RELEASE_FRONTEND_CONTENT_ROOT__' -or
        $config.PSObject.Properties.Name -contains 'repositoryRoot' -or
        $config.canonicalApiBaseUrl -notmatch ':5052$' -or
        $config.operationalApiBaseUrl -notmatch ':5054$' -or
        $config.syncOperationsApiBaseUrl -notmatch ':5056$' -or
        $config.governedRefreshApiBaseUrl -notmatch ':5057$') {
        throw 'The frontend configuration is not the approved isolated DEV target.'
    }
    $config
}

function Get-DleOsFrontendRelativePath {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Path
    )
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $rootPrefix = $resolvedRoot + [IO.Path]::DirectorySeparatorChar
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    if (-not $resolvedPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Frontend path escapes its root: $Path"
    }
    $resolvedPath.Substring($rootPrefix.Length).Replace('\', '/')
}

function Get-DleOsFrontendFileRows {
    param(
        [Parameter(Mandatory)][string]$Root,
        [switch]$StrictRoot
    )
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
        throw "Frontend content root is absent: $resolvedRoot"
    }
    $entry = Join-Path $resolvedRoot 'DLE_Work_Center_v4.0.0.html'
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
        throw "Frontend shell is absent: $entry"
    }
    foreach ($directoryName in 'SRC','ASSETS') {
        $directory = Join-Path $resolvedRoot $directoryName
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            throw "Frontend source directory is absent: $directoryName"
        }
    }
    if ($StrictRoot) {
        $unexpected = @(Get-ChildItem -LiteralPath $resolvedRoot -Force | Where-Object {
            $_.Name -notin 'DLE_Work_Center_v4.0.0.html','SRC','ASSETS'
        })
        if ($unexpected.Count -gt 0) {
            throw "Frontend content root contains unexpected entries: $($unexpected.Name -join ', ')"
        }
    }
    $items = @(
        Get-Item -LiteralPath $resolvedRoot
        Get-Item -LiteralPath $entry
        foreach ($directoryName in 'SRC','ASSETS') {
            $directory = Join-Path $resolvedRoot $directoryName
            Get-ChildItem -LiteralPath $directory -Force -Recurse
        }
    )
    $reparsePoints = @($items | Where-Object {
        ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    })
    if ($reparsePoints.Count -gt 0) {
        throw "Frontend source contains a reparse point: $($reparsePoints[0].FullName)"
    }
    @($items | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
        [pscustomobject]@{
            RelativePath = Get-DleOsFrontendRelativePath $resolvedRoot $_.FullName
            Length = [long]$_.Length
            Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    } | Sort-Object RelativePath)
}

function Get-DleOsFrontendManifestMaterial {
    param([Parameter(Mandatory)][object[]]$Rows)
    (@($Rows) | ForEach-Object {
        $relative = if ($_.PSObject.Properties.Name -contains 'RelativePath') {
            [string]$_.RelativePath
        } else { [string]$_.Path }
        [pscustomobject]@{RelativePath=$relative;Length=$_.Length;Sha256=$_.Sha256}
    } | Sort-Object RelativePath | ForEach-Object {
        "$($_.RelativePath)`0$($_.Length)`0$($_.Sha256.ToUpperInvariant())"
    }) -join "`n"
}

function New-DleOsFrontendSnapshot {
    param(
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$DestinationRoot,
        [Parameter(Mandatory)][string]$ManifestPath,
        [Parameter(Mandatory)][string]$ReleaseId,
        [Parameter(Mandatory)][string]$SourceGitHead
    )
    if ($ReleaseId -notmatch '^\d{8}T\d{6}Z$' -or
        $SourceGitHead -notmatch '^[0-9a-fA-F]{40,64}$') {
        throw 'Frontend snapshot release or Git identity is invalid.'
    }
    $resolvedSource = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\', '/')
    $resolvedDestination = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd('\', '/')
    if (Test-Path -LiteralPath $resolvedDestination) {
        throw "Frontend snapshot destination already exists: $resolvedDestination"
    }
    $sourceRows = @(Get-DleOsFrontendFileRows $resolvedSource)
    New-Item -ItemType Directory -Path $resolvedDestination -Force | Out-Null
    foreach ($row in $sourceRows) {
        $sourcePath = Join-Path $resolvedSource $row.RelativePath
        $targetPath = Join-Path $resolvedDestination $row.RelativePath
        $targetDirectory = Split-Path -Parent $targetPath
        New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath
    }
    $destinationRows = @(Get-DleOsFrontendFileRows $resolvedDestination -StrictRoot)
    if ((Get-DleOsFrontendManifestMaterial $sourceRows) -cne
        (Get-DleOsFrontendManifestMaterial $destinationRows)) {
        throw 'The immutable frontend snapshot differs from its source.'
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        releaseId = $ReleaseId
        gitHead = $SourceGitHead.ToLowerInvariant()
        createdAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
        fileCount = $destinationRows.Count
        files = $destinationRows
    }
    $resolvedManifest = [IO.Path]::GetFullPath($ManifestPath)
    if ([IO.Path]::GetDirectoryName($resolvedManifest) -ine
        [IO.Path]::GetDirectoryName($resolvedDestination)) {
        throw 'Frontend manifest must be adjacent to its frontend directory.'
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedManifest -Encoding utf8
    $manifestHash = (Get-FileHash -LiteralPath $resolvedManifest -Algorithm SHA256).Hash
    $validated = Assert-DleOsFrontendSnapshot -ContentRoot $resolvedDestination `
        -ManifestPath $resolvedManifest -ExpectedManifestSha256 $manifestHash `
        -ExpectedFileCount $destinationRows.Count -ExpectedReleaseId $ReleaseId `
        -ExpectedSourceGitHead $SourceGitHead
    [pscustomobject]@{
        ContentRoot = $resolvedDestination
        ManifestPath = $resolvedManifest
        ManifestSha256 = $manifestHash
        FileCount = $validated.FileCount
        SourceDigestSha256 = Get-DleOsSha256Text (Get-DleOsFrontendManifestMaterial $destinationRows)
    }
}

function Assert-DleOsFrontendSnapshot {
    param(
        [Parameter(Mandatory)][string]$ContentRoot,
        [Parameter(Mandatory)][string]$ManifestPath,
        [Parameter(Mandatory)][string]$ExpectedManifestSha256,
        [Parameter(Mandatory)][int]$ExpectedFileCount,
        [Parameter(Mandatory)][string]$ExpectedReleaseId,
        [Parameter(Mandatory)][string]$ExpectedSourceGitHead
    )
    $resolvedRoot = [IO.Path]::GetFullPath($ContentRoot).TrimEnd('\', '/')
    $resolvedManifest = [IO.Path]::GetFullPath($ManifestPath)
    if ([IO.Path]::GetDirectoryName($resolvedManifest) -ine
        [IO.Path]::GetDirectoryName($resolvedRoot)) {
        throw 'The immutable frontend manifest is not adjacent to its content root.'
    }
    if (-not (Test-Path -LiteralPath $resolvedManifest -PathType Leaf)) {
        throw 'The immutable frontend manifest is absent.'
    }
    $manifestHash = (Get-FileHash -LiteralPath $resolvedManifest -Algorithm SHA256).Hash
    if ($ExpectedManifestSha256 -notmatch '^[0-9A-Fa-f]{64}$' -or
        $manifestHash -ine $ExpectedManifestSha256) {
        throw 'The immutable frontend manifest hash does not match.'
    }
    $manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.releaseId -ne $ExpectedReleaseId -or
        $manifest.gitHead -ine $ExpectedSourceGitHead -or
        [int]$manifest.fileCount -ne $ExpectedFileCount) {
        throw 'The immutable frontend manifest identity does not match its release.'
    }
    $rows = @($manifest.files)
    if ($rows.Count -ne $ExpectedFileCount) {
        throw 'The immutable frontend manifest file count is inconsistent.'
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $rootPrefix = $resolvedRoot + [IO.Path]::DirectorySeparatorChar
    foreach ($row in $rows) {
        $relative = if ($row.PSObject.Properties.Name -contains 'RelativePath') {
            [string]$row.RelativePath
        } else { [string]$row.Path }
        $segments = @($relative.Split('/'))
        $allowed = $relative -eq 'DLE_Work_Center_v4.0.0.html' -or
            $relative.StartsWith('SRC/', [StringComparison]::Ordinal) -or
            $relative.StartsWith('ASSETS/', [StringComparison]::Ordinal)
        if ([string]::IsNullOrWhiteSpace($relative) -or
            $relative.Contains('\') -or $relative.Contains(':') -or
            [IO.Path]::IsPathRooted($relative) -or
            @($segments | Where-Object { $_ -in '', '.', '..' }).Count -gt 0 -or
            -not $allowed -or -not $seen.Add($relative)) {
            throw "The immutable frontend manifest contains an unsafe path: $relative"
        }
        $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $relative))
        if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "The immutable frontend manifest path is absent or escapes its root: $relative"
        }
        $item = Get-Item -LiteralPath $candidate
        $hash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
        if ([long]$row.Length -ne [long]$item.Length -or [string]$row.Sha256 -ine $hash) {
            throw "The immutable frontend file failed validation: $relative"
        }
    }
    $actualRows = @(Get-DleOsFrontendFileRows $resolvedRoot -StrictRoot)
    if ($actualRows.Count -ne $ExpectedFileCount -or
        (Get-DleOsFrontendManifestMaterial $actualRows) -cne
        (Get-DleOsFrontendManifestMaterial $rows)) {
        throw 'The immutable frontend tree contains missing, changed, or unmanifested files.'
    }
    [pscustomobject]@{
        ContentRoot = $resolvedRoot
        ManifestPath = $resolvedManifest
        ManifestSha256 = $manifestHash
        FileCount = $actualRows.Count
        ReleaseId = [string]$manifest.releaseId
        SourceGitHead = [string]$manifest.gitHead
    }
}

function Get-DleOsSha256Text {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    }
    finally {
        $sha.Dispose()
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

function Get-DleOsDeterministicFileSetDigest {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string[]]$RelativePaths
    )
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $rootPrefix = $resolvedRoot + [IO.Path]::DirectorySeparatorChar
    $paths = [Collections.Generic.List[string]]::new()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($candidate in $RelativePaths) {
        $relative = ([string]$candidate).Replace('\', '/').TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($relative) -or -not $seen.Add($relative)) { continue }
        $fullPath = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $relative))
        if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Digest input escapes its root: $relative"
        }
        $paths.Add($relative)
    }
    $paths.Sort([StringComparer]::Ordinal)
    $records = [Text.StringBuilder]::new()
    foreach ($relative in $paths) {
        $fullPath = Join-Path $resolvedRoot $relative
        $contentHash = if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
        } else { 'MISSING' }
        [void]$records.Append($relative).Append([char]0).Append($contentHash).Append("`n")
    }
    [pscustomobject]@{
        DigestSha256 = Get-DleOsSha256Text $records.ToString()
        FileCount = $paths.Count
    }
}

function Get-DleOsDevelopmentFrontendSourceIdentity {
    param([Parameter(Mandatory)][string]$Repository)
    $repositoryPath = [IO.Path]::GetFullPath($Repository)
    $safeRepository = $repositoryPath.Replace('\', '/')
    $scopes = @(
        'DLE_Work_Center_v4.0.0.html',
        'ASSETS',
        'SRC',
        'Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend',
        'Tools/SecurityFoundation/DleOs.Security',
        'Tools/TrustedIdentity/DleOs.TrustedIdentity'
    )
    $gitBase = @('-c', "safe.directory=$safeRepository", '-C', $repositoryPath)
    $headOutput = @(& git.exe @gitBase rev-parse HEAD 2>&1)
    $headExitCode = $LASTEXITCODE
    $head = $headOutput | Select-Object -First 1
    if ($headExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($head)) {
        throw "Unable to determine the frontend source Git HEAD (exit $headExitCode): $($headOutput -join ' ')"
    }
    $tracked = @(& git.exe @gitBase ls-files -- @scopes 2>&1)
    $trackedExitCode = $LASTEXITCODE
    if ($trackedExitCode -ne 0) { throw "Unable to enumerate tracked frontend source inputs: $($tracked -join ' ')" }
    $untracked = @(& git.exe @gitBase ls-files --others --exclude-standard -- @scopes 2>&1)
    $untrackedExitCode = $LASTEXITCODE
    if ($untrackedExitCode -ne 0) { throw "Unable to enumerate untracked frontend source inputs: $($untracked -join ' ')" }
    $status = @(& git.exe @gitBase status --porcelain=v1 --untracked-files=all -- @scopes 2>&1)
    $statusExitCode = $LASTEXITCODE
    if ($statusExitCode -ne 0) { throw "Unable to determine frontend source dirty state: $($status -join ' ')" }
    $digest = Get-DleOsDeterministicFileSetDigest -Root $repositoryPath `
        -RelativePaths @($tracked + $untracked)
    [pscustomobject]@{
        GitHead = ([string]$head).Trim()
        SourceDirty = $status.Count -gt 0
        SourceDigestSha256 = $digest.DigestSha256
        SourceFileCount = $digest.FileCount
        StatusEntries = $status
    }
}
