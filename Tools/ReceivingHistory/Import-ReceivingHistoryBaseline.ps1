[CmdletBinding()]
param([switch] $QualificationInduceFailure)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$packageRoot = Join-Path $repository (
    'Artifacts\ReceivingHistoryPlatform001\' +
    'RECEIVINGHISTORYPLATFORM001-20260730T030741Z\BaselinePackage')
$database = 'DLE_OS_CANONICAL_LIVE'
$server = 'lpc:.\SQLEXPRESS'
$manifestPath = Join-Path $packageRoot 'manifest.json'
$metadataPath = Join-Path $packageRoot 'metadata.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json

if (
    $manifest.Contract -cne 'RECEIVING_HISTORY_CANONICAL_V1' -or
    $metadata.Contract -cne 'RECEIVING_HISTORY_CANONICAL_V1' -or
    [int]$metadata.DuplicateNaturalKeys -ne 0 -or
    [int]$metadata.OrphanLines -ne 0 -or
    [int]$metadata.HeadersWithoutLines -ne 4 -or
    [int]$metadata.Population.HeadersWithoutLines -ne 4 -or
    [int]$metadata.Population.ExpectedHeadersWithoutLines -ne 4 -or
    [int]$metadata.Population.MalformedOrderDates -ne 5 -or
    [int]$metadata.Population.ExpectedMalformedOrderDates -ne 5 -or
    [int]$metadata.Population.MalformedReceiptDates -ne 1 -or
    [int]$metadata.Population.ExpectedMalformedReceiptDates -ne 1 -or
    [int]$metadata.Population.MalformedRequiredDates -ne 26 -or
    [int]$metadata.Population.ExpectedMalformedRequiredDates -ne 26 -or
    [int]$metadata.Population.BlankPurchaseOrderHeaders -ne 1 -or
    [int]$metadata.Population.ExpectedBlankPurchaseOrderHeaders -ne 1
) {
    throw 'The package is outside the qualified Receiving History boundary.'
}

