[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^syncops5056-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$')]
    [string] $ReleaseId,
    [string] $OutputRoot = 'C:\DLE-OS\Repositories\DLE-OS\.tmp\syncops5056-releases'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$project = Join-Path $repo (
    'Tools\DevelopmentRuntime\DleOs.SyncOperationsControlHost\' +
    'DleOs.SyncOperationsControlHost.csproj')
$release = Join-Path $OutputRoot $ReleaseId
if (Test-Path -LiteralPath $release) {
    throw "Release path already exists: $release"
}
New-Item -ItemType Directory -Path $release | Out-Null

& dotnet publish $project -c Release --no-restore -o $release
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with $LASTEXITCODE." }

$dependencyManifest = Get-Content -LiteralPath (
    Join-Path $release 'worker-dependencies.json') -Raw | ConvertFrom-Json
$files = @(Get-ChildItem -LiteralPath $release -Recurse -File |
    Where-Object Name -ne 'release-manifest.json' |
    Sort-Object FullName |
    ForEach-Object {
        [ordered]@{
            path = [IO.Path]::GetRelativePath($release, $_.FullName)
            length = [long]$_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    })
$head = (& git -C $repo rev-parse HEAD).Trim()
$manifest = [ordered]@{
    schema = 'dle-os.sync-operations-control-release.v1'
    releaseId = $ReleaseId
    builtAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    sourceHead = $head
    sourceProject = $project
    intendedRuntimePath =
        "C:\ProgramData\DLE-OS\SyncOperationsControl\Service\releases\$ReleaseId"
    listener = 'http://dle-os-host:5056'
    intendedRuntimeIdentity = 'DLE-OS-HOST\DLE-OS'
    trustedCaller = 'DLE-OS-HOST\DLE-OS-DEV-FRONTEND'
    securityDatabase = 'DLE_OS_SECURITY_DEV'
    executionMode = 'DISABLED_FOR_STANDALONE_QUALIFICATION'
    qualifiedFromRun = [string]$dependencyManifest.qualifiedFromRun
    files = $files
    workerDependencies = @($dependencyManifest.dependencies)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (
    Join-Path $release 'release-manifest.json') -Encoding UTF8

$exe = Join-Path $release 'DleOs.SyncOperationsControlHost.exe'
[pscustomobject]@{
    ReleaseId = $ReleaseId
    ReleasePath = $release
    ExecutablePath = $exe
    ExecutableSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    ManifestPath = Join-Path $release 'release-manifest.json'
    ManifestSha256 = (Get-FileHash -LiteralPath (
        Join-Path $release 'release-manifest.json') -Algorithm SHA256).Hash
    WorkerDependencyCount = @($dependencyManifest.dependencies).Count
} | ConvertTo-Json -Depth 4
