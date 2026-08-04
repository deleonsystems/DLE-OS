[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$deploymentLogRoot =
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\LiveSnapshotRefresh001M'
New-Item -ItemType Directory -Path $deploymentLogRoot -Force | Out-Null
$deploymentTranscript =
    Join-Path $deploymentLogRoot 'deployment-transcript.log'
Start-Transcript -LiteralPath $deploymentTranscript -Force | Out-Null
trap {
    $_ | Out-String |
        Add-Content -LiteralPath (
            Join-Path $deploymentLogRoot 'deployment-error.log'
        )
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
    exit 1
}

$operator = 'DLE-OS-HOST\DLE-OS'
$liveApiIdentity = 'DLE-OS-HOST\DLE-OS-LIVE-API'
$repositoryRoot =
    (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverRoot = 'C:\DLE-OS\Repositories\DLE-OS-Server'
$refreshRoot = 'C:\DLE-OS\Canonical\LiveMirror\Refresh'
$stateRoot = 'C:\ProgramData\DLE-OS\LiveSnapshotRefresh'
$qualifiedRoot = Join-Path $stateRoot 'QualifiedBoundary'
$controlRuntime = 'C:\Program Files\DLE-OS\LiveSnapshotRefreshControl'
$backupRoot =
    Join-Path 'C:\Add-On\Lab\Backups' (
        [DateTimeOffset]::Now.ToString('yyyyMMddTHHmmsszzz').Replace(':', '') +
        '_LIVE-SNAPSHOT-REFRESH-001M2'
    )
$programPath = Join-Path $serverRoot 'Program.cs'
$liveConfigurationPath = Join-Path $serverRoot 'appsettings.Live.json'
$validatorPath =
    Join-Path $serverRoot (
        'DleOs.PlatformImporter\LiveCanonicalPackageValidator.cs'
    )
$changelog = 'C:\Add-On\Lab\CHANGELOG.md'
$publisher =
    Join-Path $serverRoot (
        'DleOs.PlatformApi.Tests\Publish-LiveCanonicalApi.ps1'
    )

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal =
    [Security.Principal.WindowsPrincipal]::new($currentIdentity)
if ($currentIdentity.Name -ine $operator) {
    throw "Deployment requires $operator."
}
if (
    -not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Deployment requires an elevated DLE-OS operator token.'
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($path in @(
    $programPath, $liveConfigurationPath, $validatorPath, $changelog
)) {
    Copy-Item -LiteralPath $path -Destination (
        Join-Path $backupRoot ([IO.Path]::GetFileName($path))
    )
}

$program = Get-Content -LiteralPath $programPath -Raw
$pattern =
    '(?s)    builder\.Configuration\.AddJsonFile\(\s*' +
    'LiveApiQualifiedBoundary\.ConfigurationFileName,.*?' +
    '        \.ValidateOnStart\(\);'
$replacement = @'
    const string protectedBoundaryPath =
        @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\QualifiedBoundary\current-qualified-snapshot.json";
    var configuredBoundaryPath =
        builder.Configuration["LiveApi:QualifiedBoundaryPath"];
    if (!string.Equals(
            configuredBoundaryPath,
            protectedBoundaryPath,
            StringComparison.OrdinalIgnoreCase) ||
        !Path.IsPathFullyQualified(protectedBoundaryPath))
    {
        throw new InvalidOperationException(
            "The protected current-qualified-snapshot path is not configured.");
    }
    builder.Configuration.AddJsonFile(
        protectedBoundaryPath,
        optional: false,
        reloadOnChange: false);

    builder.Services
        .AddOptions<LiveApiOptions>()
        .Bind(builder.Configuration.GetSection(
            LiveApiQualifiedBoundary.SectionName))
        .Validate(
            options =>
                string.Equals(
                    options.RequiredWindowsIdentity,
                    @"DLE-OS-HOST\DLE-OS-LIVE-API",
                    StringComparison.OrdinalIgnoreCase) &&
                string.Equals(options.DataEnvironment, "LIVE", StringComparison.Ordinal) &&
                string.Equals(
                    options.Database,
                    LivePlatformSqlConnectionFactory.DatabaseName,
                    StringComparison.Ordinal) &&
                string.Equals(options.ContractVersion, "1.2", StringComparison.Ordinal) &&
                string.Equals(options.StoredContractVersion, "V1.2", StringComparison.Ordinal) &&
                options.ExpectedImportRunId != Guid.Empty &&
                !string.IsNullOrWhiteSpace(options.ExpectedMirrorRunId) &&
                System.Text.RegularExpressions.Regex.IsMatch(
                    options.ExpectedPackageHash,
                    "^[0-9A-F]{64}$") &&
                options.ExpectedTotalCount > 0 &&
                options.FreshnessThresholdMinutes > 0 &&
                options.WorkOrderNumberWidth == 7 &&
                string.Equals(
                    options.AllowedBrowserOrigin,
                    "http://dle-os-host:5041",
                    StringComparison.Ordinal) &&
                Path.IsPathFullyQualified(options.StartupEvidencePath),
            "Protected LIVE qualified-snapshot boundary is invalid.")
        .ValidateOnStart();
'@
$updatedProgram = [regex]::Replace($program, $pattern, $replacement, 1)
if ($updatedProgram -eq $program) {
    if ($program -notmatch 'protectedBoundaryPath') {
        throw 'The LIVE startup-boundary source block was not found.'
    }
}
else {
    [IO.File]::WriteAllText(
        $programPath,
        $updatedProgram,
        [Text.UTF8Encoding]::new($false))
}

$liveConfiguration =
    Get-Content -LiteralPath $liveConfigurationPath -Raw |
    ConvertFrom-Json
$liveConfiguration.LiveApi |
    Add-Member -NotePropertyName QualifiedBoundaryPath `
        -NotePropertyValue (
            Join-Path $qualifiedRoot 'current-qualified-snapshot.json'
        ) -Force
[IO.File]::WriteAllText(
    $liveConfigurationPath,
    ($liveConfiguration | ConvertTo-Json -Depth 8) +
        [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false))

$validator = Get-Content -LiteralPath $validatorPath -Raw
$fixedCountBlock = @'
        Require(
            stocked == 10_343 && nonStock == 1_770,
            "LIVE_RELATIONSHIP_COUNT",
            "Stocked/non-stock counts differ from qualified live evidence.");
'@
if ($validator.Contains($fixedCountBlock)) {
    $validator = $validator.Replace(
        $fixedCountBlock,
        @'
        Require(
            stocked + nonStock == entities["WorkOrder"].Rows.Count,
            "LIVE_RELATIONSHIP_RECONCILIATION",
            "Stocked/non-stock counts do not reconcile to WorkOrder rows.");
'@)
    [IO.File]::WriteAllText(
        $validatorPath,
        $validator,
        [Text.UTF8Encoding]::new($false))
}
elseif ($validator -notmatch 'LIVE_RELATIONSHIP_RECONCILIATION') {
    throw 'The fixed live relationship-count validation block was not found.'
}

New-Item -ItemType Directory -Path (
    Join-Path $refreshRoot 'Assets'
) -Force | Out-Null
Copy-Item -LiteralPath (
    Join-Path $repositoryRoot (
        'Tools\LiveSnapshotRefresh\Invoke-LiveSnapshotRefresh.ps1'
    )
) -Destination $refreshRoot -Force
Copy-Item -LiteralPath (
    Join-Path $repositoryRoot (
        'Tools\LiveSnapshotRefresh\Promote-QualifiedSnapshotBoundary.ps1'
    )
) -Destination $refreshRoot -Force
Copy-Item -LiteralPath (
    Join-Path $repositoryRoot (
        'Tools\LiveSnapshotRefresh\Complete-LiveSnapshotPromotion.ps1'
    )
) -Destination $refreshRoot -Force
Copy-Item -LiteralPath (
    Join-Path $repositoryRoot 'Tools\LiveSnapshotRefresh\sales_order_refresh.py'
) -Destination $refreshRoot -Force
Copy-Item -LiteralPath (
    Join-Path $repositoryRoot (
        'Artifacts\Platform002\Qualification\Programs\' +
        'PLATFORM002_SALES_ORDER_QUALIFIER.src'
    )
) -Destination (Join-Path $refreshRoot 'Assets') -Force
Copy-Item -LiteralPath (
    Join-Path $repositoryRoot (
        'Artifacts\Platform002\Qualification\build_sales_order_package.py'
    )
) -Destination (Join-Path $refreshRoot 'Assets') -Force
Copy-Item -LiteralPath (
    'C:\Add-On\Lab\Platform002\' +
    'PLATFORM002-20260728T163200Z-SALESORDER4\Programs\' +
    'configPLATFORM002.aon'
) -Destination (Join-Path $refreshRoot 'Assets') -Force

New-Item -ItemType Directory -Path (
    Join-Path $stateRoot 'State'
), $qualifiedRoot, $controlRuntime -Force | Out-Null

& (
    Join-Path $refreshRoot 'Promote-QualifiedSnapshotBoundary.ps1'
) | Out-Null

& 'C:\Program Files\dotnet\dotnet.exe' build (
    Join-Path $serverRoot 'DleOs.PlatformImporter.Tests'
) -c Release
if ($LASTEXITCODE -ne 0) {
    throw 'Platform importer tests/build failed.'
}
& 'C:\Program Files\dotnet\dotnet.exe' publish (
    Join-Path $repositoryRoot (
        'Tools\LiveSnapshotRefresh\ControlHost\' +
        'DleOs.LiveSnapshotRefresh.ControlHost.csproj'
    )
) -c Release --output $controlRuntime
if ($LASTEXITCODE -ne 0) {
    throw 'Refresh control host publish failed.'
}

& $publisher

$qualifiedAcl = Get-Acl -LiteralPath $qualifiedRoot
$qualifiedAcl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($qualifiedAcl.Access)) {
    [void]$qualifiedAcl.RemoveAccessRuleAll($rule)
}
foreach ($entry in @(
    @('SYSTEM', 'FullControl'),
    @($operator, 'FullControl'),
    @($liveApiIdentity, 'ReadAndExecute')
)) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $entry[0],
        $entry[1],
        [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
    $qualifiedAcl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $qualifiedRoot -AclObject $qualifiedAcl

$url = 'http://dle-os-host:5043/'
$existingUrlAcl = & netsh http show urlacl url=$url 2>$null
if ($LASTEXITCODE -ne 0 -or $existingUrlAcl -notmatch [regex]::Escape($operator)) {
    if ($LASTEXITCODE -eq 0) {
        & netsh http delete urlacl url=$url | Out-Null
    }
    & netsh http add urlacl url=$url user=$operator | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Exact refresh-control HTTP.sys URL reservation failed.'
    }
}

Add-Content -LiteralPath $changelog -Value @"

## $([DateTimeOffset]::Now.ToString('yyyy-MM-dd')) — LIVE-SNAPSHOT-REFRESH-001M2

- Added an operator-only manual Live Snapshot refresh control using HTTP.sys
  Windows authentication for DLE-OS-HOST\DLE-OS.
- Added a fixed nine-source O_RDONLY refresh runner, source-change detection,
  exclusive locking, validation, transactional SQL import orchestration,
  failure restoration, and protected current/previous qualified boundaries.
- Replaced the LIVE API's source-pinned snapshot dependency with the protected
  current-qualified-snapshot reference under C:\ProgramData\DLE-OS.
- No scheduled task, drive mapping, UNC source path, or X: write was created.
"@

[pscustomobject]@{
    Verdict = 'PASS'
    Operator = $operator
    RefreshRoot = $refreshRoot
    StateRoot = $stateRoot
    ControlRuntime = $controlRuntime
    ControlUrl = 'http://dle-os-host:5043'
    BackupRoot = $backupRoot
    ProtectedBoundary =
        Join-Path $qualifiedRoot 'current-qualified-snapshot.json'
} | ConvertTo-Json -Depth 5
Stop-Transcript | Out-Null