$manifestHash = (
    Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
$packageHash = (
    Get-Content -LiteralPath (Join-Path $packageRoot 'package.sha256')
).Trim()
if ($packageHash -notmatch '^[0-9A-F]{64}$') {
    throw 'Invalid Receiving History package SHA-256.'
}
$calculatedPackageHash = (
    Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
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
if ($calculatedPackageHash -cne $packageHash) {
    throw 'Package SHA-256 does not match the qualified file set.'
}

$headerPath = Join-Path $packageRoot 'PurchaseReceipt.csv'
$linePath = Join-Path $packageRoot 'PurchaseReceiptLine.csv'
$rejectionPath = Join-Path $packageRoot 'ReceiptRejection.csv'
$headerRows = @(Import-Csv -LiteralPath $headerPath)
$rejectionRows = @(Import-Csv -LiteralPath $rejectionPath)
$headerCount = [int]$metadata.Counts.PurchaseReceipt
$lineCount = [int]$metadata.Counts.PurchaseReceiptLine
$rejectionCount = [int]$metadata.Counts.ReceiptRejection
if (
    $headerRows.Count -ne $headerCount -or
    $rejectionRows.Count -ne $rejectionCount
) {
    throw 'Receiving History header/rejection counts do not match metadata.'
}

$headerKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)

function Assert-DateProjection {
    param(
        [Parameter(Mandatory)] $Row,
        [Parameter(Mandatory)][string] $RawName,
        [Parameter(Mandatory)][string] $IsoName,
        [Parameter(Mandatory)][string] $StatusName,
        [Parameter(Mandatory)][string] $ReasonName,
        [Parameter(Mandatory)][string] $Key
    )
    $status = [string]$Row.$StatusName
    if ($status -eq 'InvalidSourceValue') {
        if (
            [string]::IsNullOrWhiteSpace([string]$Row.$RawName) -or
            -not [string]::IsNullOrWhiteSpace([string]$Row.$IsoName) -or
            [string]$Row.$ReasonName -notin @(
                'Decoded date exceeds qualified snapshot horizon',
                'Decoded date exceeds qualified historical/snapshot horizon')
        ) {
            throw "Invalid malformed-date projection ($RawName): $Key"
        }
    }
    elseif ($status -eq 'Resolved') {
        if ([string]::IsNullOrWhiteSpace([string]$Row.$IsoName)) {
            throw "Resolved date is missing ISO value ($IsoName): $Key"
        }
    }
    elseif ($status -eq 'BlankSourceValue') {
        if (
            -not [string]::IsNullOrWhiteSpace([string]$Row.$IsoName) -or
            -not [string]::IsNullOrWhiteSpace([string]$Row.$ReasonName)
        ) {
            throw "Blank date has unexpected resolution data ($RawName): $Key"
        }
    }
    else {
        throw "Unknown date resolution status ($StatusName): $Key"
    }
}

foreach ($row in $headerRows) {
    $key = [string]$row.SourceRecordIdentity
    if (
        [string]::IsNullOrWhiteSpace($row.FirmId) -or
        [string]::IsNullOrWhiteSpace($row.VendorNumber) -or
        [string]::IsNullOrWhiteSpace($row.ReceiverNumber) -or
        $key -notmatch '^[0-9A-F]{44}$' -or
        -not $headerKeys.Add($key)
    ) {
        throw "Invalid or duplicate PurchaseReceipt key: $key"
    }
    Assert-DateProjection -Row $row -RawName 'OrderDateRaw' `
        -IsoName 'OrderDateIso' -StatusName 'OrderDateResolutionStatus' `
        -ReasonName 'OrderDateResolutionReason' -Key $key
    Assert-DateProjection -Row $row -RawName 'ReceiptDateRaw' `
        -IsoName 'ReceiptDateIso' -StatusName 'ReceiptDateResolutionStatus' `
        -ReasonName 'ReceiptDateResolutionReason' -Key $key
    if ([string]::IsNullOrWhiteSpace($row.PurchaseOrderNumber)) {
        if ($row.PurchaseOrderResolutionStatus -cne
            'MissingRequiredSourceValue') {
            throw "Blank Purchase Order is missing its explicit status: $key"
        }
    }
    elseif ($row.PurchaseOrderResolutionStatus -ceq
        'MissingRequiredSourceValue') {
        throw "Nonblank Purchase Order has missing-source status: $key"
    }
}
$malformedOrderDateCount = @(
    $headerRows | Where-Object {
        $_.OrderDateResolutionStatus -eq 'InvalidSourceValue'
    }
).Count
if ($malformedOrderDateCount -ne 5) {
    throw 'Malformed Order Date count is outside the qualified baseline.'
}
$malformedReceiptDateCount = @(
    $headerRows | Where-Object {
        $_.ReceiptDateResolutionStatus -eq 'InvalidSourceValue'
    }
).Count
if ($malformedReceiptDateCount -ne 1) {
    throw 'Malformed Receipt Date count is outside the qualified baseline.'
}
$missingPurchaseOrderCount = @(
    $headerRows | Where-Object {
        [string]::IsNullOrWhiteSpace($_.PurchaseOrderNumber)
    }
).Count
if ($missingPurchaseOrderCount -ne 1) {
    throw 'Blank Purchase Order count is outside the qualified baseline.'
}

$lineKeys = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal)
$validatedLineCount = 0
Import-Csv -LiteralPath $linePath | ForEach-Object {
    $row = $_
    $parent = [string]$row.PurchaseReceiptSourceRecordIdentity
    $key = [string]$row.SourceRecordIdentity
    if (-not $headerKeys.Contains($parent) -or -not $lineKeys.Add($key)) {
        throw "Invalid, duplicate, or orphan PurchaseReceiptLine key: $key"
    }
    Assert-DateProjection -Row $row -RawName 'RequiredDateRaw' `
        -IsoName 'RequiredDateIso' -StatusName 'RequiredDateResolutionStatus' `
        -ReasonName 'RequiredDateResolutionReason' -Key $key
    $posted = [decimal]::Parse(
        $row.QuantityPostedSigned,
        [Globalization.CultureInfo]::InvariantCulture)
    $received = [decimal]::Parse(
        $row.QuantityReceived,
        [Globalization.CultureInfo]::InvariantCulture)
    $returned = [decimal]::Parse(
        $row.QuantityReturned,
        [Globalization.CultureInfo]::InvariantCulture)
    if (
        ($posted -ge 0 -and ($received -ne $posted -or $returned -ne 0)) -or
        ($posted -lt 0 -and ($received -ne 0 -or $returned -ne -$posted))
    ) {
        throw "Invalid signed-quantity mapping: $key"
    }
    $validatedLineCount++
}
if ($validatedLineCount -ne $lineCount) {
    throw 'Receiving History line count does not match metadata.'
}
$malformedRequiredDateCount = @(
    Import-Csv -LiteralPath $linePath | Where-Object {
        $_.RequiredDateResolutionStatus -eq 'InvalidSourceValue'
    }
).Count
if ($malformedRequiredDateCount -ne 26) {
    throw 'Malformed Required Date count is outside the qualified baseline.'
}
foreach ($row in $rejectionRows) {
    $lineKey = [string]$row.PurchaseReceiptLineSourceRecordIdentity
    if (-not $lineKeys.Contains($lineKey)) {
        throw "Orphan ReceiptRejection key: $lineKey"
    }
}

