[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $PackagePath,

    [switch] $QualificationInduceFailure,

    [switch] $QualificationAllowFixture
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedRoot = [IO.Path]::GetFullPath(
    'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Runs')
$packageRoot = [IO.Path]::GetFullPath($PackagePath)
if (
    -not $packageRoot.StartsWith(
        $approvedRoot + '\',
        [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $packageRoot) -ne 'Package'
) {
    throw 'The refresh package path is outside the fixed allowlist.'
}

$manifestPath = Join-Path $packageRoot 'manifest.json'
$hashesPath = Join-Path $packageRoot 'hashes.csv'
$headerPath = Join-Path $packageRoot 'Canonical\CustomerInvoice.csv'
$linePath = Join-Path $packageRoot 'Canonical\CustomerInvoiceLine.csv'
$comparisonPath = Join-Path $packageRoot 'Evidence\comparison.csv'
foreach ($path in @(
    $manifestPath, $hashesPath, $headerPath, $linePath, $comparisonPath
)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required package file is missing: $path"
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (
    $manifest.schema -ne 'DLE_INVOICE_HISTORY_REFRESH_V1' -or
    [int]$manifest.schemaVersion -ne 1 -or
    $manifest.contractVersion -ne '1.2' -or
    $manifest.dataEnvironment -ne 'LIVE' -or
    $manifest.runId -notmatch (
        '^INVOICEHISTORYREFRESH-\d{8}T\d{6}Z-[0-9A-F]{8}$') -or
    $manifest.packageContentSha256 -notmatch '^[0-9A-F]{64}$' -or
    $manifest.verdict -notin @('PASS', 'PASS WITH CLARIFICATIONS') -or
    -not [bool]$manifest.missingRowsRetained
) {
    throw 'The package manifest is outside the governed refresh boundary.'
}
if (
    $manifest.PSObject.Properties['qualificationFixture'] -and
    [bool]$manifest.qualificationFixture -and
    -not $QualificationAllowFixture
) {
    throw 'A qualification fixture requires the explicit fixture switch.'
}

foreach ($entry in Import-Csv -LiteralPath $hashesPath) {
    $file = [IO.Path]::GetFullPath(
        (Join-Path $packageRoot $entry.RelativePath))
    if (
        -not $file.StartsWith(
            $packageRoot + '\',
            [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $file -PathType Leaf)
    ) {
        throw "Invalid package hash entry: $($entry.RelativePath)"
    }
    if (
        (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne
        $entry.Sha256
    ) {
        throw "Package hash mismatch: $($entry.RelativePath)"
    }
}

$contentMaterial = foreach ($relative in @(
    'Canonical/CustomerInvoice.csv',
    'Canonical/CustomerInvoiceLine.csv',
    'Evidence/comparison.csv'
)) {
    $path = Join-Path $packageRoot ($relative -replace '/', '\')
    "$relative|$((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash)"
}
$algorithm = [Security.Cryptography.SHA256]::Create()
try {
    $material = ($contentMaterial -join "`n") + "`n"
    $actualContentHash = (
        [BitConverter]::ToString(
            $algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($material)))
    ).Replace('-', '')
}
finally {
    $algorithm.Dispose()
}
if ($actualContentHash -cne $manifest.packageContentSha256) {
    throw 'The package content hash does not match the manifest.'
}

$headers = @(Import-Csv -LiteralPath $headerPath)
$lines = @(Import-Csv -LiteralPath $linePath)
if (
    $headers.Count -ne [int]$manifest.counts.CustomerInvoice -or
    $lines.Count -ne [int]$manifest.counts.CustomerInvoiceLine
) {
    throw 'Candidate entity counts do not match the manifest.'
}

function Get-ManifestCount {
    param([object] $Counts, [string] $Name)
    $property = $Counts.PSObject.Properties[$Name]
    if ($null -eq $property) { return 0 }
    return [int]$property.Value
}

$expected = [ordered]@{
    HeaderInsert = Get-ManifestCount $manifest.headerClassifications 'Insert'
    HeaderUpdate = Get-ManifestCount $manifest.headerClassifications 'Update'
    HeaderUnchanged =
        Get-ManifestCount $manifest.headerClassifications 'Unchanged'
    HeaderMissing =
        Get-ManifestCount $manifest.headerClassifications 'MissingFromSource'
    LineInsert = Get-ManifestCount $manifest.lineClassifications 'Insert'
    LineUpdate = Get-ManifestCount $manifest.lineClassifications 'Update'
    LineUnchanged =
        Get-ManifestCount $manifest.lineClassifications 'Unchanged'
    LineMissing =
        Get-ManifestCount $manifest.lineClassifications 'MissingFromSource'
}

function New-DataTable {
    param(
        [object[]] $Rows,
        [System.Collections.IDictionary] $Columns
    )
    $table = [Data.DataTable]::new()
    foreach ($name in $Columns.Keys) {
        [void]$table.Columns.Add($name, $Columns[$name])
    }
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
            else {
                $row[$name] = $value
            }
        }
        [void]$table.Rows.Add($row)
    }
    return ,$table
}

function New-Command {
    param(
        [Data.SqlClient.SqlConnection] $Connection,
        [Data.SqlClient.SqlTransaction] $Transaction,
        [string] $Text
    )
    $command = $Connection.CreateCommand()
    $command.Transaction = $Transaction
    $command.CommandTimeout = 180
    $command.CommandText = $Text
    return $command
}

function Write-Bulk {
    param(
        [Data.SqlClient.SqlConnection] $Connection,
        [Data.SqlClient.SqlTransaction] $Transaction,
        [Data.DataTable] $Table,
        [string] $Destination
    )
    $bulk = [Data.SqlClient.SqlBulkCopy]::new(
        $Connection,
        [Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints,
        $Transaction)
    try {
        $bulk.DestinationTableName = $Destination
        $bulk.BulkCopyTimeout = 180
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

$headerRows = foreach ($source in $headers) {
    [pscustomobject]@{
        FirmId = $source.FirmId
        ArType = $source.ArType
        CustomerNumber = $source.CustomerNumber
        InvoiceNumber = $source.InvoiceNumber
        InvoiceDate = [DateTime]$source.InvoiceDate
        CustomerName = $source.CustomerName
        CustomerNameResolutionType = $source.CustomerNameResolutionType
        AccountsReceivablePurchaseOrderNumber =
            $source.AccountsReceivablePurchaseOrderNumber
        SalesOrderNumber = $source.SalesOrderNumber
        SourceFile = $source.SourceFile
        SourceKeyRaw = $source.SourceKeyRaw
        SourceRecordHash = $source.SourceRecordHash
    }
}
$lineRows = foreach ($source in $lines) {
    [pscustomobject]@{
        FirmId = $source.FirmId
        ArType = $source.ArType
        CustomerNumber = $source.CustomerNumber
        InvoiceNumber = $source.InvoiceNumber
        InvoiceLineNumber = $source.InvoiceLineNumber
        InvoiceDate = [DateTime]$source.InvoiceDate
        SalesOrderNumber = $source.SalesOrderNumber
        SalesOrderLineNumber = $source.SalesOrderLineNumber
        LineCode = $source.LineCode
        ItemNumber = $source.ItemNumber
        ItemDescription = $source.ItemDescription
        ItemDescriptionResolutionType =
            $source.ItemDescriptionResolutionType
        EstimatedShipDate = if ($source.EstimatedShipDate) {
            [DateTime]$source.EstimatedShipDate
        } else { $null }
        OnTimeIndicator = $source.OnTimeIndicator
        QuantityShipped = [decimal]$source.QuantityShipped
        UnitPrice = [decimal]$source.UnitPrice
        ExtendedPrice = [decimal]$source.ExtendedPrice
        WorkOrderNumber = $source.WorkOrderNumber
        WorkOrderResolutionStatus = $source.WorkOrderResolutionStatus
        WorkOrderCandidateCount = [int]$source.WorkOrderCandidateCount
        BillNumber = $source.BillNumber
        BomRevision = $source.BomRevision
        DrawingNumber = $source.DrawingNumber
        DrawingRevision = $source.DrawingRevision
        RevisionCode = $source.RevisionCode
        ManufacturingResolutionType =
            $source.ManufacturingResolutionType
        SourceFile = $source.SourceFile
        SourceKeyRaw = $source.SourceKeyRaw
        SourceRecordHash = $source.SourceRecordHash
    }
}

$connection = [Data.SqlClient.SqlConnection]::new(
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Invoice History Refresh Importer')
$connection.Open()
$transaction = $connection.BeginTransaction(
    [Data.IsolationLevel]::Serializable)
$refreshRunId = [Guid]::NewGuid()
try {
    $setup = New-Command $connection $transaction @'
IF OBJECT_ID(N'platform.InvoiceHistoryRefreshRun', N'U') IS NULL
    THROW 51020, 'Invoice History refresh schema is not installed.', 1;

CREATE TABLE #CandidateHeader
(
    FirmId char(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
    ArType char(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
    CustomerNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
    InvoiceNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
    InvoiceDate date NOT NULL,
    CustomerName nvarchar(30) NULL,
    CustomerNameResolutionType nvarchar(32) NOT NULL,
    AccountsReceivablePurchaseOrderNumber nvarchar(10) NULL,
    SalesOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NULL,
    SourceFile nvarchar(16) NOT NULL,
    SourceKeyRaw nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    SourceRecordHash char(64) NOT NULL,
    PRIMARY KEY (FirmId,ArType,CustomerNumber,InvoiceNumber)
);
CREATE TABLE #CandidateLine
(
    FirmId char(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
    ArType char(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
    CustomerNumber nvarchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL,
    InvoiceNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NOT NULL,
    InvoiceLineNumber nvarchar(3) COLLATE Latin1_General_100_BIN2 NOT NULL,
    InvoiceDate date NOT NULL,
    SalesOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NULL,
    SalesOrderLineNumber nvarchar(3) COLLATE Latin1_General_100_BIN2 NULL,
    LineCode nchar(1) NOT NULL,
    ItemNumber nvarchar(20) COLLATE Latin1_General_100_BIN2 NULL,
    ItemDescription nvarchar(60) NULL,
    ItemDescriptionResolutionType nvarchar(32) NOT NULL,
    EstimatedShipDate date NULL,
    OnTimeIndicator nchar(1) NULL,
    QuantityShipped decimal(38,10) NOT NULL,
    UnitPrice decimal(38,10) NOT NULL,
    ExtendedPrice decimal(38,10) NOT NULL,
    WorkOrderNumber nvarchar(7) COLLATE Latin1_General_100_BIN2 NULL,
    WorkOrderResolutionStatus nvarchar(16) NOT NULL,
    WorkOrderCandidateCount int NOT NULL,
    BillNumber nvarchar(20) COLLATE Latin1_General_100_BIN2 NULL,
    BomRevision nvarchar(2) NULL,
    DrawingNumber nvarchar(25) NULL,
    DrawingRevision nvarchar(5) NULL,
    RevisionCode nvarchar(10) NULL,
    ManufacturingResolutionType nvarchar(32) NOT NULL,
    SourceFile nvarchar(16) NOT NULL,
    SourceKeyRaw nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    SourceRecordHash char(64) NOT NULL,
    PRIMARY KEY
      (FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceLineNumber)
);
'@
    [void]$setup.ExecuteNonQuery()

    $headerTable = New-DataTable $headerRows ([ordered]@{
        FirmId=[string]; ArType=[string]; CustomerNumber=[string]
        InvoiceNumber=[string]; InvoiceDate=[DateTime]
        CustomerName=[string]; CustomerNameResolutionType=[string]
        AccountsReceivablePurchaseOrderNumber=[string]
        SalesOrderNumber=[string]; SourceFile=[string]
        SourceKeyRaw=[string]; SourceRecordHash=[string]
    })
    $lineTable = New-DataTable $lineRows ([ordered]@{
        FirmId=[string]; ArType=[string]; CustomerNumber=[string]
        InvoiceNumber=[string]; InvoiceLineNumber=[string]
        InvoiceDate=[DateTime]; SalesOrderNumber=[string]
        SalesOrderLineNumber=[string]; LineCode=[string]
        ItemNumber=[string]; ItemDescription=[string]
        ItemDescriptionResolutionType=[string]
        EstimatedShipDate=[DateTime]; OnTimeIndicator=[string]
        QuantityShipped=[decimal]; UnitPrice=[decimal]
        ExtendedPrice=[decimal]; WorkOrderNumber=[string]
        WorkOrderResolutionStatus=[string]; WorkOrderCandidateCount=[int]
        BillNumber=[string]; BomRevision=[string]; DrawingNumber=[string]
        DrawingRevision=[string]; RevisionCode=[string]
        ManufacturingResolutionType=[string]; SourceFile=[string]
        SourceKeyRaw=[string]; SourceRecordHash=[string]
    })
    Write-Bulk $connection $transaction $headerTable '#CandidateHeader'
    Write-Bulk $connection $transaction $lineTable '#CandidateLine'

    $compare = New-Command $connection $transaction @'
DECLARE @WindowStart date=@PWindowStart, @WindowEnd date=@PWindowEnd;
DECLARE @CurrentImportRunId uniqueidentifier =
(
    SELECT TOP (1) InvoiceHistoryImportRunId
    FROM platform.InvoiceHistoryImportRun
    WHERE IsCommitted=1 AND ImportStatus=N'SUCCESS'
    ORDER BY ActivatedAtUtc DESC
);
IF @CurrentImportRunId IS NULL
    THROW 51021, 'No committed Invoice History baseline exists.', 1;

SELECT
  (SELECT COUNT(*) FROM #CandidateHeader s
   LEFT JOIN canonical.CustomerInvoice t
     ON t.FirmId=s.FirmId AND t.ArType=s.ArType
    AND t.CustomerNumber=s.CustomerNumber
    AND t.InvoiceNumber=s.InvoiceNumber
   WHERE t.InvoiceNumber IS NULL) HeaderInsert,
  (SELECT COUNT(*) FROM #CandidateHeader s
   JOIN canonical.CustomerInvoice t
     ON t.FirmId=s.FirmId AND t.ArType=s.ArType
    AND t.CustomerNumber=s.CustomerNumber
    AND t.InvoiceNumber=s.InvoiceNumber
   WHERE t.InvoiceDate<>s.InvoiceDate
      OR ISNULL(t.CustomerName,N'')<>ISNULL(s.CustomerName,N'')
      OR t.CustomerNameResolutionType<>s.CustomerNameResolutionType
      OR ISNULL(t.AccountsReceivablePurchaseOrderNumber,N'')
         <>ISNULL(s.AccountsReceivablePurchaseOrderNumber,N'')
      OR ISNULL(t.SalesOrderNumber,N'')<>ISNULL(s.SalesOrderNumber,N'')
      OR t.SourceRecordHash<>s.SourceRecordHash) HeaderUpdate,
  (SELECT COUNT(*) FROM canonical.CustomerInvoice t
   WHERE t.InvoiceDate BETWEEN @WindowStart AND @WindowEnd
     AND NOT EXISTS
       (SELECT 1 FROM #CandidateHeader s
        WHERE t.FirmId=s.FirmId AND t.ArType=s.ArType
          AND t.CustomerNumber=s.CustomerNumber
          AND t.InvoiceNumber=s.InvoiceNumber)) HeaderMissing,
  (SELECT COUNT(*) FROM #CandidateLine s
   LEFT JOIN canonical.CustomerInvoiceLine t
     ON t.FirmId=s.FirmId AND t.ArType=s.ArType
    AND t.CustomerNumber=s.CustomerNumber
    AND t.InvoiceNumber=s.InvoiceNumber
    AND t.InvoiceLineNumber=s.InvoiceLineNumber
   WHERE t.InvoiceNumber IS NULL) LineInsert,
  (SELECT COUNT(*) FROM #CandidateLine s
   JOIN canonical.CustomerInvoiceLine t
     ON t.FirmId=s.FirmId AND t.ArType=s.ArType
    AND t.CustomerNumber=s.CustomerNumber
    AND t.InvoiceNumber=s.InvoiceNumber
    AND t.InvoiceLineNumber=s.InvoiceLineNumber
   WHERE t.InvoiceDate<>s.InvoiceDate
      OR ISNULL(t.SalesOrderNumber,N'')<>ISNULL(s.SalesOrderNumber,N'')
      OR ISNULL(t.SalesOrderLineNumber,N'')
         <>ISNULL(s.SalesOrderLineNumber,N'')
      OR t.LineCode<>s.LineCode
      OR ISNULL(t.ItemNumber,N'')<>ISNULL(s.ItemNumber,N'')
      OR ISNULL(t.ItemDescription,N'')<>ISNULL(s.ItemDescription,N'')
      OR t.ItemDescriptionResolutionType<>s.ItemDescriptionResolutionType
      OR ISNULL(t.EstimatedShipDate,'19000101')
         <>ISNULL(s.EstimatedShipDate,'19000101')
      OR ISNULL(t.OnTimeIndicator,N'')<>ISNULL(s.OnTimeIndicator,N'')
      OR t.QuantityShipped<>s.QuantityShipped
      OR t.UnitPrice<>s.UnitPrice OR t.ExtendedPrice<>s.ExtendedPrice
      OR ISNULL(t.WorkOrderNumber,N'')<>ISNULL(s.WorkOrderNumber,N'')
      OR t.WorkOrderResolutionStatus<>s.WorkOrderResolutionStatus
      OR t.WorkOrderCandidateCount<>s.WorkOrderCandidateCount
      OR ISNULL(t.BillNumber,N'')<>ISNULL(s.BillNumber,N'')
      OR ISNULL(t.BomRevision,N'')<>ISNULL(s.BomRevision,N'')
      OR ISNULL(t.DrawingNumber,N'')<>ISNULL(s.DrawingNumber,N'')
      OR ISNULL(t.DrawingRevision,N'')<>ISNULL(s.DrawingRevision,N'')
      OR ISNULL(t.RevisionCode,N'')<>ISNULL(s.RevisionCode,N'')
      OR t.ManufacturingResolutionType<>s.ManufacturingResolutionType
      OR t.SourceRecordHash<>s.SourceRecordHash) LineUpdate,
  (SELECT COUNT(*) FROM canonical.CustomerInvoiceLine t
   WHERE t.InvoiceDate BETWEEN @WindowStart AND @WindowEnd
     AND NOT EXISTS
       (SELECT 1 FROM #CandidateLine s
        WHERE t.FirmId=s.FirmId AND t.ArType=s.ArType
          AND t.CustomerNumber=s.CustomerNumber
          AND t.InvoiceNumber=s.InvoiceNumber
          AND t.InvoiceLineNumber=s.InvoiceLineNumber)) LineMissing,
  @CurrentImportRunId CurrentImportRunId;
'@
    [void]$compare.Parameters.AddWithValue(
        '@PWindowStart', [DateTime]$manifest.windowStart)
    [void]$compare.Parameters.AddWithValue(
        '@PWindowEnd', [DateTime]$manifest.windowEnd)
    $result = [Data.DataTable]::new()
    $result.Load($compare.ExecuteReader())
    $actual = $result.Rows[0]
    $actualHeaderUnchanged =
        $headers.Count - [int]$actual.HeaderInsert - [int]$actual.HeaderUpdate
    $actualLineUnchanged =
        $lines.Count - [int]$actual.LineInsert - [int]$actual.LineUpdate
    foreach ($pair in @{
        HeaderInsert=[int]$actual.HeaderInsert
        HeaderUpdate=[int]$actual.HeaderUpdate
        HeaderUnchanged=$actualHeaderUnchanged
        HeaderMissing=[int]$actual.HeaderMissing
        LineInsert=[int]$actual.LineInsert
        LineUpdate=[int]$actual.LineUpdate
        LineUnchanged=$actualLineUnchanged
        LineMissing=[int]$actual.LineMissing
    }.GetEnumerator()) {
        if ([int]$expected[$pair.Key] -ne [int]$pair.Value) {
            throw (
                "SQL comparison mismatch for $($pair.Key): " +
                "manifest=$($expected[$pair.Key]), SQL=$($pair.Value)")
        }
    }

    if ($QualificationInduceFailure) {
        $failure = New-Command $connection $transaction @'
UPDATE TOP (1) canonical.CustomerInvoiceLine
SET UpdatedAtUtc=DATEADD(millisecond,1,UpdatedAtUtc);
THROW 51022, 'Controlled Invoice History refresh rollback qualification.', 1;
'@
        [void]$failure.ExecuteNonQuery()
    }

    $apply = New-Command $connection $transaction @'
INSERT platform.InvoiceHistoryRefreshRun
(
 InvoiceHistoryRefreshRunId,RefreshExecutionRunId,PackageContentHash,
 PackageManifestHash,WindowStart,WindowEnd,StartedAtUtc,RefreshStatus,
 IsCommitted,HeaderInsertCount,HeaderUpdateCount,HeaderUnchangedCount,
 HeaderMissingCount,LineInsertCount,LineUpdateCount,LineUnchangedCount,
 LineMissingCount,CandidateHeaderCount,CandidateLineCount,
 SourceArt03Identity,SourceArt13Identity
)
VALUES
(
 @RefreshRunId,@ExecutionRunId,@PackageHash,@ManifestHash,@WindowStart,
 @WindowEnd,SYSUTCDATETIME(),N'PENDING',0,@HeaderInsert,@HeaderUpdate,
 @HeaderUnchanged,@HeaderMissing,@LineInsert,@LineUpdate,@LineUnchanged,
 @LineMissing,@CandidateHeader,@CandidateLine,@Art03,@Art13
);

DECLARE @CurrentImportRunId uniqueidentifier =
(
 SELECT TOP (1) InvoiceHistoryImportRunId
 FROM platform.InvoiceHistoryImportRun
 WHERE IsCommitted=1 AND ImportStatus=N'SUCCESS'
 ORDER BY ActivatedAtUtc DESC
);

UPDATE target SET
 InvoiceDate=source.InvoiceDate,CustomerName=source.CustomerName,
 CustomerNameResolutionType=source.CustomerNameResolutionType,
 AccountsReceivablePurchaseOrderNumber=
   source.AccountsReceivablePurchaseOrderNumber,
 SalesOrderNumber=source.SalesOrderNumber,SourceFile=source.SourceFile,
 SourceRecordHash=source.SourceRecordHash,
 LastInvoiceHistoryRefreshRunId=@RefreshRunId,
 UpdatedAtUtc=SYSUTCDATETIME()
FROM canonical.CustomerInvoice target
JOIN #CandidateHeader source
 ON target.FirmId=source.FirmId AND target.ArType=source.ArType
AND target.CustomerNumber=source.CustomerNumber
AND target.InvoiceNumber=source.InvoiceNumber
WHERE target.InvoiceDate<>source.InvoiceDate
 OR ISNULL(target.CustomerName,N'')<>ISNULL(source.CustomerName,N'')
 OR target.CustomerNameResolutionType<>source.CustomerNameResolutionType
 OR ISNULL(target.AccountsReceivablePurchaseOrderNumber,N'')
    <>ISNULL(source.AccountsReceivablePurchaseOrderNumber,N'')
 OR ISNULL(target.SalesOrderNumber,N'')<>ISNULL(source.SalesOrderNumber,N'')
 OR target.SourceRecordHash<>source.SourceRecordHash;

INSERT canonical.CustomerInvoice
(
 FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceDate,CustomerName,
 CustomerNameResolutionType,AccountsReceivablePurchaseOrderNumber,
 SalesOrderNumber,SourceFile,SourceKeyRaw,SourceRecordHash,
 InvoiceHistoryImportRunId,LastInvoiceHistoryRefreshRunId
)
SELECT
 source.FirmId,source.ArType,source.CustomerNumber,source.InvoiceNumber,
 source.InvoiceDate,source.CustomerName,source.CustomerNameResolutionType,
 source.AccountsReceivablePurchaseOrderNumber,source.SalesOrderNumber,
 source.SourceFile,source.SourceKeyRaw,source.SourceRecordHash,
 @CurrentImportRunId,@RefreshRunId
FROM #CandidateHeader source
WHERE NOT EXISTS
(
 SELECT 1 FROM canonical.CustomerInvoice target
 WHERE target.FirmId=source.FirmId AND target.ArType=source.ArType
 AND target.CustomerNumber=source.CustomerNumber
 AND target.InvoiceNumber=source.InvoiceNumber
);

UPDATE target SET
 InvoiceDate=source.InvoiceDate,SalesOrderNumber=source.SalesOrderNumber,
 SalesOrderLineNumber=source.SalesOrderLineNumber,LineCode=source.LineCode,
 ItemNumber=source.ItemNumber,ItemDescription=source.ItemDescription,
 ItemDescriptionResolutionType=source.ItemDescriptionResolutionType,
 EstimatedShipDate=source.EstimatedShipDate,
 OnTimeIndicator=source.OnTimeIndicator,
 QuantityShipped=source.QuantityShipped,UnitPrice=source.UnitPrice,
 ExtendedPrice=source.ExtendedPrice,WorkOrderNumber=source.WorkOrderNumber,
 WorkOrderResolutionStatus=source.WorkOrderResolutionStatus,
 WorkOrderCandidateCount=source.WorkOrderCandidateCount,
 BillNumber=source.BillNumber,BomRevision=source.BomRevision,
 DrawingNumber=source.DrawingNumber,DrawingRevision=source.DrawingRevision,
 RevisionCode=source.RevisionCode,
 ManufacturingResolutionType=source.ManufacturingResolutionType,
 SourceFile=source.SourceFile,SourceRecordHash=source.SourceRecordHash,
 LastInvoiceHistoryRefreshRunId=@RefreshRunId,
 UpdatedAtUtc=SYSUTCDATETIME()
FROM canonical.CustomerInvoiceLine target
JOIN #CandidateLine source
 ON target.FirmId=source.FirmId AND target.ArType=source.ArType
AND target.CustomerNumber=source.CustomerNumber
AND target.InvoiceNumber=source.InvoiceNumber
AND target.InvoiceLineNumber=source.InvoiceLineNumber
WHERE target.SourceRecordHash<>source.SourceRecordHash
 OR target.InvoiceDate<>source.InvoiceDate
 OR ISNULL(target.SalesOrderNumber,N'')<>ISNULL(source.SalesOrderNumber,N'')
 OR ISNULL(target.SalesOrderLineNumber,N'')
    <>ISNULL(source.SalesOrderLineNumber,N'')
 OR target.LineCode<>source.LineCode
 OR ISNULL(target.ItemNumber,N'')<>ISNULL(source.ItemNumber,N'')
 OR ISNULL(target.ItemDescription,N'')<>ISNULL(source.ItemDescription,N'')
 OR target.ItemDescriptionResolutionType<>source.ItemDescriptionResolutionType
 OR ISNULL(target.EstimatedShipDate,'19000101')
    <>ISNULL(source.EstimatedShipDate,'19000101')
 OR ISNULL(target.OnTimeIndicator,N'')<>ISNULL(source.OnTimeIndicator,N'')
 OR target.QuantityShipped<>source.QuantityShipped
 OR target.UnitPrice<>source.UnitPrice
 OR target.ExtendedPrice<>source.ExtendedPrice
 OR ISNULL(target.WorkOrderNumber,N'')<>ISNULL(source.WorkOrderNumber,N'')
 OR target.WorkOrderResolutionStatus<>source.WorkOrderResolutionStatus
 OR target.WorkOrderCandidateCount<>source.WorkOrderCandidateCount
 OR ISNULL(target.BillNumber,N'')<>ISNULL(source.BillNumber,N'')
 OR ISNULL(target.BomRevision,N'')<>ISNULL(source.BomRevision,N'')
 OR ISNULL(target.DrawingNumber,N'')<>ISNULL(source.DrawingNumber,N'')
 OR ISNULL(target.DrawingRevision,N'')<>ISNULL(source.DrawingRevision,N'')
 OR ISNULL(target.RevisionCode,N'')<>ISNULL(source.RevisionCode,N'')
 OR target.ManufacturingResolutionType<>source.ManufacturingResolutionType;

INSERT canonical.CustomerInvoiceLine
(
 FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceLineNumber,InvoiceDate,
 SalesOrderNumber,SalesOrderLineNumber,LineCode,ItemNumber,ItemDescription,
 ItemDescriptionResolutionType,EstimatedShipDate,OnTimeIndicator,
 QuantityShipped,UnitPrice,ExtendedPrice,WorkOrderNumber,
 WorkOrderResolutionStatus,WorkOrderCandidateCount,BillNumber,BomRevision,
 DrawingNumber,DrawingRevision,RevisionCode,ManufacturingResolutionType,
 SourceFile,SourceKeyRaw,SourceRecordHash,InvoiceHistoryImportRunId,
 LastInvoiceHistoryRefreshRunId
)
SELECT
 source.FirmId,source.ArType,source.CustomerNumber,source.InvoiceNumber,
 source.InvoiceLineNumber,source.InvoiceDate,source.SalesOrderNumber,
 source.SalesOrderLineNumber,source.LineCode,source.ItemNumber,
 source.ItemDescription,source.ItemDescriptionResolutionType,
 source.EstimatedShipDate,source.OnTimeIndicator,source.QuantityShipped,
 source.UnitPrice,source.ExtendedPrice,source.WorkOrderNumber,
 source.WorkOrderResolutionStatus,source.WorkOrderCandidateCount,
 source.BillNumber,source.BomRevision,source.DrawingNumber,
 source.DrawingRevision,source.RevisionCode,
 source.ManufacturingResolutionType,source.SourceFile,source.SourceKeyRaw,
 source.SourceRecordHash,@CurrentImportRunId,@RefreshRunId
FROM #CandidateLine source
WHERE NOT EXISTS
(
 SELECT 1 FROM canonical.CustomerInvoiceLine target
 WHERE target.FirmId=source.FirmId AND target.ArType=source.ArType
 AND target.CustomerNumber=source.CustomerNumber
 AND target.InvoiceNumber=source.InvoiceNumber
 AND target.InvoiceLineNumber=source.InvoiceLineNumber
);

DECLARE @ChangeCount int =
 @HeaderInsert + @HeaderUpdate + @LineInsert + @LineUpdate;
DECLARE @FinalStatus nvarchar(32) =
 CASE
  WHEN @HeaderMissing>0 OR @LineMissing>0
    THEN N'SUCCESS_WITH_CLARIFICATIONS'
  WHEN @ChangeCount=0 THEN N'NO_SOURCE_CHANGES'
  ELSE N'SUCCESS'
 END;
IF @ChangeCount>0
 UPDATE platform.InvoiceHistoryRefreshRun
 SET IsCommitted=0
 WHERE IsCommitted=1
 AND InvoiceHistoryRefreshRunId<>@RefreshRunId;
UPDATE platform.InvoiceHistoryRefreshRun
SET CompletedAtUtc=SYSUTCDATETIME(),RefreshStatus=@FinalStatus,
    IsCommitted=CASE WHEN @ChangeCount>0 THEN 1 ELSE 0 END
WHERE InvoiceHistoryRefreshRunId=@RefreshRunId;
SELECT @FinalStatus AS RefreshStatus,@ChangeCount AS ChangeCount;
'@
    [void]$apply.Parameters.AddWithValue('@RefreshRunId', $refreshRunId)
    [void]$apply.Parameters.AddWithValue(
        '@ExecutionRunId', [string]$manifest.runId)
    [void]$apply.Parameters.AddWithValue(
        '@PackageHash', [string]$manifest.packageContentSha256)
    [void]$apply.Parameters.AddWithValue(
        '@ManifestHash',
        (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash)
    [void]$apply.Parameters.AddWithValue(
        '@WindowStart', [DateTime]$manifest.windowStart)
    [void]$apply.Parameters.AddWithValue(
        '@WindowEnd', [DateTime]$manifest.windowEnd)
    foreach ($name in $expected.Keys) {
        [void]$apply.Parameters.AddWithValue(
            "@$name", [int]$expected[$name])
    }
    [void]$apply.Parameters.AddWithValue(
        '@CandidateHeader', $headers.Count)
    [void]$apply.Parameters.AddWithValue('@CandidateLine', $lines.Count)
    [void]$apply.Parameters.AddWithValue(
        '@Art03',
        [string]$manifest.sourceIdentity.art03_fin_after_hex)
    [void]$apply.Parameters.AddWithValue(
        '@Art13',
        [string]$manifest.sourceIdentity.art13_fin_after_hex)
    $outcome = [Data.DataTable]::new()
    $outcome.Load($apply.ExecuteReader())
    $transaction.Commit()
    [pscustomobject]@{
        Verdict = 'PASS'
        Result = [string]$outcome.Rows[0].RefreshStatus
        ChangeCount = [int]$outcome.Rows[0].ChangeCount
        InvoiceHistoryRefreshRunId = $refreshRunId
        InvoiceHistoryImportRunId = [Guid]$actual.CurrentImportRunId
        PackageContentHash = $manifest.packageContentSha256
        ExpectedCounts = $expected
    } | ConvertTo-Json -Depth 5
}
catch {
    if ($transaction.Connection) {
        $transaction.Rollback()
    }
    throw
}
finally {
    $transaction.Dispose()
    $connection.Dispose()
}
