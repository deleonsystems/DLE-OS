[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^refreshcontrol-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$')]
    [string] $ReleaseId,
    [string] $OutputRoot = 'C:\DLE-OS\Repositories\DLE-OS\.tmp\governed-refresh-releases'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$project = Join-Path $repo 'Tools\DevelopmentRuntime\DleOs.GovernedRefreshControlHost\DleOs.GovernedRefreshControlHost.csproj'
$release = Join-Path $OutputRoot $ReleaseId
if (Test-Path -LiteralPath $release) { throw "Release path already exists: $release" }
New-Item -ItemType Directory -Path $release -Force | Out-Null
& dotnet publish $project -c Release -o $release
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with $LASTEXITCODE." }

$dependencyManifest = Get-Content -LiteralPath (Join-Path $release 'worker-dependencies.json') -Raw | ConvertFrom-Json
$qualificationFixtures = Get-Content -LiteralPath (Join-Path $release 'qualification-fixtures.json') -Raw | ConvertFrom-Json
$files = @(Get-ChildItem -LiteralPath $release -Recurse -File |
    Where-Object Name -ne 'release-manifest.json' | Sort-Object FullName | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($release.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
            length = [long]$_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    })
$manifest = [ordered]@{
    schema = 'dle-os.governed-refresh-control-release.v1'
    releaseId = $ReleaseId
    builtAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    sourceHead = (& git -C $repo rev-parse HEAD).Trim()
    sourceProject = $project
    intendedRuntimePath = "C:\ProgramData\DLE-OS\GovernedRefreshControl\Service\releases\$ReleaseId"
    listener = 'http://dle-os-host:5057'
    intendedRuntimeIdentity = 'DLE-OS-HOST\DLE-OS'
    trustedCaller = 'DLE-OS-HOST\DLE-OS-DEV-FRONTEND'
    securityDatabase = 'DLE_OS_SECURITY_DEV'
    requiredPermission = 'sync.operations'
    defaultExecutionMode = 'DISABLED_FOR_STANDALONE_QUALIFICATION'
    qualificationExecutionMode = 'APPROVED_FAILURE_PRESERVATION_QUALIFICATION'
    qualificationApproval = 'LOCAL_ONE_SHOT_RELEASE_BOUND_FIVE_MINUTE'
    liveExecutionMode = 'LOCAL_ONE_SHOT_RELEASE_AND_HOST_INSTANCE_BOUND'
    liveApprovalSchema = 'dle-os.governed-refresh.one-live-run-approval.v1'
    liveApprovalMaximumRuns = 1
    liveApprovalExpiryMinutes = 10
    qualifiedFromRun = [string]$dependencyManifest.qualifiedFromRun
    qualificationFixtures = $qualificationFixtures
    files = $files
    workerDependencies = @($dependencyManifest.dependencies)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $release 'release-manifest.json') -Encoding UTF8
$exe = Join-Path $release 'DleOs.GovernedRefreshControlHost.exe'
[pscustomobject]@{
    ReleaseId = $ReleaseId
    ReleasePath = $release
    ExecutablePath = $exe
    ExecutableSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    ManifestPath = Join-Path $release 'release-manifest.json'
    ManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $release 'release-manifest.json') -Algorithm SHA256).Hash
    ReleaseFileCount = $files.Count
    WorkerDependencyCount = @($dependencyManifest.dependencies).Count
} | ConvertTo-Json -Depth 4
