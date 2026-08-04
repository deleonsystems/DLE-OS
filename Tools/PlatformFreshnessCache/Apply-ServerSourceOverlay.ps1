[CmdletBinding()]
param(
    [string] $ServerRoot =
        'C:\DLE-OS\Repositories\DLE-OS-Server'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$overlayRoot = Join-Path $toolRoot 'ServerOverlay'
$mappings = [ordered]@{
    'Options\FrontendOptions.cs' =
        'Options\FrontendOptions.cs'
    'Hosting\FrontendApplicationExtensions.cs' =
        'Hosting\FrontendApplicationExtensions.cs'
    'Options\LiveApiOptions.cs' =
        'Options\LiveApiOptions.cs'
    'Options\LiveApiQualifiedBoundary.cs' =
        'Options\LiveApiQualifiedBoundary.cs'
    'Models\Platform\LivePlatformModels.cs' =
        'Models\Platform\LivePlatformModels.cs'
    'Contracts\Platform\LivePlatformDtos.cs' =
        'Contracts\Platform\LivePlatformDtos.cs'
    'Data\Platform\LivePlatformStatusRepository.cs' =
        'Data\Platform\LivePlatformStatusRepository.cs'
}

foreach ($relative in $mappings.Keys) {
    $source = Join-Path $overlayRoot $relative
    $target = Join-Path $ServerRoot $mappings[$relative]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Overlay source is absent: $source"
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
}

$programPath = Join-Path $ServerRoot 'Program.cs'
$program = [IO.File]::ReadAllText($programPath)

$oldFrontendValidation = @'
        .Validate(
            options => FrontendOptions.RuntimeDirectories.All(directory =>
                Directory.Exists(
                    Path.Combine(options.RootPath, directory))),
            "One or more required frontend runtime directories do not exist.")
        .ValidateOnStart();
'@
$newFrontendValidation = @'
        .Validate(
            options => FrontendOptions.RuntimeDataDirectories.All(directory =>
                Directory.Exists(
                    Path.Combine(options.RootPath, directory))),
            "One or more required frontend runtime data directories do not exist.")
        .Validate(
            options =>
                Path.IsPathFullyQualified(options.PublicationRoot) &&
                Directory.Exists(options.PublicationRoot) &&
                File.Exists(Path.Combine(
                    options.PublicationRoot,
                    "current-release.json")),
            "Frontend publication root or current release pointer is invalid.")
        .ValidateOnStart();
'@
if (-not $program.Contains($oldFrontendValidation)) {
    throw 'Historical frontend validation patch anchor was not found.'
}
$program = $program.Replace(
    $oldFrontendValidation,
    $newFrontendValidation)

$oldThresholdValidation = @'
                options.ExpectedTotalCount > 0 &&
                options.FreshnessThresholdMinutes > 0 &&
                options.WorkOrderNumberWidth == 7 &&
'@
$newThresholdValidation = @'
                options.ExpectedTotalCount > 0 &&
                options.SnapshotWarningMinutes > 0 &&
                options.SourceCheckWarningMinutes > 0 &&
                options.SourceCheckHardExpirationMinutes >
                    options.SourceCheckWarningMinutes &&
                options.SourceCheckHardExpirationMinutes >=
                    options.SnapshotWarningMinutes &&
                options.QualificationWarningMinutes > 0 &&
                options.WorkOrderNumberWidth == 7 &&
'@
if (-not $program.Contains($oldThresholdValidation)) {
    throw 'LIVE readiness threshold validation patch anchor was not found.'
}
$program = $program.Replace(
    $oldThresholdValidation,
    $newThresholdValidation)
[IO.File]::WriteAllText(
    $programPath,
    $program,
    [Text.UTF8Encoding]::new($false))

$settingsPath = Join-Path $ServerRoot 'appsettings.json'
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$settings.Frontend |
    Add-Member `
        -NotePropertyName PublicationRoot `
        -NotePropertyValue 'C:\ProgramData\DLE-OS\Frontend' `
        -Force
[IO.File]::WriteAllText(
    $settingsPath,
    ($settings | ConvertTo-Json -Depth 20) + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))

Copy-Item `
    -LiteralPath (
        Join-Path $toolRoot (
            'Database\032_AddLiveSnapshotOperationalStatus.sql')) `
    -Destination (
        Join-Path $ServerRoot (
            'Database\Scripts\032_AddLiveSnapshotOperationalStatus.sql')) `
    -Force

[pscustomobject]@{
    Verdict = 'PASS'
    ServerRoot = $ServerRoot
    OverlayFiles = $mappings.Count
    ProgramPatched = $true
    FrontendPublicationRoot =
        'C:\ProgramData\DLE-OS\Frontend'
} | ConvertTo-Json
