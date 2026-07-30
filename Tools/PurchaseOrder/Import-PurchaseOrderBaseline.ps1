[CmdletBinding()]
param([switch]$QualificationInduceFailure)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$packageRoot = Join-Path $repository (
    'Artifacts\PurchaseOrderPlatform001\' +
    'PURCHASEORDERPLATFORM001-20260729T212157Z\BaselinePackage')
$database = 'DLE_OS_CANONICAL_LIVE'
$server = 'lpc:.\SQLEXPRESS'
$manifestPath = Join-Path $packageRoot 'manifest.json'
$metadataPath = Join-Path $packageRoot 'metadata.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json

if (
    $manifest.ContractVersion -cne 'PURCHASE_ORDER_1.0' -or
    $metadata.ContractVersion -cne 'PURCHASE_ORDER_1.0' -or
    [int]$metadata.CanonicalOrphanLines -ne 0
) {
    throw 'The package is outside the qualified Purchase Order boundary.'
}
$manifestHash = (
    Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
$packageHashLine = (
    Get-Content -LiteralPath (Join-Path $packageRoot 'package.sha256')
).Trim()
if ($packageHashLine -notmatch '^([0-9A-F]{64})  manifest\.json$') {
    throw 'Invalid package.sha256 format.'
}
$packageHash = $Matches[1]
if (
    $packageHash -cne $manifestHash
) {
    throw 'Package SHA-256 does not match the manifest.'
}
foreach ($file in $manifest.Files) {
    $path = Join-Path $packageRoot ([string]$file.Path)
    if (
        -not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne
            [string]$file.Sha256
    ) {
        throw "Package file hash mismatch: $($file.Path)"
    }
}

$headers = @(Import-Csv -LiteralPath (
    Join-Path $packageRoot 'PurchaseOrder.csv'))
$lines = @(Import-Csv -LiteralPath (
    Join-Path $packageRoot 'PurchaseOrderLine.csv'))
$orphans = @(Import-Csv -LiteralPath (
    Join-Path $packageRoot 'OrphanPurchaseOrderLine.csv'))
if (
    $headers.Count -ne [int]$metadata.HeaderCount -or
    $lines.Count -ne [int]$metadata.LineCount -or
    $orphans.Count -ne [int]$metadata.SourceOrphanLinesExcluded
) {
    throw 'Package entity counts do not match metadata.'
}

$headerKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
foreach ($row in $headers) {
    $key = "$($row.FirmId)|$($row.VendorNumber)|$($row.PurchaseOrderNumber)"
    if (
        [string]::IsNullOrWhiteSpace($row.FirmId) -or
        [string]::IsNullOrWhiteSpace($row.VendorNumber) -or
        [string]::IsNullOrWhiteSpace($row.PurchaseOrderNumber) -or
        -not $headerKeys.Add($key)
    ) {
        throw "Invalid or duplicate PurchaseOrder key: $key"
    }
}
$lineKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
foreach ($row in $lines) {
    $parent = "$($row.FirmId)|$($row.VendorNumber)|$($row.PurchaseOrderNumber)"
    $key = "$parent|$($row.PurchaseOrderLineNumber)"
    if (
        -not $headerKeys.Contains($parent) -or
        -not $lineKeys.Add($key)
    ) {
        throw "Invalid, duplicate, or orphan PurchaseOrderLine key: $key"
    }
    if (
        [decimal]$row.QuantityOpen -ne
            ([decimal]$row.QuantityOrdered - [decimal]$row.QuantityReceived)
    ) {
        throw "Invalid open-quantity formula for $key"
    }
}

$connectionString = (
    "Server=$server;Database=$database;Integrated Security=True;" +
    'Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Purchase Order Baseline Importer'
)
$connection = [Data.SqlClient.SqlConnection]::new($connectionString)
$connection.Open()
$identityCommand = $connection.CreateCommand()
$identityCommand.CommandText = @'
EXECUTE AS USER = N'dle_purchase_order_import_executor';
SELECT USER_NAME();
'@
$effectiveDatabasePrincipal = [string]$identityCommand.ExecuteScalar()
$identityCommand.Dispose()
if ($effectiveDatabasePrincipal -cne 'dle_purchase_order_import_executor') {
    $connection.Dispose()
    throw 'The Purchase Order importer identity boundary was not established.'
}

function New-Command {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Data.SqlClient.SqlTransaction]$Transaction
    )
    $command = $connection.CreateCommand()
    $command.CommandText = $Text
    $command.CommandTimeout = 180
    $command.Transaction = $Transaction
    return $command
}

