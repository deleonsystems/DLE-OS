[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedIdentity = 'DLE-OS-HOST\DLE-OS-DEV-CONTROL'
$expectedReleaseRoot = 'C:\DLE-OS\Development\OperationalControlHost5054\Releases'
$expectedExecutable = 'DleOs.DevOperationalControlHost.exe'
$expectedPublicKey = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'
$expectedDataRoot = 'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data'
$expectedCanonicalEndpoint = 'http://DLE-OS-HOST:5052'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not [string]::Equals($identity, $expectedIdentity, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The DEV 5054 launcher requires the exact runtime identity $expectedIdentity."
}

$releasePath = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$releaseParent = [IO.Path]::GetFullPath((Split-Path -Parent $releasePath)).TrimEnd('\')
$releaseId = Split-Path -Leaf $releasePath
if (-not [string]::Equals($releaseParent, $expectedReleaseRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $releaseId -notmatch '^dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$') {
    throw 'The launcher is outside a versioned governed DEV 5054 release directory.'
}

$governedRoot = Split-Path -Parent $expectedReleaseRoot
$manifestPath = Join-Path (Join-Path $governedRoot 'Manifests') ($releaseId + '.json')
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The detached governed release manifest is absent.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.releaseId -ne $releaseId -or
    $manifest.projectIdentity -ne 'DleOs.DevOperationalControlHost' -or
    $manifest.runtimeConfigurationSchema -ne 'DLE_OS_DEV_5054_V1' -or
    $manifest.expectedListener -ne 'http://dle-os-host:5054' -or
    $manifest.operationalDatabase -ne 'DLE_OS_OPERATIONAL_DEV' -or
    $manifest.securityDatabase -ne 'DLE_OS_SECURITY_DEV' -or
    $manifest.canonicalReadEndpoint -ne $expectedCanonicalEndpoint -or
    $manifest.expectedServiceIdentity -ne $expectedIdentity -or
    $manifest.rollbackEligibility -ne 'CANDIDATE_NOT_YET_RUNTIME_QUALIFIED') {
    throw 'The release manifest does not match the fixed DEV-only boundary.'
}

$actualFiles = @(Get-ChildItem -LiteralPath $releasePath -File -Recurse -Force)
if (@(Get-ChildItem -LiteralPath $releasePath -Recurse -Force |
        Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) {
    throw 'Reparse points are forbidden inside a governed DEV release.'
}
if ($actualFiles.Count -ne @($manifest.files).Count) {
    throw 'The governed release inventory count does not match its manifest.'
}
foreach ($entry in $manifest.files) {
    $candidate = [IO.Path]::GetFullPath((Join-Path $releasePath $entry.relativePath))
    if (-not $candidate.StartsWith($releasePath + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "A manifested release path is invalid: $($entry.relativePath)"
    }
    $file = Get-Item -LiteralPath $candidate
    $hash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
    if ($file.Length -ne [int64]$entry.length -or $hash -ne $entry.sha256) {
        throw "Release integrity validation failed: $($entry.relativePath)"
    }
}

if (-not (Test-Path -LiteralPath $expectedPublicKey -PathType Leaf)) {
    throw 'The DEV assertion validator public key is absent.'
}
if (-not (Test-Path -LiteralPath $expectedDataRoot -PathType Container)) {
    throw 'The governed DEV data root is absent.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue) {
    throw 'Port 5054 is already owned; the launcher will not start another runtime.'
}
$dependency = Invoke-RestMethod -Uri ($expectedCanonicalEndpoint + '/api/development/v1/security') -TimeoutSec 10
if ($dependency.verdict -ne 'PASS' -or $dependency.insert.result -ne 'DENIED' -or
    $dependency.update.result -ne 'DENIED' -or $dependency.delete.result -ne 'DENIED') {
    throw 'The 5052 canonical-read dependency is not at its qualified read-only boundary.'
}

$env:DLE_OS_CONTROL_PREFIX = 'http://dle-os-host:5054'
$env:DLE_OS_OPERATIONAL_DATABASE = 'DLE_OS_OPERATIONAL_DEV'
$env:DLE_OS_SECURITY_DATABASE = 'DLE_OS_SECURITY_DEV'
$env:DLE_OS_CANONICAL_API_BASE_URL = $expectedCanonicalEndpoint
$env:DLE_OS_DEV_DATA_ROOT = $expectedDataRoot
$env:DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH = $expectedPublicKey

$executable = Join-Path $releasePath $expectedExecutable
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'The manifested DEV operational executable is absent.'
}
& $executable
exit $LASTEXITCODE
