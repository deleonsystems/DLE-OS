[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [ValidateSet('DLE_OS_OPERATIONAL_DEV', 'DLE_OS_SECURITY_DEV')]
    [string] $Database,

    [Parameter(Mandatory)]
    [string] $MigrationPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requiredHost = 'DLE-OS-HOST'
$requiredGroup = 'DLE-OS-HOST\DLE-OS-Developers'
$requiredRepository = 'C:\DLE-OS\Repositories\DLE-OS'
$requiredSqlInstance = 'SQLEXPRESS'

$approvedRelativeDirectories = @{
    DLE_OS_OPERATIONAL_DEV = @(
        'Tools\KittingCase\Database',
        'Tools\KittingDisposition\Database',
        'Tools\OperationsCenter\Database',
        'Tools\RmaRework\Database',
        'Tools\ShipmentStaging\Database',
        'Tools\WorkOrderApproval\Database'
    )
    DLE_OS_SECURITY_DEV = @(
        'Tools\SecurityFoundation\Database'
    )
}

$excludedSecurityMigrations = @(
    '000_ProvisionIsolatedDevelopmentDatabase.sql',
    '007_GrantDevelopmentFrontendService.sql',
    '007_ValidateDevelopmentFrontendService.sql'
)

$sessionSettings = @'
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
SET NOCOUNT ON;
'@

function Assert-ApprovedHostAndCaller {
    if ($env:COMPUTERNAME -ine $requiredHost) {
        throw "DEV migrations must run locally on $requiredHost."
    }

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $groupSid = ([Security.Principal.NTAccount]::new($requiredGroup)).Translate(
        [Security.Principal.SecurityIdentifier])
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole($groupSid)) {
        throw "The invoking Windows token for $($identity.Name) is not a member of $requiredGroup."
    }

    $identity.Name
}

function Assert-AuthoritativeRepository {
    param([Parameter(Mandatory)] [string] $Repository)

    $safeRepository = $Repository.Replace('\', '/')
    $gitBase = @('-c', "safe.directory=$safeRepository", '-C', $Repository)
    $branch = (& git.exe @gitBase branch --show-current 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -cne 'main') {
        throw 'Governed DEV migrations require the canonical main branch.'
    }

    $head = (& git.exe @gitBase rev-parse HEAD 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to resolve the canonical repository HEAD.'
    }
    $originMain = (& git.exe @gitBase rev-parse refs/remotes/origin/main 2>&1 |
        Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to resolve the local origin/main approval ref.'
    }
    if ($head -cne $originMain) {
        throw "Governed DEV migrations require HEAD to equal origin/main. HEAD=$head origin/main=$originMain"
    }

    $head
}

function Assert-NoReparsePoint {
    param(
        [Parameter(Mandatory)] [string] $Repository,
        [Parameter(Mandatory)] [string] $ResolvedMigrationPath
    )

    $currentPath = $ResolvedMigrationPath
    while ($true) {
        $current = Get-Item -LiteralPath $currentPath -Force
        if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Migration paths may not traverse a reparse point: $($current.FullName)"
        }
        if ($current.FullName -ieq $Repository) { break }
        $parentPath = Split-Path -Parent $current.FullName
        if ([string]::IsNullOrWhiteSpace($parentPath) -or
            $parentPath -eq $current.FullName) {
            throw 'The migration path is outside the canonical repository.'
        }
        $currentPath = $parentPath
    }
}

function Resolve-ApprovedMigration {
    param(
        [Parameter(Mandatory)] [string] $Repository,
        [Parameter(Mandatory)] [string] $TargetDatabase,
        [Parameter(Mandatory)] [string] $SuppliedPath
    )

    $resolvedMigration = (Resolve-Path -LiteralPath $SuppliedPath -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $resolvedMigration -PathType Leaf)) {
        throw 'The migration path must identify an existing file.'
    }
    if ([IO.Path]::GetExtension($resolvedMigration) -ine '.sql') {
        throw 'Only .sql migration files are accepted.'
    }

    Assert-NoReparsePoint -Repository $Repository -ResolvedMigrationPath $resolvedMigration

    $approved = $false
    foreach ($relativeDirectory in $approvedRelativeDirectories[$TargetDatabase]) {
        $directory = [IO.Path]::GetFullPath((Join-Path $Repository $relativeDirectory))
        $prefix = $directory.TrimEnd([IO.Path]::DirectorySeparatorChar) +
            [IO.Path]::DirectorySeparatorChar
        if ($resolvedMigration.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            $approved = $true
            break
        }
    }
    if (-not $approved) {
        throw "The migration is outside the approved directories for $TargetDatabase."
    }

    $fileName = [IO.Path]::GetFileName($resolvedMigration)
    if ($TargetDatabase -ceq 'DLE_OS_SECURITY_DEV' -and
        $excludedSecurityMigrations -contains $fileName) {
        throw "Security bootstrap/service-principal script $fileName is not an incremental developer migration."
    }

    $relativePath = [IO.Path]::GetRelativePath($Repository, $resolvedMigration)
    if ([IO.Path]::IsPathRooted($relativePath) -or
        $relativePath -eq '..' -or
        $relativePath.StartsWith('..' + [IO.Path]::DirectorySeparatorChar)) {
        throw 'The migration path is outside the canonical repository.'
    }

    $safeRepository = $Repository.Replace('\', '/')
    $gitBase = @('-c', "safe.directory=$safeRepository", '-C', $Repository)
    $tracked = & git.exe @gitBase ls-files --error-unmatch -- $relativePath 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "The migration must be tracked by Git: $relativePath"
    }
    & git.exe @gitBase diff --quiet -- $relativePath
    if ($LASTEXITCODE -ne 0) {
        throw "The migration has uncommitted working-tree changes: $relativePath"
    }
    & git.exe @gitBase diff --cached --quiet -- $relativePath
    if ($LASTEXITCODE -ne 0) {
        throw "The migration has staged changes not present in HEAD: $relativePath"
    }

    [pscustomobject]@{
        FullPath = $resolvedMigration
        RelativePath = $relativePath
        TrackedPath = ($tracked | Select-Object -First 1)
    }
}

