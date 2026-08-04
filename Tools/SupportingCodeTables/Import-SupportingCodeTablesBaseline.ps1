[CmdletBinding()]
param(
    [switch]$QualificationInduceFailure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$packageRoot = Join-Path $repository (
    'Artifacts\SupportingCodeTablesPlatform001\' +
    'SUPPORTINGCODETABLESPLATFORM001-20260730T133739Z\BaselinePackage')
$database = 'DLE_OS_CANONICAL_LIVE'
$manifest = Get-Content -Raw -LiteralPath (
    Join-Path $packageRoot 'manifest.json') | ConvertFrom-Json
$metadata = Get-Content -Raw -LiteralPath (
    Join-Path $packageRoot 'metadata.json') | ConvertFrom-Json
$packageHash = (
    Get-Content -Raw -LiteralPath (
        Join-Path $packageRoot 'package.sha256')).Trim().ToUpperInvariant()

if (
    $manifest.schema -cne 'dle-reference-code-manifest' -or
    $manifest.schemaVersion -cne '1.0' -or
    $metadata.schema -cne 'dle-reference-code-package' -or
    $metadata.schemaVersion -cne '1.0' -or
    $metadata.contractVersion -cne 'REFERENCE_CODE_1.0' -or
    $metadata.privacyBoundary -cne 'OPERATIONAL_ALLOWLIST_ONLY' -or
    [int]$metadata.counts.ProhibitedFieldsPresent -ne 0
) {
    throw 'Package is outside the qualified Reference Code boundary.'
}
$calculatedPackageHash = (
    Get-FileHash -LiteralPath (
        Join-Path $packageRoot 'manifest.json') -Algorithm SHA256
).Hash
if ($calculatedPackageHash -cne $packageHash) {
    throw 'Reference Code package hash mismatch.'
}
foreach ($entry in $manifest.files) {
    $path = Join-Path $packageRoot $entry.name
    if (
        -not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne
            $entry.sha256
    ) {
        throw "Reference Code manifest mismatch: $($entry.name)"
    }
}

$expectedHeader = @(
    'FirmId','CodeDomain','CodeType','CodeValue','CodeDescription',
    'ShortDescription','ParentCodeValue','SortOrder','IsActive','SourceType',
    'AccessClassification','ResolutionStatus','SourceRecordIdentity',
    'UsageCount'
)
$rows = Import-Csv -LiteralPath (
    Join-Path $packageRoot 'ReferenceCode.csv')
if (@($rows).Count -ne [int]$metadata.counts.ReferenceCode) {
    throw 'Reference Code row count does not match metadata.'
}
if (
    (@($rows)[0].PSObject.Properties.Name -join [char]0x1F) -cne
    ($expectedHeader -join [char]0x1F)
) {
    throw 'Reference Code CSV header mismatch.'
}
$seen = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
foreach ($row in $rows) {
    foreach ($required in @(
        'FirmId','CodeDomain','CodeType','CodeValue','SourceType',
        'AccessClassification','ResolutionStatus'
    )) {
        if ([string]::IsNullOrWhiteSpace($row.$required)) {
            throw "Blank required Reference Code field: $required"
        }
    }
    $key = @(
        $row.FirmId, $row.CodeDomain, $row.CodeType, $row.CodeValue
    ) -join [char]0x1F
    if (-not $seen.Add($key)) {
        throw "Duplicate Reference Code natural key: $key"
    }
    if (
        $row.AccessClassification -match
            'AccountingRestricted|AdministrativeRestricted|HRRestricted|' +
            'PayrollRestricted|SecurityRestricted|NotRecommended'
    ) {
        throw 'Restricted reference code entered general package.'
    }
}

$connection = [System.Data.SqlClient.SqlConnection]::new(
    "Server=lpc:.\SQLEXPRESS;Database=$database;Integrated Security=true;" +
    'Encrypt=false;Application Name=SUPPORTING-CODE-TABLES-PLATFORM-001-Importer')
$connection.Open()
try {
    if ($connection.Database -cne $database) {
        throw "Unexpected database boundary: $($connection.Database)"
    }
    $check = $connection.CreateCommand()
    $check.CommandText = @'
SELECT TOP (1) ReferenceCodeImportRunId
FROM platform.ReferenceCodeImportRun
WHERE PackageSha256 = @PackageSha256
  AND IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
'@
    [void]$check.Parameters.Add(
        '@PackageSha256', [Data.SqlDbType]::Char, 64)
    $check.Parameters['@PackageSha256'].Value = $packageHash
    $existing = $check.ExecuteScalar()
    $check.Dispose()
    if ($null -ne $existing -and -not $QualificationInduceFailure) {
        [ordered]@{
            Verdict = 'NO-OP'
            ReferenceCodeImportRunId = $existing.ToString()
            PackageSha256 = $packageHash
            ReferenceCodeCount = $rows.Count
        } | ConvertTo-Json
        return
    }

    $runId = [guid]::NewGuid()
    $started = [DateTime]::UtcNow
    $transaction = $connection.BeginTransaction()
    try {
        $insertRun = $connection.CreateCommand()
        $insertRun.Transaction = $transaction
        $insertRun.CommandText = @'
INSERT platform.ReferenceCodeImportRun
(
    ReferenceCodeImportRunId, SourceQualificationRunId, PackageSha256,
    ManifestSha256, PackageSchema, PackageSchemaVersion, ContractVersion,
    StartedAtUtc, ImportStatus, IsCommitted, IsNoOp, ReferenceCodeCount,
    RelationshipCount, UsageEvidenceCount, ResolvedCount, UnresolvedCount,
    AmbiguousCount, GenericSystemCount, CanonicalEnumCount,
    RestrictedSourceRecordCount
)
VALUES
(
    @RunId, @SourceRun, @PackageHash, @ManifestHash, @PackageSchema,
    @SchemaVersion, @ContractVersion, @StartedAt, N'RUNNING', 0, 0,
    @ReferenceCount, @RelationshipCount, @UsageCount, @ResolvedCount,
    @UnresolvedCount, @AmbiguousCount, @GenericCount, @EnumCount,
    @RestrictedCount
);
'@
        $values = @{
            RunId = $runId
            SourceRun = $metadata.sourceQualificationAttemptId
            PackageHash = $packageHash
            ManifestHash = $calculatedPackageHash
            PackageSchema = $metadata.schema
            SchemaVersion = $metadata.schemaVersion
            ContractVersion = $metadata.contractVersion
            StartedAt = $started
            ReferenceCount = [int]$metadata.counts.ReferenceCode
            RelationshipCount = [int]$metadata.counts.ReferenceCodeRelationship
            UsageCount = [int]$metadata.counts.ReferenceCodeUsage
            ResolvedCount = [int]$metadata.counts.Resolved
            UnresolvedCount = [int]$metadata.counts.Unresolved
            AmbiguousCount = [int]$metadata.counts.Ambiguous
            GenericCount = [int]$metadata.counts.GenericSystem
            EnumCount = [int]$metadata.counts.CanonicalEnum
            RestrictedCount = [int]$metadata.counts.RestrictedSourceRecordsExcluded
        }
        foreach ($name in $values.Keys) {
            [void]$insertRun.Parameters.AddWithValue(
                "@$name", $values[$name])
        }
        [void]$insertRun.ExecuteNonQuery()
        $insertRun.Dispose()

        $delete = $connection.CreateCommand()
        $delete.Transaction = $transaction
        $delete.CommandText = 'DELETE FROM canonical.ReferenceCode;'
        [void]$delete.ExecuteNonQuery()
        $delete.Dispose()

        $table = [Data.DataTable]::new()
        foreach ($column in @(
            @('FirmId',[string]), @('CodeDomain',[string]),
            @('CodeType',[string]), @('CodeValue',[string]),
            @('CodeDescription',[string]), @('ShortDescription',[string]),
            @('ParentCodeValue',[string]), @('SortOrder',[int]),
            @('IsActive',[bool]), @('SourceType',[string]),
            @('AccessClassification',[string]),
            @('ResolutionStatus',[string]),
            @('SourceRecordIdentity',[string]), @('UsageCount',[long]),
            @('ReferenceCodeImportRunId',[guid]), @('ImportedAtUtc',[datetime])
        )) {
            [void]$table.Columns.Add($column[0], $column[1])
        }
        foreach ($sourceRow in $rows) {
            $target = $table.NewRow()
            foreach ($name in @(
                'FirmId','CodeDomain','CodeType','CodeValue','SourceType',
                'AccessClassification','ResolutionStatus'
            )) { $target[$name] = $sourceRow.$name }
            foreach ($name in @(
                'CodeDescription','ShortDescription','ParentCodeValue',
                'SourceRecordIdentity'
            )) {
                $target[$name] = if (
                    [string]::IsNullOrWhiteSpace($sourceRow.$name)
                ) { [DBNull]::Value } else { $sourceRow.$name }
            }
            $target['SortOrder'] = if (
                [string]::IsNullOrWhiteSpace($sourceRow.SortOrder)
            ) { [DBNull]::Value } else { [int]$sourceRow.SortOrder }
            $target['IsActive'] = if (
                [string]::IsNullOrWhiteSpace($sourceRow.IsActive)
            ) { [DBNull]::Value } else { [bool]::Parse($sourceRow.IsActive) }
            $target['UsageCount'] = [long]$sourceRow.UsageCount
            $target['ReferenceCodeImportRunId'] = $runId
            $target['ImportedAtUtc'] = $started
            $table.Rows.Add($target)
        }
        $bulk = [System.Data.SqlClient.SqlBulkCopy]::new(
            $connection,
            [System.Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints,
            $transaction)
        $bulk.DestinationTableName = 'canonical.ReferenceCode'
        foreach ($column in $table.Columns) {
            [void]$bulk.ColumnMappings.Add($column.ColumnName, $column.ColumnName)
        }
        $bulk.WriteToServer($table)
        $bulk.Dispose()

        if ($QualificationInduceFailure) {
            throw 'QUALIFICATION_INDUCED_FAILURE'
        }
        $verify = $connection.CreateCommand()
        $verify.Transaction = $transaction
        $verify.CommandText =
            'SELECT COUNT_BIG(*) FROM canonical.ReferenceCode ' +
            'WHERE ReferenceCodeImportRunId = @RunId;'
        [void]$verify.Parameters.AddWithValue('@RunId', $runId)
        $actual = [long]$verify.ExecuteScalar()
        $verify.Dispose()
        if ($actual -ne $rows.Count) {
            throw "Transactional count mismatch: expected $($rows.Count), got $actual"
        }
        $complete = $connection.CreateCommand()
        $complete.Transaction = $transaction
        $complete.CommandText = @'
UPDATE platform.ReferenceCodeImportRun
SET CompletedAtUtc = SYSUTCDATETIME(),
    ImportStatus = N'COMMITTED',
    IsCommitted = 1
WHERE ReferenceCodeImportRunId = @RunId;
'@
        [void]$complete.Parameters.AddWithValue('@RunId', $runId)
        [void]$complete.ExecuteNonQuery()
        $complete.Dispose()
        $transaction.Commit()
        [ordered]@{
            Verdict = 'PASS'
            ReferenceCodeImportRunId = $runId
            PackageSha256 = $packageHash
            ReferenceCodeCount = $rows.Count
        } | ConvertTo-Json
    }
    catch {
        $transaction.Rollback()
        throw
    }
    finally {
        $transaction.Dispose()
    }
}
finally {
    $connection.Dispose()
}
