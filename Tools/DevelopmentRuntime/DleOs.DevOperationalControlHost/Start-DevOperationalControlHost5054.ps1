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
$devLogRoot = 'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs'
$maximumLogFileBytes = 10MB
$maximumLogTotalBytes = 128MB
$maximumArchiveFiles = 14
$retentionDays = 14
$script:releaseId = 'UNKNOWN_RELEASE'
$script:sourceIdentity = 'UNKNOWN_SOURCE'

function Protect-LogText([string]$Value,[int]$MaximumLength=2048) {
    if ($null -eq $Value) { return $null }
    $safe = $Value -replace '(?i)(password|passwd|pwd|token|secret|credential|authorization|assertion)\s*[:=]\s*[^\s,;]+','$1=[REDACTED]'
    if ($safe.Length -gt $MaximumLength) { return $safe.Substring(0,$MaximumLength) }
    $safe
}
function Invoke-DevLogRetention {
    try {
        $cutoff=[DateTime]::UtcNow.AddDays(-$retentionDays)
        $archives=@(Get-ChildItem -LiteralPath $devLogRoot -File -Filter 'dev5054-*.jsonl' -ErrorAction SilentlyContinue |
            Where-Object Name -ne 'dev5054-current.jsonl' | Sort-Object LastWriteTimeUtc -Descending)
        foreach($file in @($archives|Where-Object LastWriteTimeUtc -lt $cutoff)){Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue}
        $archives=@(Get-ChildItem -LiteralPath $devLogRoot -File -Filter 'dev5054-*.jsonl' -ErrorAction SilentlyContinue |
            Where-Object Name -ne 'dev5054-current.jsonl' | Sort-Object LastWriteTimeUtc -Descending)
        foreach($file in @($archives|Select-Object -Skip $maximumArchiveFiles)){Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue}
        $files=@(Get-ChildItem -LiteralPath $devLogRoot -File -Filter 'dev5054-*.jsonl' -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending)
        $total=[int64]($files|Measure-Object Length -Sum).Sum
        foreach($file in @($files|Where-Object Name -ne 'dev5054-current.jsonl'|Sort-Object LastWriteTimeUtc)){
            if($total-le$maximumLogTotalBytes){break};$total-=$file.Length;Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}
function Write-DevLauncherEvent([string]$EventName,[string]$Level,[hashtable]$Properties=@{}) {
    try {
        $null=New-Item -ItemType Directory -Path $devLogRoot -Force
        $current=Join-Path $devLogRoot 'dev5054-current.jsonl'
        $safeProperties=[ordered]@{}
        foreach($key in $Properties.Keys){$safeProperties[$key]=if($key-match'(?i)password|passwd|pwd|token|secret|credential|authorization|private.?key|assertion'){'[REDACTED]'}elseif($Properties[$key]-is[string]){Protect-LogText ([string]$Properties[$key])}else{$Properties[$key]}}
        $entry=[ordered]@{timestampUtc=[DateTimeOffset]::UtcNow.ToString('o');level=$Level;category='DleOs.Dev5054.Launcher';eventName=$EventName;releaseId=$(if($script:releaseId){$script:releaseId}else{'UNKNOWN_RELEASE'});sourceIdentity=$(if($script:sourceIdentity){$script:sourceIdentity}else{'UNKNOWN_SOURCE'});processId=$PID;executionIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;properties=$safeProperties}
        $line=($entry|ConvertTo-Json -Compress -Depth 8)+[Environment]::NewLine
        if((Test-Path -LiteralPath $current)-and((Get-Item -LiteralPath $current).Length+[Text.Encoding]::UTF8.GetByteCount($line)-gt$maximumLogFileBytes)){
            $archive=Join-Path $devLogRoot ('dev5054-'+[DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'-'+[guid]::NewGuid().ToString('N')+'.jsonl');Move-Item -LiteralPath $current -Destination $archive
        }
        [IO.File]::AppendAllText($current,$line,[Text.UTF8Encoding]::new($false));Invoke-DevLogRetention
    } catch {}
}

trap {
    Write-DevLauncherEvent 'LauncherFatal' 'Critical' @{classification=$(if($_.Exception.Message-match'5052|canonical-read dependency'){'CANONICAL_5052_DEPENDENCY'}elseif($_.Exception.Message-match'identity|permission|access'){'AUTHENTICATION_OR_PERMISSION'}else{'LAUNCHER_ERROR'});errorSummary=$_.Exception.Message}
    exit 1
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not [string]::Equals($identity, $expectedIdentity, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The DEV 5054 launcher requires the exact runtime identity $expectedIdentity."
}

$releasePath = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$releaseParent = [IO.Path]::GetFullPath((Split-Path -Parent $releasePath)).TrimEnd('\')
$releaseId = Split-Path -Leaf $releasePath
$script:releaseId = $releaseId
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
$script:sourceIdentity = [string]$manifest.sourceCommit
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
Write-DevLauncherEvent 'LauncherStartup' 'Information' @{releasePath=$releasePath;runtimeIdentity=$identity;manifestSha256=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash}
$dependency = Invoke-RestMethod -Uri ($expectedCanonicalEndpoint + '/api/development/v1/security') -TimeoutSec 10
if ($dependency.verdict -ne 'PASS' -or $dependency.insert.result -ne 'DENIED' -or
    $dependency.update.result -ne 'DENIED' -or $dependency.delete.result -ne 'DENIED') {
    throw 'The 5052 canonical-read dependency is not at its qualified read-only boundary.'
}
Write-DevLauncherEvent 'CanonicalDependencyQualified' 'Information' @{endpoint=$expectedCanonicalEndpoint;verdict=[string]$dependency.verdict;insert=[string]$dependency.insert.result;update=[string]$dependency.update.result;delete=[string]$dependency.delete.result}

$env:DLE_OS_CONTROL_PREFIX = 'http://dle-os-host:5054'
$env:DLE_OS_OPERATIONAL_DATABASE = 'DLE_OS_OPERATIONAL_DEV'
$env:DLE_OS_SECURITY_DATABASE = 'DLE_OS_SECURITY_DEV'
$env:DLE_OS_CANONICAL_API_BASE_URL = $expectedCanonicalEndpoint
$env:DLE_OS_DEV_DATA_ROOT = $expectedDataRoot
$env:DLE_OS_IDENTITY_SIGNING_PUBLIC_KEY_PATH = $expectedPublicKey
$env:DLE_OS_RELEASE_ID = $releaseId
$env:DLE_OS_SOURCE_IDENTITY = [string]$manifest.sourceCommit
$env:DLE_OS_DEV_LOG_ROOT = $devLogRoot

$executable = Join-Path $releasePath $expectedExecutable
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'The manifested DEV operational executable is absent.'
}
Write-DevLauncherEvent 'ExecutableStarting' 'Information' @{executable=$expectedExecutable;releaseId=$releaseId}
& $executable
$exitCode=$LASTEXITCODE
Write-DevLauncherEvent 'ExecutableExited' $(if($exitCode-eq 0){'Information'}else{'Error'}) @{exitCode=$exitCode;releaseId=$releaseId}
exit $exitCode
