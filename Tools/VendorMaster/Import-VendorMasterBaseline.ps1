[CmdletBinding()]
param(
    [switch]$QualificationInduceFailure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$packageRoot = Join-Path $repository (
    'Artifacts\VendorMasterPlatform001\' +
    'VENDORMASTERPLATFORM001-20260729T200737Z\BaselinePackage')
$database = 'DLE_OS_CANONICAL_LIVE'
$server = 'lpc:.\SQLEXPRESS'
$manifestPath = Join-Path $packageRoot 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

if (
    $manifest.schema -cne 'dle-vendor-master-package' -or
    $manifest.schemaVersion -cne '1.0' -or
    $manifest.contractVersion -cne 'VENDOR_MASTER_1.0' -or
    $manifest.packageSha256 -notmatch '^[0-9A-F]{64}$' -or
    -not $manifest.restrictedFieldsExcludedFromDataFiles
) {
    throw 'The package is outside the qualified Vendor Master boundary.'
}

$expectedFiles = @(
    'OrphanVendorAddress.csv',
    'OrphanVendorDetail.csv',
    'Vendor.csv',
    'VendorAddress.csv',
    'metadata.json'
)
$hashLines = foreach ($name in $expectedFiles) {
    $property = $manifest.files.PSObject.Properties[$name]
    if ($null -eq $property) {
        throw "Package manifest file entry is missing: $name"
    }
    $path = Join-Path $packageRoot $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Package file is missing: $name"
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -cne $property.Value) {
        throw "Package file hash mismatch: $name"
    }
    "${name}:$actual`n"
}
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $packageHash = (
        [BitConverter]::ToString(
            $sha.ComputeHash(
                [Text.Encoding]::ASCII.GetBytes(($hashLines -join ''))
            )
        )
    ).Replace('-', '')
}
finally {
    $sha.Dispose()
}
if ($packageHash -cne $manifest.packageSha256) {
    throw 'The package aggregate SHA-256 does not match its manifest.'
}

$vendors = @(
    Import-Csv -LiteralPath (Join-Path $packageRoot 'Vendor.csv'))
$addresses = @(
    Import-Csv -LiteralPath (
        Join-Path $packageRoot 'VendorAddress.csv'))
$orphans = @(
    Import-Csv -LiteralPath (
        Join-Path $packageRoot 'OrphanVendorAddress.csv'))
$orphanDetails = @(
    Import-Csv -LiteralPath (
        Join-Path $packageRoot 'OrphanVendorDetail.csv'))
if (
    $vendors.Count -ne [int]$manifest.counts.Vendor -or
    $addresses.Count -ne [int]$manifest.counts.VendorAddress -or
    $orphans.Count -ne [int]$manifest.counts.OrphanAddresses -or
    $orphanDetails.Count -ne [int]$manifest.counts.OrphanVendorDetails
) {
    throw 'Package entity counts do not match the manifest.'
}

$vendorKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
foreach ($row in $vendors) {
    $key = "$($row.FirmId)|$($row.VendorNumber)"
    if (
        [string]::IsNullOrWhiteSpace($row.FirmId) -or
        [string]::IsNullOrWhiteSpace($row.VendorNumber) -or
        -not $vendorKeys.Add($key)
    ) {
        throw "Invalid or duplicate Vendor natural key: $key"
    }
}
$addressKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
foreach ($row in $addresses) {
    $parent = "$($row.FirmId)|$($row.VendorNumber)"
    $key = "$parent|$($row.AddressCode)"
    if (
        -not $vendorKeys.Contains($parent) -or
        -not $addressKeys.Add($key)
    ) {
        throw "Invalid, duplicate, or orphan VendorAddress key: $key"
    }
}

$connectionString = (
    "Server=$server;Database=$database;Integrated Security=True;" +
    'Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Vendor Master Baseline Importer'
)
$connection = [Data.SqlClient.SqlConnection]::new($connectionString)
$connection.Open()

function New-Command {
    param(
        [Parameter(Mandatory)]
        [string]$Text,
        [Data.SqlClient.SqlTransaction]$Transaction
    )
    $command = $connection.CreateCommand()
    $command.CommandText = $Text
    $command.CommandTimeout = 180
    $command.Transaction = $Transaction
    return $command
}