function New-ImportTable {
    param(
        [Parameter(Mandatory)][object[]]$Rows,
        [Parameter(Mandatory)][Collections.Specialized.OrderedDictionary]$Columns,
        [Parameter(Mandatory)][Guid]$RunId
    )
    $table = [Data.DataTable]::new()
    foreach ($name in $Columns.Keys) {
        [void]$table.Columns.Add($name, $Columns[$name])
    }
    [void]$table.Columns.Add('PurchaseOrderImportRunId', [Guid])
    foreach ($source in $Rows) {
        $target = $table.NewRow()
        foreach ($name in $Columns.Keys) {
            $value = [string]$source.$name
            if ([string]::IsNullOrEmpty($value)) {
                $target[$name] = [DBNull]::Value
            }
            elseif ($Columns[$name] -eq [bool]) {
                $target[$name] = [bool]::Parse($value)
            }
            elseif ($Columns[$name] -eq [decimal]) {
                $target[$name] = [decimal]::Parse(
                    $value, [Globalization.CultureInfo]::InvariantCulture)
            }
            elseif ($Columns[$name] -eq [datetime]) {
                $target[$name] = [datetime]::ParseExact(
                    $value, 'yyyy-MM-dd',
                    [Globalization.CultureInfo]::InvariantCulture)
            }
            else {
                $target[$name] = $value
            }
        }
        $target.PurchaseOrderImportRunId = $RunId
        [void]$table.Rows.Add($target)
    }
    return ,$table
}

