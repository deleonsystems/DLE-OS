[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$commonPath = Join-Path $repository 'Tools\DevelopmentRuntime\DevFrontendDeployment.Common.ps1'
$enginePath = Join-Path $repository 'Tools\DevelopmentRuntime\Deploy-DleOsDevelopmentFrontendWindowsService.ps1'
$programPath = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\Program.cs'
$projectPath = Join-Path $PSScriptRoot 'DleOs.RuntimeBuildIdentity.Tests.csproj'
. $commonPath

$checks = [Collections.Generic.List[string]]::new()
function Check([bool]$Condition,[string]$Name) {
    if (-not $Condition) { throw "FAILED: $Name" }
    $checks.Add($Name)
}
function Invoke-Git([string]$Root,[string[]]$Arguments) {
    $output = & git.exe -C $Root @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $output" }
}

$fixtureRoot = Join-Path $repository ('.tmp\runtime-build-identity\git-fixture-' + [guid]::NewGuid())
$resolvedFixtureParent = [IO.Path]::GetFullPath((Join-Path $repository '.tmp\runtime-build-identity'))
try {
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'SRC') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $fixtureRoot 'SRC\fixture.js') -Value 'const value = 1;' -Encoding utf8
    Invoke-Git $fixtureRoot @('init','--quiet')
    Invoke-Git $fixtureRoot @('config','user.name','DLE-OS Qualification')
    Invoke-Git $fixtureRoot @('config','user.email','qualification@invalid.local')
    Invoke-Git $fixtureRoot @('add','SRC/fixture.js')
    Invoke-Git $fixtureRoot @('commit','--quiet','-m','fixture baseline')

    $clean = Get-DleOsDevelopmentFrontendSourceIdentity $fixtureRoot
    $cleanAgain = Get-DleOsDevelopmentFrontendSourceIdentity $fixtureRoot
    Check (-not $clean.SourceDirty) 'clean fixture is detected as clean'
    Check ($clean.SourceDigestSha256 -eq $cleanAgain.SourceDigestSha256) `
        'identical source produces a deterministic digest'

    Set-Content -LiteralPath (Join-Path $fixtureRoot 'SRC\fixture.js') -Value 'const value = 2;' -Encoding utf8
    $dirty = Get-DleOsDevelopmentFrontendSourceIdentity $fixtureRoot
    Check $dirty.SourceDirty 'modified tracked source is detected as dirty'
    Check ($dirty.GitHead -eq $clean.GitHead -and
           $dirty.SourceDigestSha256 -ne $clean.SourceDigestSha256) `
        'dirty content changes identity even when Git HEAD is unchanged'

    Set-Content -LiteralPath (Join-Path $fixtureRoot 'SRC\extra.js') -Value 'export const extra = true;' -Encoding utf8
    $untracked = Get-DleOsDevelopmentFrontendSourceIdentity $fixtureRoot
    Check ($untracked.SourceDirty -and $untracked.SourceFileCount -eq $dirty.SourceFileCount + 1 -and
           $untracked.SourceDigestSha256 -ne $dirty.SourceDigestSha256) `
        'untracked relevant source participates in dirty detection and digest'
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    if ($resolvedFixture.StartsWith($resolvedFixtureParent + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedFixture)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}

$actual = Get-DleOsDevelopmentFrontendSourceIdentity $repository
Check ($actual.GitHead -match '^[0-9a-f]{40,64}$' -and
       $actual.SourceDigestSha256 -match '^[0-9A-F]{64}$' -and
       $actual.SourceFileCount -gt 0) 'repository frontend source identity is complete'

$engine = Get-Content -LiteralPath $enginePath -Raw
$program = Get-Content -LiteralPath $programPath -Raw
Check ($engine.Contains("runtime-build-info.json") -and
       $engine.Contains('$evidence.RuntimeIdentity=$runtimeBuildInfo') -and
       $engine.Contains("frontendContentRootIdentity='release/frontend'") -and
       $engine.Contains('The served runtime identity does not match the deployment candidate.')) `
    'deployment embeds, records, and qualifies runtime and immutable frontend identities'
Check ($program.Contains('MapGet("/api/runtime/info"') -and
       $program.Contains('runtimeBuildInfo.ToSafeResponse()') -and
       $program.Contains('IsRuntimeInfoPath(context.Request.Path)')) `
    'safe runtime endpoint has an explicit anonymous middleware boundary'
Check (-not $program.Contains('Results.Ok(runtime)')) `
    'runtime endpoint does not serialize the broader runtime configuration'
Check ($program.Contains('DLE_OS_FRONTEND_CONTENT_ROOT') -and
       $program.Contains('FrontendReleaseManifestValidator.Validate') -and
       -not $program.Contains('DLE_OS_REPOSITORY_ROOT')) `
    'governed runtime serves only a validated explicit frontend content root'

& dotnet.exe run --project $projectPath -c Release --no-restore
if ($LASTEXITCODE -ne 0) { throw 'Runtime build identity application checks failed.' }
$checks.Add('runtime metadata safety and UI application checks pass')

Write-Output "PASS: $($checks.Count) runtime build identity workflow checks."
$checks | ForEach-Object { Write-Output "  $_" }
