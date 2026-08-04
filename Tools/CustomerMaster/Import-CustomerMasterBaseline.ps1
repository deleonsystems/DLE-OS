[CmdletBinding()]
param(
    [switch]$QualificationInduceFailure,
    [string] $PackageRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
    $packageRoot = Join-Path $repository (
        'Artifacts\CustomerMasterPlatform001\' +
        'CUSTOMERMASTERPLATFORM001-20260729T170951Z\BaselinePackage')
}
else {
    $packageRoot = [IO.Path]::GetFullPath($PackageRoot)
    $approvedRoutineRoot =
        'C:\DLE-OS\Canonical\CustomerMaster\Refresh\Runs\'
    if (
        -not $packageRoot.StartsWith(
            $approvedRoutineRoot,
            [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $packageRoot) -cne 'Package'
    ) {
        throw 'Customer Master package path is outside the fixed routine boundary.'
    }
}
$database = 'DLE_OS_CANONICAL_LIVE'
$server = 'lpc:.\SQLEXPRESS'
$manifestPath = Join-Path $packageRoot 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

if (
    $manifest.schema -cne 'dle-customer-master-package' -or
    $manifest.schemaVersion -cne '1.0' -or
    $manifest.contractVersion -cne 'CUSTOMER_MASTER_1.0' -or
    $manifest.packageSha256 -notmatch '^[0-9A-F]{64}$' -or
    -not $manifest.restrictedFieldsExcludedFromDataFiles
) {
    throw 'The package is outside the qualified Customer Master boundary.'
}

$expectedFiles = @(
    'Customer.csv',
    'CustomerAddress.csv',
    'OrphanCustomerAddress.csv',
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

$customers = @(
    Import-Csv -LiteralPath (Join-Path $packageRoot 'Customer.csv'))
$addresses = @(
    Import-Csv -LiteralPath (
        Join-Path $packageRoot 'CustomerAddress.csv'))
$orphans = @(
    Import-Csv -LiteralPath (
        Join-Path $packageRoot 'OrphanCustomerAddress.csv'))
if (
    $customers.Count -ne [int]$manifest.counts.Customer -or
    $addresses.Count -ne [int]$manifest.counts.CustomerAddress -or
    $orphans.Count -ne [int]$manifest.counts.OrphanAddresses
) {
    throw 'Package entity counts do not match the manifest.'
}

$customerKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
foreach ($row in $customers) {
    $key = "$($row.FirmId)|$($row.CustomerNumber)"
    if (
        [string]::IsNullOrWhiteSpace($row.FirmId) -or
        [string]::IsNullOrWhiteSpace($row.CustomerNumber) -or
        -not $customerKeys.Add($key)
    ) {
        throw "Invalid or duplicate Customer natural key: $key"
    }
}
$addressKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
foreach ($row in $addresses) {
    $parent = "$($row.FirmId)|$($row.CustomerNumber)"
    $key = "$parent|$($row.AddressCode)"
    if (
        -not $customerKeys.Contains($parent) -or
        -not $addressKeys.Add($key)
    ) {
        throw "Invalid, duplicate, or orphan CustomerAddress key: $key"
    }
}

$connectionString = (
    "Server=$server;Database=$database;Integrated Security=True;" +
    'Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Customer Master Baseline Importer'
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
        'CustomerMasterImportRunId', [Guid])
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
        $row.CustomerMasterImportRunId = $RunId
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
SELECT TOP (1) CustomerMasterImportRunId
FROM platform.CustomerMasterImportRun
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
            CustomerMasterImportRunId = $existing
            PackageSha256 = $manifest.packageSha256
            CustomerCount = $customers.Count
            CustomerAddressCount = $addresses.Count
        } | ConvertTo-Json
        $connection.Dispose()
        exit 0
    }

    $startCommand = New-Command -Transaction $transaction -Text @'