function Write-Bulk {
    param(
        [Parameter(Mandatory)][Data.DataTable]$Table,
        [Parameter(Mandatory)][string]$Destination,
        [Parameter(Mandatory)][Data.SqlClient.SqlTransaction]$Transaction
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

$headerColumns = [ordered]@{}
foreach ($name in @(
    'FirmId', 'VendorNumber', 'PurchaseOrderNumber', 'VendorName',
    'WarehouseId', 'PurchasingAddressCode', 'OrderDateRaw',
    'PromisedDateRaw', 'NotBeforeDateRaw', 'RequiredDateRaw',
    'LastReceiptDateRaw', 'HoldFlag', 'PrintStatus', 'PaymentTermsCode',
    'FreightTerms', 'ShippingMethod', 'Acknowledgment', 'Fob',
    'MessageCode', 'RequisitionNumber', 'PurchaseOrderStatus',
    'VendorResolutionStatus', 'SourceRecordIdentity'
)) { $headerColumns[$name] = [string] }
foreach ($name in @(
    'OrderDateIso', 'PromisedDateIso', 'NotBeforeDateIso',
    'RequiredDateIso', 'LastReceiptDateIso'
)) { $headerColumns[$name] = [datetime] }
foreach ($name in @('IsOpen', 'IsClosed', 'IsCanceled')) {
    $headerColumns[$name] = [bool]
}

$lineColumns = [ordered]@{}
foreach ($name in @(
    'FirmId', 'VendorNumber', 'PurchaseOrderNumber',
    'PurchaseOrderLineNumber', 'LineCode', 'LineType',
    'RequiredDateRaw', 'PromisedDateRaw', 'NotBeforeDateRaw',
    'UnitOfMeasure', 'InventoryLocation', 'SourceCode', 'MessageCode',
    'WorkOrderNumber', 'CustomerNumber', 'SalesOrderNumber',
    'SalesOrderLineNumber', 'ShipToNumber', 'WarehouseId', 'ItemNumber',
    'ItemDescription', 'OrderMemo', 'LineStatus',
    'InventoryResolutionStatus', 'WorkOrderResolutionStatus',
    'SalesOrderResolutionStatus', 'SourceRecordIdentity'
)) { $lineColumns[$name] = [string] }
foreach ($name in @(
    'RequiredDateIso', 'PromisedDateIso', 'NotBeforeDateIso'
)) { $lineColumns[$name] = [datetime] }
foreach ($name in @(
    'ConversionFactor', 'QuantityRequested', 'QuantityOrdered',
    'QuantityReceived', 'QuantityOpen', 'QuantityInQualityWip',
    'QuantityAcceptedFromQuality', 'QuantityRejected', 'QuantityInvoiced'
)) { $lineColumns[$name] = [decimal] }
foreach ($name in @('IsOpen', 'IsClosed', 'IsCanceled')) {
    $lineColumns[$name] = [bool]
}

$transaction = $connection.BeginTransaction(
    [Data.IsolationLevel]::Serializable)
$runId = [Guid]::NewGuid()
try {
    $existingCommand = New-Command -Transaction $transaction -Text @'
SELECT TOP (1) PurchaseOrderImportRunId
FROM platform.PurchaseOrderImportRun AS importRun
WHERE importRun.PackageSha256 = @PackageSha256
  AND importRun.ImportStatus = N'SUCCESS'
  AND importRun.IsCommitted = 1
  AND importRun.IsNoOp = 0
  AND EXISTS
  (
      SELECT 1
      FROM canonical.PurchaseOrder AS currentHeader
      WHERE currentHeader.PurchaseOrderImportRunId =
            importRun.PurchaseOrderImportRunId
  )
  AND NOT EXISTS
  (
      SELECT 1
      FROM canonical.PurchaseOrder AS otherHeader
      WHERE otherHeader.PurchaseOrderImportRunId <>
            importRun.PurchaseOrderImportRunId
  )
ORDER BY CompletedAtUtc DESC;
'@
    [void]$existingCommand.Parameters.AddWithValue(
        '@PackageSha256', $packageHash)
    $existing = $existingCommand.ExecuteScalar()
    if ($null -ne $existing -and -not $QualificationInduceFailure) {
        $transaction.Rollback()
        [ordered]@{
            Verdict = 'PASS'; Behavior = 'NO-OP'
            PurchaseOrderImportRunId = $existing
            PackageSha256 = $packageHash
            HeaderCount = $headers.Count; LineCount = $lines.Count
            EffectiveDatabasePrincipal = $effectiveDatabasePrincipal
        } | ConvertTo-Json
        $connection.Dispose()
        exit 0
    }

    $start = New-Command -Transaction $transaction -Text @'
INSERT platform.PurchaseOrderImportRun
(
    PurchaseOrderImportRunId, SourceQualificationRunId, PackageSha256,
    ManifestSha256, ContractVersion, StartedAtUtc, ImportStatus,
    IsCommitted, IsNoOp, HeaderCount, LineCount, SourceOrphanLineCount
)
VALUES
(
    @RunId, @SourceRunId, @PackageHash, @ManifestHash, @ContractVersion,
    SYSUTCDATETIME(), N'PENDING', 0, 0, @HeaderCount, @LineCount,
    @SourceOrphanLineCount
);
'@
    foreach ($pair in @{
        '@RunId' = $runId
        '@SourceRunId' = [string]$metadata.HarnessAttemptId
        '@PackageHash' = $packageHash
        '@ManifestHash' = $manifestHash
        '@ContractVersion' = [string]$metadata.ContractVersion
        '@HeaderCount' = $headers.Count
        '@LineCount' = $lines.Count
        '@SourceOrphanLineCount' = $orphans.Count
    }.GetEnumerator()) {
        [void]$start.Parameters.AddWithValue($pair.Key, $pair.Value)
    }
    [void]$start.ExecuteNonQuery()

    [void](New-Command -Transaction $transaction -Text @'
DELETE FROM canonical.PurchaseOrderLine;
DELETE FROM canonical.PurchaseOrder;
'@).ExecuteNonQuery()
    if ($QualificationInduceFailure) {
        throw 'QUALIFICATION_INDUCED_FAILURE_AFTER_DELETE'
    }

    Write-Bulk `
        -Table (New-ImportTable -Rows $headers -Columns $headerColumns -RunId $runId) `
        -Destination 'canonical.PurchaseOrder' `
        -Transaction $transaction
    Write-Bulk `
        -Table (New-ImportTable -Rows $lines -Columns $lineColumns -RunId $runId) `
        -Destination 'canonical.PurchaseOrderLine' `
        -Transaction $transaction

    $complete = New-Command -Transaction $transaction -Text @'
UPDATE platform.PurchaseOrderImportRun
SET CompletedAtUtc = SYSUTCDATETIME(),
    ImportStatus = N'SUCCESS',
    IsCommitted = 1
WHERE PurchaseOrderImportRunId = @RunId;
'@
    [void]$complete.Parameters.AddWithValue('@RunId', $runId)
    [void]$complete.ExecuteNonQuery()
    $transaction.Commit()
}
catch {
    if ($transaction.Connection) { $transaction.Rollback() }
    $connection.Dispose()
    throw
}

$counts = New-Command -Text @'
SELECT
    (SELECT COUNT_BIG(*) FROM canonical.PurchaseOrder),
    (SELECT COUNT_BIG(*) FROM canonical.PurchaseOrderLine);
'@
$reader = $counts.ExecuteReader()
[void]$reader.Read()
$result = [ordered]@{
    Verdict = 'PASS'; Behavior = 'IMPORTED'
    PurchaseOrderImportRunId = $runId
    PackageSha256 = $packageHash
    HeaderCount = $reader.GetInt64(0)
    LineCount = $reader.GetInt64(1)
    EffectiveDatabasePrincipal = $effectiveDatabasePrincipal
}
$reader.Close()
$connection.Dispose()
$result | ConvertTo-Json
