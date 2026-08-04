[CmdletBinding()]
param(
    [switch] $ElevatedStage,
    [string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$operator = 'DLE-OS-HOST\DLE-OS'
$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$publisher = Join-Path $repository (
    'Tools\PlatformFreshnessCache\Publish-VersionedFrontend.ps1')
$publicationRoot = 'C:\ProgramData\DLE-OS\Frontend'
$artifactRoot = Join-Path $repository (
    'Artifacts\PlatformFreshnessCache001\' +
    'PLATFORMFRESHNESSCACHE001-20260730T010815Z')

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine $operator) {
    throw "Frontend deployment requires $operator; actual identity is $identity."
}

if (-not $ElevatedStage) {
    if (Test-Elevated) {
        throw 'Frontend deployment preparation must start non-elevated.'
    }
    $stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $childEvidence = Join-Path $artifactRoot (
        "FRONTEND_DEPLOYMENT_$stamp.json")
    $child = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', "`"$PSCommandPath`"",
            '-ElevatedStage',
            '-EvidencePath', "`"$childEvidence`""
        ) `
        -Verb RunAs `
        -Wait `
        -PassThru
    if (
        $child.ExitCode -ne 0 -or
        -not (Test-Path -LiteralPath $childEvidence -PathType Leaf)
    ) {
        throw "Elevated frontend deployment failed. Evidence: $childEvidence"
    }
    Get-Content -LiteralPath $childEvidence -Raw
    exit 0
}

if (-not (Test-Elevated) -or
    [string]::IsNullOrWhiteSpace($EvidencePath)) {
    throw 'Elevated frontend deployment boundary is invalid.'
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Identity = $identity
    Elevated = $true
    SourceAccessPerformed = $false
    XDriveWrites = 0
}

try {
    $publication = @(
        & $publisher `
            -SourceRoot $repository `
            -PublicationRoot $publicationRoot `
            -PublishedAtUtc ([DateTimeOffset]::UtcNow)
    ) -join [Environment]::NewLine | ConvertFrom-Json
    $evidence.Publication = $publication
    $evidence.Verdict = 'PASS'
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
}
catch {
    $evidence.Error = $_.Exception.Message
    $evidence.FailedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    throw
}
finally {
    [IO.File]::WriteAllText(
        $EvidencePath,
        ($evidence | ConvertTo-Json -Depth 12) +
            [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
}

$evidence | ConvertTo-Json -Depth 12
