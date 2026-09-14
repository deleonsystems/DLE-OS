function Get-DleOsSimTestStateFingerprint {
    param([string] $Repository)
    $state = Join-Path $Repository '.sim-state'
    if (-not (Test-Path -LiteralPath $state)) { return 'ABSENT' }
    $rows = @(Get-ChildItem -LiteralPath $state -Recurse -File | Sort-Object FullName | ForEach-Object {
        [IO.Path]::GetRelativePath($state, $_.FullName) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    })
    return ($rows -join "`n")
}

function Invoke-DleOsSimTestIsolation {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string] $ScriptPath, [System.Collections.IDictionary] $Parameters = @{})
    $ErrorActionPreference = 'Stop'
    $repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $pool = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'DleOsSimTests'))
    $markerPath = Join-Path $repository '.sim-test-isolation.json'
    if ($env:DLE_OS_SIM_TEST_REPOSITORY) {
        if (-not (Test-Path -LiteralPath $markerPath)) { throw 'SIM test isolation marker missing; refusing to run.' }
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ($repository -ne $env:DLE_OS_SIM_TEST_REPOSITORY -or $marker.repository -ne $repository -or
            -not $marker.source -or -not [IO.Path]::IsPathFullyQualified([string]$marker.source) -or
            $marker.source -eq $repository -or
            $repository.StartsWith($marker.source + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            -not $repository.StartsWith($pool + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'SIM test root is not an isolated repository; refusing to run.'
        }
        $cursor = Get-Item -LiteralPath $repository
        while ($cursor) {
            if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'SIM test root contains a reparse point.' }
            $cursor = $cursor.Parent
        }
        Write-Host "SIM TEST STATE: $(Join-Path $repository '.sim-state')"
        return $false
    }
    if (Test-Path -LiteralPath $markerPath) { throw 'Isolated test copy must be launched by its parent runner.' }
    $before = Get-DleOsSimTestStateFingerprint $repository
    $destination = Join-Path $pool (([guid]::NewGuid().ToString('N')) + '/repo')
    if ($destination.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporary test repository must be outside the developer repository.'
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $files = @(& git -C $repository ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inventory source for isolated tests.' }
    foreach ($relative in ($files | Sort-Object -Unique)) {
        if ($relative -match '^(\.git|\.sim-state|\.tmp)(/|\\|$)') { continue }
        $source = Join-Path $repository $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
        if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Source reparse points are not supported in test copies.' }
        $target = [IO.Path]::GetFullPath((Join-Path $destination $relative))
        if (-not $target.StartsWith($destination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test source path.' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target
    }
    & git -C $destination init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Cannot initialize disposable test repository.' }
    @{ repository = $destination; source = $repository } | ConvertTo-Json | Set-Content (Join-Path $destination '.sim-test-isolation.json')
    $relativeScript = [IO.Path]::GetRelativePath($repository, $ScriptPath)
    $previous = $env:DLE_OS_SIM_TEST_REPOSITORY
    try {
        $env:DLE_OS_SIM_TEST_REPOSITORY = $destination
        $arguments = @('-NoProfile', '-File', (Join-Path $destination $relativeScript))
        foreach ($key in $Parameters.Keys) { $arguments += '-' + $key; $arguments += [string]$Parameters[$key] }
        Write-Host "SIM TEST COPY: $destination (active state is excluded; copy retained for diagnostics)"
        Push-Location $destination
        try { & (Join-Path $PSHOME 'pwsh.exe') @arguments | ForEach-Object { Write-Host $_ }; $result = $LASTEXITCODE }
        finally { Pop-Location }
    }
    finally {
        $env:DLE_OS_SIM_TEST_REPOSITORY = $previous
        if ((Get-DleOsSimTestStateFingerprint $repository) -cne $before) {
            throw 'Active developer SIM state changed during qualification. Do not checkpoint.'
        }
    }
    if ($result -ne 0) { throw "Isolated SIM qualification failed with exit code $result. Evidence: $destination" }
    Write-Host 'PASS: active developer SIM state remained byte-for-byte unchanged.'
    return $true
}