function New-Table {
    param(
        [Parameter(Mandatory)]
        [object[]]$Rows,
        [Parameter(Mandatory)]
        [Collections.Specialized.OrderedDictionary]$Columns,
        [Parameter(Mandatory)]
        [Guid]$RunId
    )
    $table = [Data.DataTable]::new()
    foreach ($name in $Columns.Keys) {
        [void]$table.Columns.Add($name, $Columns[$name])
    }
    [void]$table.Columns.Add(
        'VendorMasterImportRunId', [Guid])
    foreach ($source in $Rows) {
        $row = $table.NewRow()
        foreach ($name in $Columns.Keys) {
            $value = $source.$name
            if (
                $null -eq $value -or
                ($value -is [string] -and $value -eq '')
            ) {
                $row[$name] = [DBNull]::Value
            }
            elseif ($Columns[$name] -eq [bool]) {
                $row[$name] = [bool]::Parse($value)
            }
            else {
                $row[$name] = $value
            }
        }
        $row.VendorMasterImportRunId = $RunId
        [void]$table.Rows.Add($row)
    }
    return ,$table
}

function Write-Bulk {
    param(
        [Parameter(Mandatory)]
        [Data.DataTable]$Table,
        [Parameter(Mandatory)]
        [string]$Destination,
        [Parameter(Mandatory)]
        [Data.SqlClient.SqlTransaction]$Transaction
    )
    $bulk = [Data.SqlClient.SqlBulkCopy]::new(
        $connection,
        [Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints,
        $Transaction)
    $bulk.DestinationTableName = $Destination
    $bulk.BatchSize = 500
    foreach ($column in $Table.Columns) {
        [void]$bulk.ColumnMappings.Add(
            $column.ColumnName, $column.ColumnName)
    }
    $bulk.WriteToServer($Table)
    $bulk.Dispose()
}

$transaction = $connection.BeginTransaction(
    [Data.IsolationLevel]::Serializable)
$runId = [Guid]::NewGuid()
try {
    $existingCommand = New-Command -Transaction $transaction -Text @'
SELECT TOP (1) VendorMasterImportRunId
FROM platform.VendorMasterImportRun
WHERE PackageSha256 = @PackageSha256
  AND ImportStatus = N'SUCCESS'
  AND IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
'@
    [void]$existingCommand.Parameters.AddWithValue(
        '@PackageSha256', [string]$manifest.packageSha256)
    $existing = $existingCommand.ExecuteScalar()
    if ($null -ne $existing -and -not $QualificationInduceFailure) {
        $transaction.Rollback()
        [ordered]@{
            Verdict = 'PASS'
            Behavior = 'NO-OP'
            VendorMasterImportRunId = $existing
            PackageSha256 = $manifest.packageSha256
            VendorCount = $vendors.Count
            VendorAddressCount = $addresses.Count
        } | ConvertTo-Json
        $connection.Dispose()
        exit 0
    }

    $startCommand = New-Command -Transaction $transaction -Text @'
INSERT platform.VendorMasterImportRun
(
    VendorMasterImportRunId,
    SourceQualificationRunId,
    PackageSha256,
    ManifestSha256,
    PackageSchema,
    PackageSchemaVersion,
    ContractVersion,
    StartedAtUtc,
    ImportStatus,
    IsCommitted,
    IsNoOp,
    VendorCount,
    VendorAddressCount,
    OrphanAddressCount,
    OrphanDetailCount
)
VALUES
(
    @RunId,
    @SourceQualificationRunId,
    @PackageSha256,
    @ManifestSha256,
    @PackageSchema,
    @PackageSchemaVersion,
    @ContractVersion,
    SYSUTCDATETIME(),
    N'PENDING',
    0,
    0,
    @VendorCount,
    @VendorAddressCount,
    @OrphanAddressCount,
    @OrphanDetailCount
);
'@
    $manifestHash = (
        Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
    foreach ($pair in @{
        '@RunId' = $runId
        '@SourceQualificationRunId' = [string](
            $manifest.sourceQualificationRunId)
        '@PackageSha256' = [string]$manifest.packageSha256
        '@ManifestSha256' = $manifestHash
        '@PackageSchema' = [string]$manifest.schema
        '@PackageSchemaVersion' = [string]$manifest.schemaVersion
        '@ContractVersion' = [string]$manifest.contractVersion
        '@VendorCount' = $vendors.Count
        '@VendorAddressCount' = $addresses.Count
        '@OrphanAddressCount' = $orphans.Count
        '@OrphanDetailCount' = $orphanDetails.Count
    }.GetEnumerator()) {
        [void]$startCommand.Parameters.AddWithValue(
            $pair.Key, $pair.Value)
    }
    [void]$startCommand.ExecuteNonQuery()

    [void](New-Command -Transaction $transaction -Text @'
DELETE FROM canonical.VendorAddress;
DELETE FROM canonical.VendorMaster;
'@).ExecuteNonQuery()
    if ($QualificationInduceFailure) {
        throw 'QUALIFICATION_INDUCED_FAILURE_AFTER_DELETE'
    }

    $vendorColumns = [ordered]@{}
    foreach ($name in @(
        'FirmId', 'VendorNumber', 'VendorName', 'VendorStatus',
        'VendorType', 'VendorClass', 'AddressLine1', 'AddressLine2',
        'AddressLine3', 'PostalCode', 'Country', 'PrimaryContactName',
        'PrimaryPhone', 'PrimaryPhoneExtension', 'PaymentTermsCode',
        'PaymentTermsDescription', 'ApprovedSupplierStatus',
        'SourceRecordIdentity'
    )) {
        $vendorColumns[$name] = [string]
    }
    $vendorColumns.Insert(4, 'IsActive', [bool])
    $addressColumns = [ordered]@{}
    foreach ($name in @(
        'FirmId', 'VendorNumber', 'AddressCode', 'AddressType',
        'AddressName', 'AddressLine1', 'AddressLine2', 'AddressLine3',
        'PostalCode', 'Country', 'ContactName', 'Phone',
        'PhoneExtension', 'SourceRecordIdentity'
    )) {
        $addressColumns[$name] = [string]
    }
    $addressColumns.Insert(13, 'IsPrimary', [bool])
    $addressColumns.Insert(14, 'IsActive', [bool])
    $vendorTable = New-Table `
        -Rows $vendors `
        -Columns $vendorColumns `
        -RunId $runId
    $addressTable = New-Table `
        -Rows $addresses `
        -Columns $addressColumns `
        -RunId $runId
    Write-Bulk `
        -Table $vendorTable `
        -Destination 'canonical.VendorMaster' `
        -Transaction $transaction
    Write-Bulk `
        -Table $addressTable `
        -Destination 'canonical.VendorAddress' `
        -Transaction $transaction

    $completeCommand = New-Command -Transaction $transaction -Text @'
UPDATE platform.VendorMasterImportRun
SET CompletedAtUtc = SYSUTCDATETIME(),
    ImportStatus = N'SUCCESS',
    IsCommitted = 1
WHERE VendorMasterImportRunId = @RunId;
'@
    [void]$completeCommand.Parameters.AddWithValue('@RunId', $runId)
    [void]$completeCommand.ExecuteNonQuery()
    $transaction.Commit()
}
catch {
    if ($transaction.Connection) {
        $transaction.Rollback()
    }
    $connection.Dispose()
    throw
}

$countsCommand = New-Command -Text @'
SELECT
    (SELECT COUNT_BIG(*) FROM canonical.VendorMaster) AS VendorCount,
    (SELECT COUNT_BIG(*) FROM canonical.VendorAddress)
        AS VendorAddressCount;
'@
$counts = $countsCommand.ExecuteReader()
[void]$counts.Read()
$result = [ordered]@{
    Verdict = 'PASS'
    Behavior = 'IMPORTED'
    VendorMasterImportRunId = $runId
    PackageSha256 = $manifest.packageSha256
    VendorCount = $counts.GetInt64(0)
    VendorAddressCount = $counts.GetInt64(1)
}
$counts.Close()
$connection.Dispose()
$result | ConvertTo-Json