$connectionString = (
    "Server=$server;Database=$database;Integrated Security=True;" +
    'Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Receiving History Baseline Importer')
$connection = [Data.SqlClient.SqlConnection]::new($connectionString)
$connection.Open()
$identityCommand = $connection.CreateCommand()
$identityCommand.CommandText = @'
EXECUTE AS USER = N'dle_receiving_history_import_executor';
SELECT USER_NAME();
'@
$effectivePrincipal = [string]$identityCommand.ExecuteScalar()
$identityCommand.Dispose()
if ($effectivePrincipal -cne 'dle_receiving_history_import_executor') {
    $connection.Dispose()
    throw 'The Receiving History importer identity boundary was not established.'
}

function New-Command {
    param(
        [Parameter(Mandatory)][string] $Text,
        [Data.SqlClient.SqlTransaction] $Transaction
    )
    $command = $connection.CreateCommand()
    $command.CommandText = $Text
    $command.CommandTimeout = 300
    $command.Transaction = $Transaction
    return $command
}

function New-ImportTable {
    param(
        [Parameter(Mandatory)][Collections.Specialized.OrderedDictionary] $Columns
    )
    $table = [Data.DataTable]::new()
    foreach ($name in $Columns.Keys) {
        [void]$table.Columns.Add($name, $Columns[$name])
    }
    [void]$table.Columns.Add('ReceivingHistoryImportRunId', [Guid])
    return ,$table
}

