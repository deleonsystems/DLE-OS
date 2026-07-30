[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    -not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw (
        'Force-full importer deployment requires the elevated approved ' +
        'DLE-OS identity.'
    )
}

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$serverRepository = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$overlay =
    Join-Path $repository (
        'Tools\LiveSnapshotRefresh\ImporterOverlay\' +
        'DleOs.PlatformImporter'
    )
$artifactRoot =
    Join-Path $repository (
        'Artifacts\PurchaseOrderPlatform001\' +
        'PURCHASEORDERPLATFORM001-20260729T212157Z'
    )
$refreshRoot = 'C:\DLE-OS\Canonical\LiveMirror\Refresh'
$statusPath =
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json'
$lockPaths = @(
    'C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\refresh.lock',
    'C:\DLE-OS\Canonical\LiveMirror\Configuration\run.lock'
)
foreach ($lock in $lockPaths) {
    if (Test-Path -LiteralPath $lock) {
        throw "Refresh deployment refused while a lock exists: $lock"
    }
}
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    if ([bool]$status.Running) {
        throw 'Refresh deployment refused while a run is active.'
    }
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$backupRoot =
    Join-Path $artifactRoot "ForceFullImporterBackup-$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

$copies = @(
    @{
        Source = Join-Path $overlay 'Models.cs'
        Target = Join-Path $serverRepository (
            'DleOs.PlatformImporter\Models.cs')
    },
    @{
        Source = Join-Path $overlay 'ImportProfiles.cs'
        Target = Join-Path $serverRepository (
            'DleOs.PlatformImporter\ImportProfiles.cs')
    },
    @{
        Source = Join-Path $overlay 'ImportEngine.cs'
        Target = Join-Path $serverRepository (
            'DleOs.PlatformImporter\ImportEngine.cs')
    },
    @{
        Source = Join-Path $overlay 'Program.cs'
        Target = Join-Path $serverRepository (
            'DleOs.PlatformImporter\Program.cs')
    },
    @{
        Source = Join-Path $overlay 'SqlPlatformStore.cs'
        Target = Join-Path $serverRepository (
            'DleOs.PlatformImporter\SqlPlatformStore.cs')
    },
    @{
        Source = Join-Path (
            Split-Path -Parent $overlay
        ) 'DleOs.PlatformImporter.Tests.Program.cs'
        Target = Join-Path $serverRepository (
            'DleOs.PlatformImporter.Tests\Program.cs')
    },
    @{
        Source = Join-Path $repository (
            'Tools\LiveSnapshotRefresh\' +
            'Complete-LiveSnapshotPromotion.ps1')
        Target = Join-Path $refreshRoot (
            'Complete-LiveSnapshotPromotion.ps1')
    }
)

foreach ($copy in $copies) {
    if (
        -not (Test-Path -LiteralPath $copy.Source -PathType Leaf) -or
        -not (Test-Path -LiteralPath $copy.Target -PathType Leaf)
    ) {
        throw (
            'Force-full importer deployment boundary is incomplete: ' +
            $copy.Source + ' -> ' + $copy.Target
        )
    }
    $backup = Join-Path $backupRoot (
        [IO.Path]::GetFileName($copy.Target) + '.' +
        [Guid]::NewGuid().ToString('N') + '.before'
    )
    Copy-Item -LiteralPath $copy.Target -Destination $backup
    Copy-Item -LiteralPath $copy.Source `
        -Destination $copy.Target -Force
    $sourceHash = (Get-FileHash -Algorithm SHA256 `
        -LiteralPath $copy.Source).Hash
    $targetHash = (Get-FileHash -Algorithm SHA256 `
        -LiteralPath $copy.Target).Hash
    if ($sourceHash -cne $targetHash) {
        throw "Deployed file hash mismatch: $($copy.Target)"
    }
}

$dotnet = 'C:\Program Files\dotnet\dotnet.exe'
$importerProject =
    Join-Path $serverRepository (
        'DleOs.PlatformImporter\DleOs.PlatformImporter.csproj')
$testProject =
    Join-Path $serverRepository (
        'DleOs.PlatformImporter.Tests\' +
        'DleOs.PlatformImporter.Tests.csproj')
& $dotnet build $importerProject -c Release
if ($LASTEXITCODE -ne 0) {
    throw 'Force-full importer Release build failed.'
}
& $dotnet build $testProject -c Release
if ($LASTEXITCODE -ne 0) {
    throw 'Force-full importer test build failed.'
}

$testAssembly =
    Join-Path $serverRepository (
        'DleOs.PlatformImporter.Tests\bin\Release\net8.0\' +
        'DleOs.PlatformImporter.Tests.dll')
$unitOutput = & $dotnet $testAssembly unit 2>&1
$unitExit = $LASTEXITCODE
$unitOutput |
    Set-Content -LiteralPath (
        Join-Path $artifactRoot 'FORCE_FULL_IMPORTER_UNIT_TESTS.txt'
    ) -Encoding UTF8
if ($unitExit -ne 0) {
    throw 'Force-full importer unit tests failed.'
}

$rollbackOutput =
    & $dotnet $testAssembly qualify-refresh-import 2>&1
$rollbackExit = $LASTEXITCODE
$rollbackOutput |
    Set-Content -LiteralPath (
        Join-Path $artifactRoot (
            'FORCE_FULL_IMPORTER_ROLLBACK_TEST.txt')
    ) -Encoding UTF8
if ($rollbackExit -ne 0) {
    throw 'Force-full identical-content rollback qualification failed.'
}

$deployed = foreach ($copy in $copies) {
    [ordered]@{
        Path = $copy.Target
        Sha256 = (Get-FileHash -Algorithm SHA256 `
            -LiteralPath $copy.Target).Hash
    }
}
$result = [ordered]@{
    Verdict = 'PASS'
    DeployedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ExecutionIdentity = $identity.Name
    Elevated = $true
    NormalImportNoOpPreserved = $true
    RefreshImportProfile = 'LIVE'
    RefreshImportSource =
        'C:\DLE-OS\Canonical\LiveMirror\Current'
    RefreshImportDatabase = 'DLE_OS_CANONICAL_LIVE'
    UnitTests = 'PASS'
    TransactionalRollbackQualification = 'PASS'
    SourceAccessPerformed = $false
    XDriveWrites = 0
    BackupRoot = $backupRoot
    Files = @($deployed)
}
$result |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath (
        Join-Path $artifactRoot (
            'FORCE_FULL_IMPORTER_DEPLOYMENT.json')
    ) -Encoding UTF8
$result | ConvertTo-Json -Depth 6
