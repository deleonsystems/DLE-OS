[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$')]
    [string]$ReleaseId,

    [Parameter(Mandatory=$true)]
    [string]$StageRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$project = Join-Path $PSScriptRoot 'DleOs.DevOperationalControlHost\DleOs.DevOperationalControlHost.csproj'
$boundaryTest = Join-Path $repository 'Tests\DevControlSeparation001\Test-DevOnlyControlHostBoundary.ps1'
$stage = [IO.Path]::GetFullPath((Join-Path $StageRoot $ReleaseId))
$publish = Join-Path $stage 'publish'
$evidence = Join-Path $stage 'evidence'

if (-not $stage.StartsWith([IO.Path]::GetFullPath($StageRoot).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The release stage escaped its caller-provided root.'
}
if (Test-Path -LiteralPath $stage) {
    throw "The immutable release stage already exists: $stage"
}
$null = New-Item -ItemType Directory -Path $publish,$evidence

$commit = (& git -c "safe.directory=$repository" -C $repository rev-parse HEAD).Trim()
$commitRecord = (& git -c "safe.directory=$repository" -C $repository log -1 --format='%H|%an <%ae>|%aI|%s').Trim()
$sourceStatus = @(& git -c "safe.directory=$repository" -C $repository status --short -- `
    'Tools/DevelopmentRuntime/DleOs.DevOperationalControlHost' `
    'Tests/DevControlSeparation001/Test-DevOnlyControlHostBoundary.ps1')
$sourceBoundaryFiles = @(
    Get-ChildItem -LiteralPath (Split-Path $project) -File -Recurse |
        Where-Object Extension -in '.cs','.csproj','.ps1' |
        Sort-Object FullName
)
$sourceBoundary = @($sourceBoundaryFiles | ForEach-Object {
    [ordered]@{
        relativePath = [IO.Path]::GetRelativePath($repository,$_.FullName).Replace('\','/')
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
})

$publishLog = Join-Path $evidence 'dotnet-publish.log'
& dotnet publish $project -c Release -r win-x64 --self-contained false `
    -p:DebugType=None -p:DebugSymbols=false -o $publish 2>&1 |
    Tee-Object -LiteralPath $publishLog
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

$boundaryLog = Join-Path $evidence 'dev-boundary-test.log'
& pwsh -NoProfile -File $boundaryTest 2>&1 | Tee-Object -LiteralPath $boundaryLog
if ($LASTEXITCODE -ne 0) { throw "The DEV-only boundary test failed with exit code $LASTEXITCODE" }

$launcher = Join-Path $publish 'Start-DevOperationalControlHost5054.ps1'
$executable = Join-Path $publish 'DleOs.DevOperationalControlHost.exe'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf) -or
    -not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'The published candidate is missing its release-owned launcher or executable.'
}
$forbiddenPatterns = @(
    'DLE_OS_CANONICAL_LIVE','\\deleon-server\Production','5041','5042','5043',
    'Azure Artifact Signing','LiveSnapshotRefresh','Start-DevOperationalControlHost5054WithEnvironment.ps1'
)
$boundaryText = (Get-Content -LiteralPath $launcher -Raw) +
    (Get-Content -LiteralPath (Join-Path (Split-Path $project) 'DevControlHostRuntimeConfiguration.cs') -Raw)
foreach($pattern in $forbiddenPatterns) {
    if ($boundaryText -match [regex]::Escape($pattern)) {
        throw "The release launcher/configuration contains a forbidden boundary token: $pattern"
    }
}

$files = @(Get-ChildItem -LiteralPath $publish -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        relativePath = [IO.Path]::GetRelativePath($publish,$_.FullName).Replace('\','/')
        length = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        authenticodeStatus = [string](Get-AuthenticodeSignature -LiteralPath $_.FullName).Status
    }
})

$created = (Get-Date).ToUniversalTime().ToString('o')
$manifest = [ordered]@{
    schemaVersion = 1
    releaseId = $ReleaseId
    createdTimestampUtc = $created
    sourceCommit = $commit
    sourceCommitRecord = $commitRecord
    sourceTreeState = if($sourceStatus.Count -eq 0){'CLEAN'}else{'DIRTY_QUALIFIED_SOURCE_BOUNDARY'}
    sourceStatus = $sourceStatus
    sourceBoundary = $sourceBoundary
    projectIdentity = 'DleOs.DevOperationalControlHost'
    projectPath = 'Tools/DevelopmentRuntime/DleOs.DevOperationalControlHost/DleOs.DevOperationalControlHost.csproj'
    runtimeConfigurationSchema = 'DLE_OS_DEV_5054_V1'
    expectedListener = 'http://dle-os-host:5054'
    operationalDatabase = 'DLE_OS_OPERATIONAL_DEV'
    securityDatabase = 'DLE_OS_SECURITY_DEV'
    canonicalReadEndpoint = 'http://DLE-OS-HOST:5052'
    expectedServiceIdentity = 'DLE-OS-HOST\DLE-OS-DEV-CONTROL'
    devDataRoot = 'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data'
    assertionValidatorPublicKey = 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'
    forbiddenLiveCapabilities = @(
        'Direct DLE_OS_CANONICAL_LIVE access','Canonical filesystem writes','Production KITTING shares',
        'LIVE refresh and promotion','LIVE deployment and signing material','Listeners 5041/5042/5043',
        'Repository execution dependency','Runtime schema migration or DDL'
    )
    qualification = [ordered]@{
        releaseBuild = 'PASS'
        structuralDevOnlyBoundary = 'PASS'
        releaseOwnedLauncher = 'PASS'
        runtimeSchemaMigrationExcluded = 'PASS'
        fileInventoryComplete = 'PASS'
        runtimeExecution = 'NOT_RUN'
        smartAppControlTrust = 'BLOCKED_PENDING_MANAGED_APP_CONTROL_DECISION'
    }
    rollbackEligibility = 'CANDIDATE_NOT_YET_RUNTIME_QUALIFIED'
    files = $files
}
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $stage 'release-manifest.json') -Encoding utf8

[ordered]@{
    schemaVersion = 1
    releaseId = $ReleaseId
    createdTimestampUtc = $created
    verdict = 'PASS_WITH_TRUST_DECISION_GATE'
    build = 'PASS'
    boundaryTest = 'PASS'
    immutableInstall = 'PENDING'
    runtimeIdentityAclQualification = 'PENDING'
    trustQualification = 'BLOCKED_BY_SMART_APP_CONTROL_ENFORCEMENT'
    candidateStarted = $false
    scheduledTaskChanged = $false
    liveChanged = $false
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidence 'release-qualification.json') -Encoding utf8

[pscustomobject]@{
    ReleaseId=$ReleaseId
    Stage=$stage
    Publish=$publish
    Manifest=(Join-Path $stage 'release-manifest.json')
    FileCount=$files.Count
}