function Add-ImportRow {
    param(
        [Parameter(Mandatory)][Data.DataTable] $Table,
        [Parameter(Mandatory)][Collections.Specialized.OrderedDictionary] $Columns,
        [Parameter(Mandatory)] $Source,
        [Parameter(Mandatory)][Guid] $RunId
    )
    $target = $Table.NewRow()
    foreach ($name in $Columns.Keys) {
        $value = [string]$Source.$name
        if ([string]::IsNullOrEmpty($value)) {
            $target[$name] = [DBNull]::Value
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
    $target.ReceivingHistoryImportRunId = $RunId
    [void]$Table.Rows.Add($target)
}

function Write-Bulk {
    param(
        [Parameter(Mandatory)][Data.DataTable] $Table,
        [Parameter(Mandatory)][string] $Destination,
        [Parameter(Mandatory)][Data.SqlClient.SqlTransaction] $Transaction
    )
    if ($Table.Rows.Count -eq 0) { return }
    $bulk = [Data.SqlClient.SqlBulkCopy]::new(
        $connection,
        [Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints,
        $Transaction)
    try {
        $bulk.DestinationTableName = $Destination
        $bulk.BatchSize = 5000
        $bulk.BulkCopyTimeout = 300
        foreach ($column in $Table.Columns) {
            [void]$bulk.ColumnMappings.Add(
                $column.ColumnName, $column.ColumnName)
        }
        $bulk.WriteToServer($Table)
    }
    finally {
        $bulk.Dispose()
    }
}

function Write-CsvBatches {
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][Collections.Specialized.OrderedDictionary] $Columns,
        [Parameter(Mandatory)][string] $Destination,
        [Parameter(Mandatory)][Guid] $RunId,
        [Parameter(Mandatory)][Data.SqlClient.SqlTransaction] $Transaction
    )
    $table = New-ImportTable -Columns $Columns
    Import-Csv -LiteralPath $Path | ForEach-Object {
        Add-ImportRow -Table $table -Columns $Columns -Source $_ -RunId $RunId
        if ($table.Rows.Count -ge 5000) {
            Write-Bulk -Table $table -Destination $Destination `
                -Transaction $Transaction
            $table.Clear()
        }
    }
    Write-Bulk -Table $table -Destination $Destination `
        -Transaction $Transaction
    $table.Dispose()
}

$headerColumns = [ordered]@{}
foreach ($name in @(
    'FirmId', 'VendorNumber', 'PurchaseOrderNumber', 'ReceiverNumber',
    'ReceiptDateRaw', 'ReceiptDateResolutionStatus',
    'ReceiptDateResolutionReason',
    'OrderDateRaw', 'OrderDateResolutionStatus',
    'OrderDateResolutionReason', 'WarehouseId',
    'PurchasingAddressCode', 'PackingSlipNumber', 'PaymentTermsCode',
    'FreightTerms', 'ShippingMethod', 'Acknowledgment', 'Fob',
    'MessageCode', 'ReceiptStatus', 'ReceiptType', 'VendorName',
    'VendorResolutionStatus', 'PurchaseOrderResolutionStatus',
    'SourceRecordIdentity'
)) { $headerColumns[$name] = [string] }
foreach ($name in @('ReceiptDateIso', 'OrderDateIso')) {
    $headerColumns[$name] = [datetime]
}

$lineColumns = [ordered]@{}
foreach ($name in @(
    'FirmId', 'VendorNumber', 'PurchaseOrderNumber', 'ReceiverNumber',
    'ReceiptLineNumber', 'LineCode', 'LineType',
    'PurchaseOrderLineNumber', 'RequiredDateRaw',
    'RequiredDateResolutionStatus', 'RequiredDateResolutionReason',
    'UnitOfMeasure',
    'InventoryLocation', 'WarehouseId', 'ItemNumber', 'ItemDescription',
    'OrderMemo', 'WorkOrderNumber', 'SalesOrderNumber',
    'SalesOrderLineNumber', 'QuantityDispositionStatus',
    'InspectionStatus', 'PurchaseOrderResolutionStatus',
    'InventoryResolutionStatus', 'WorkOrderResolutionStatus',
    'PurchaseReceiptSourceRecordIdentity',
    'SourceRecordIdentity'
)) { $lineColumns[$name] = [string] }
foreach ($name in @('ReceiptDateIso', 'RequiredDateIso')) {
    $lineColumns[$name] = [datetime]
}
foreach ($name in @(
    'QuantityPostedSigned', 'QuantityReceived', 'QuantityAccepted',
    'QuantityRejected', 'QuantityReturned', 'QuantityInvoiced'
)) { $lineColumns[$name] = [decimal] }

$rejectionColumns = [ordered]@{}
foreach ($name in @(
    'FirmId', 'VendorNumber', 'PurchaseOrderNumber', 'ReceiverNumber',
    'ReceiptLineNumber', 'RejectionSequence', 'RejectionCode',
    'OperatorCode', 'ReturnAuthorizationNumber',
    'PurchaseReceiptLineSourceRecordIdentity', 'SourceRecordIdentity'
)) { $rejectionColumns[$name] = [string] }
$rejectionColumns['QuantityRejected'] = [decimal]

$transaction = $connection.BeginTransaction(
    [Data.IsolationLevel]::Serializable)
$runId = [Guid]::NewGuid()
try {
    $existingCommand = New-Command -Transaction $transaction -Text @'
SELECT TOP (1) ReceivingHistoryImportRunId
FROM platform.ReceivingHistoryImportRun AS importRun
WHERE importRun.PackageSha256 = @PackageSha256
  AND importRun.ImportStatus = N'SUCCESS'
  AND importRun.IsCommitted = 1
  AND importRun.IsNoOp = 0
  AND EXISTS
  (
      SELECT 1 FROM canonical.PurchaseReceipt AS currentHeader
      WHERE currentHeader.ReceivingHistoryImportRunId =
            importRun.ReceivingHistoryImportRunId
  )
  AND NOT EXISTS
  (
      SELECT 1 FROM canonical.PurchaseReceipt AS otherHeader
      WHERE otherHeader.ReceivingHistoryImportRunId <>
            importRun.ReceivingHistoryImportRunId
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
            ReceivingHistoryImportRunId = $existing
            PackageSha256 = $packageHash
            HeaderCount = $headerCount; LineCount = $lineCount
            RejectionCount = $rejectionCount
            MalformedOrderDateCount = $malformedOrderDateCount
            MalformedReceiptDateCount = $malformedReceiptDateCount
            MalformedRequiredDateCount = $malformedRequiredDateCount
            MissingPurchaseOrderCount = $missingPurchaseOrderCount
            EffectiveDatabasePrincipal = $effectivePrincipal
        } | ConvertTo-Json
        $connection.Dispose()
        exit 0
    }

    $start = New-Command -Transaction $transaction -Text @'
INSERT platform.ReceivingHistoryImportRun
(
    ReceivingHistoryImportRunId, SourceQualificationRunId, PackageSha256,
    ManifestSha256, ContractVersion, StartedAtUtc, ImportStatus,
    IsCommitted, IsNoOp, HeaderCount, LineCount, RejectionCount,
    MalformedOrderDateCount, MalformedReceiptDateCount,
    MalformedRequiredDateCount, MissingPurchaseOrderCount
)
VALUES
(
    @RunId, @SourceRunId, @PackageHash, @ManifestHash, @ContractVersion,
    SYSUTCDATETIME(), N'PENDING', 0, 0, @HeaderCount, @LineCount,
    @RejectionCount, @MalformedOrderDateCount, @MalformedReceiptDateCount,
    @MalformedRequiredDateCount, @MissingPurchaseOrderCount
);
'@
    foreach ($pair in @{
        '@RunId' = $runId
        '@SourceRunId' = [string]$metadata.SourceQualificationAttempt
        '@PackageHash' = $packageHash
        '@ManifestHash' = $manifestHash
        '@ContractVersion' = [string]$metadata.Contract
        '@HeaderCount' = $headerCount
        '@LineCount' = $lineCount
        '@RejectionCount' = $rejectionCount
        '@MalformedOrderDateCount' = $malformedOrderDateCount
        '@MalformedReceiptDateCount' = $malformedReceiptDateCount
        '@MalformedRequiredDateCount' = $malformedRequiredDateCount
        '@MissingPurchaseOrderCount' = $missingPurchaseOrderCount
    }.GetEnumerator()) {
        [void]$start.Parameters.AddWithValue($pair.Key, $pair.Value)
    }
    [void]$start.ExecuteNonQuery()

    [void](New-Command -Transaction $transaction -Text @'
DELETE FROM canonical.ReceiptRejection;
DELETE FROM canonical.PurchaseReceiptLine;
DELETE FROM canonical.PurchaseReceipt;
'@).ExecuteNonQuery()
    if ($QualificationInduceFailure) {
        throw 'QUALIFICATION_INDUCED_FAILURE_AFTER_DELETE'
    }

    Write-CsvBatches -Path $headerPath -Columns $headerColumns `
        -Destination 'canonical.PurchaseReceipt' -RunId $runId `
        -Transaction $transaction
    Write-CsvBatches -Path $linePath -Columns $lineColumns `
        -Destination 'canonical.PurchaseReceiptLine' -RunId $runId `
        -Transaction $transaction
    Write-CsvBatches -Path $rejectionPath -Columns $rejectionColumns `
        -Destination 'canonical.ReceiptRejection' -RunId $runId `
        -Transaction $transaction

    $complete = New-Command -Transaction $transaction -Text @'
UPDATE platform.ReceivingHistoryImportRun
SET CompletedAtUtc = SYSUTCDATETIME(),
    ImportStatus = N'SUCCESS',
    IsCommitted = 1
WHERE ReceivingHistoryImportRunId = @RunId;
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
    (SELECT COUNT_BIG(*) FROM canonical.PurchaseReceipt),
    (SELECT COUNT_BIG(*) FROM canonical.PurchaseReceiptLine),
    (SELECT COUNT_BIG(*) FROM canonical.ReceiptRejection);
'@
$reader = $counts.ExecuteReader()
[void]$reader.Read()
$result = [ordered]@{
    Verdict = 'PASS'; Behavior = 'IMPORTED'
    ReceivingHistoryImportRunId = $runId
    PackageSha256 = $packageHash
    HeaderCount = $reader.GetInt64(0)
    LineCount = $reader.GetInt64(1)
    RejectionCount = $reader.GetInt64(2)
    MalformedOrderDateCount = $malformedOrderDateCount
    MalformedReceiptDateCount = $malformedReceiptDateCount
    MalformedRequiredDateCount = $malformedRequiredDateCount
    MissingPurchaseOrderCount = $missingPurchaseOrderCount
    EffectiveDatabasePrincipal = $effectivePrincipal
}
$reader.Close()
$connection.Dispose()
$result | ConvertTo-Json