function Assert-MigrationSqlBoundary {
    param(
        [Parameter(Mandatory)] [string] $Sql,
        [Parameter(Mandatory)] [string] $TargetDatabase
    )

    if ($Sql -match '(?im)^\s*:') {
        throw 'SQLCMD directives are not supported by the governed runner.'
    }

    foreach ($match in [regex]::Matches(
        $Sql,
        '(?im)^\s*USE\s+(?:\[([^\]]+)\]|([A-Za-z0-9_]+))\s*;')) {
        $namedDatabase = if ($match.Groups[1].Success) {
            $match.Groups[1].Value
        } else {
            $match.Groups[2].Value
        }
        if ($namedDatabase -ine $TargetDatabase) {
            throw "Migration attempts to change database context to $namedDatabase."
        }
    }

    $forbiddenPatterns = @(
        '(?i)\b(?:CREATE|ALTER|DROP)\s+LOGIN\b',
        '(?i)\bALTER\s+SERVER\s+ROLE\b',
        '(?i)\b(?:CREATE|ALTER|DROP)\s+DATABASE\b',
        '(?i)\bDLE_OS_[A-Za-z0-9_]*LIVE\b'
    )
    foreach ($pattern in $forbiddenPatterns) {
        if ($Sql -match $pattern) {
            throw 'Migration contains a forbidden server-scoped or LIVE-database statement.'
        }
    }
}

if ($env:COMPUTERNAME -ine $requiredHost) {
    throw "DEV migrations must run locally on $requiredHost."
}

$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ($repository -ine $requiredRepository) {
    throw "The governed runner must execute from the canonical repository at $requiredRepository."
}

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw 'git.exe is required to verify repository-tracked migration content.'
}

$approvedCommit = Assert-AuthoritativeRepository -Repository $repository
$caller = Assert-ApprovedHostAndCaller
$migration = Resolve-ApprovedMigration -Repository $repository `
    -TargetDatabase $Database -SuppliedPath $MigrationPath
$migrationSql = Get-Content -Raw -LiteralPath $migration.FullPath
Assert-MigrationSqlBoundary -Sql $migrationSql -TargetDatabase $Database

$batches = @([regex]::Split($migrationSql, '(?im)^\s*GO\s*$') |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($batches.Count -eq 0) {
    throw 'The approved migration contains no executable SQL batches.'
}

$description = "$Database <= $($migration.RelativePath)"
Write-Host "Caller: $caller"
Write-Host "Approved commit: $approvedCommit"
Write-Host 'SQL instance: lpc:.\SQLEXPRESS'
Write-Host "Database: $Database"
Write-Host "Migration: $($migration.FullPath)"
Write-Host "Batches: $($batches.Count)"

if (-not $PSCmdlet.ShouldProcess($description, 'execute governed DEV database migration')) {
    return
}

$connectionString =
    "Server=lpc:.\SQLEXPRESS;Database=$Database;Integrated Security=True;" +
    'Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;' +
    'Connect Timeout=5;Application Name=DLE-OS Governed DEV Migration Runner;'
$connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
try {
    $connection.Open()

    $boundaryCommand = $connection.CreateCommand()
    $boundaryCommand.CommandText = @'
SELECT CONCAT(
    CONVERT(nvarchar(128), SERVERPROPERTY('MachineName')), N'|',
    COALESCE(CONVERT(nvarchar(128), SERVERPROPERTY('InstanceName')), N''), N'|',
    DB_NAME());
'@
    try {
        $boundary = [string] $boundaryCommand.ExecuteScalar()
    }
    finally {
        $boundaryCommand.Dispose()
    }
    if ($boundary -ine "$requiredHost|$requiredSqlInstance|$Database") {
        throw "SQL connection boundary validation failed: $boundary"
    }

    foreach ($batch in $batches) {
        $command = $connection.CreateCommand()
        $command.CommandTimeout = 60
        $command.CommandText = $sessionSettings + [Environment]::NewLine + $batch
        try {
            [void] $command.ExecuteNonQuery()
        }
        finally {
            $command.Dispose()
        }
    }
}
finally {
    if ($null -ne $connection) { $connection.Dispose() }
}

Write-Host "PASS: governed DEV migration completed: $description"