INSERT platform.CustomerMasterImportRun
(
    CustomerMasterImportRunId,
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
    CustomerCount,
    CustomerAddressCount,
    OrphanAddressCount
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
    @CustomerCount,
    @CustomerAddressCount,
    @OrphanAddressCount
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
        '@CustomerCount' = $customers.Count
        '@CustomerAddressCount' = $addresses.Count
        '@OrphanAddressCount' = $orphans.Count
    }.GetEnumerator()) {
        [void]$startCommand.Parameters.AddWithValue(
            $pair.Key, $pair.Value)
    }
    [void]$startCommand.ExecuteNonQuery()

    [void](New-Command -Transaction $transaction -Text @'
DELETE FROM canonical.CustomerAddress;
DELETE FROM canonical.CustomerMaster;
'@).ExecuteNonQuery()
    if ($QualificationInduceFailure) {
        throw 'QUALIFICATION_INDUCED_FAILURE_AFTER_DELETE'
    }

    $customerColumns = [ordered]@{}
    foreach ($name in @(
        'FirmId', 'CustomerNumber', 'CustomerName', 'CustomerStatus',
        'AddressLine1', 'AddressLine2', 'AddressLine3', 'AddressLine4',
        'AddressLine5', 'PostalCode', 'Country', 'PrimaryContactName',
        'PrimaryPhone', 'PrimaryPhoneExtension', 'SalespersonCode',
        'SalespersonName', 'TerritoryCode', 'TerritoryName',
        'PaymentTermsCode', 'PaymentTermsDescription',
        'ShippingMethodCode', 'FreightTerms', 'OrderFreightTermsCode',
        'CustomerTypeCode', 'CustomerTypeDescription', 'PricingClassCode',
        'PricingClassDescription', 'SourceRecordIdentity'
    )) {
        $customerColumns[$name] = [string]
    }
    $customerColumns.Insert(4, 'IsActive', [bool])
    $addressColumns = [ordered]@{}
    foreach ($name in @(
        'FirmId', 'CustomerNumber', 'AddressCode', 'AddressType',
        'AddressName', 'AddressLine1', 'AddressLine2', 'AddressLine3',
        'PostalCode', 'Country', 'ContactName', 'Phone',
        'PhoneExtension', 'SalespersonCode', 'SalespersonName',
        'TerritoryCode', 'TerritoryName', 'SourceRecordIdentity'
    )) {
        $addressColumns[$name] = [string]
    }
    $addressColumns.Insert(17, 'IsPrimary', [bool])
    $addressColumns.Insert(18, 'IsActive', [bool])
    $customerTable = New-Table `
        -Rows $customers `
        -Columns $customerColumns `
        -RunId $runId
    $addressTable = New-Table `
        -Rows $addresses `
        -Columns $addressColumns `
        -RunId $runId
    Write-Bulk `
        -Table $customerTable `
        -Destination 'canonical.CustomerMaster' `
        -Transaction $transaction
    Write-Bulk `
        -Table $addressTable `
        -Destination 'canonical.CustomerAddress' `
        -Transaction $transaction

    $completeCommand = New-Command -Transaction $transaction -Text @'
UPDATE platform.CustomerMasterImportRun
SET CompletedAtUtc = SYSUTCDATETIME(),
    ImportStatus = N'SUCCESS',
    IsCommitted = 1
WHERE CustomerMasterImportRunId = @RunId;
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
    (SELECT COUNT_BIG(*) FROM canonical.CustomerMaster) AS CustomerCount,
    (SELECT COUNT_BIG(*) FROM canonical.CustomerAddress)
        AS CustomerAddressCount;
'@
$counts = $countsCommand.ExecuteReader()
[void]$counts.Read()
$result = [ordered]@{
    Verdict = 'PASS'
    Behavior = 'IMPORTED'
    CustomerMasterImportRunId = $runId
    PackageSha256 = $manifest.packageSha256
    CustomerCount = $counts.GetInt64(0)
    CustomerAddressCount = $counts.GetInt64(1)
}
$counts.Close()
$connection.Dispose()
$result | ConvertTo-Json
