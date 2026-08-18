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
        $config.canonicalApiBaseUrl -notmatch ':5052$' -or
        $config.operationalApiBaseUrl -notmatch ':5054$') {
        throw 'The frontend configuration is not the approved isolated DEV target.'
    }
    $config
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
        'ASSETS/ICONS',
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
