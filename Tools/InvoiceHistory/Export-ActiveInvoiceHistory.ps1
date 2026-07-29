[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $RunRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$approvedRoot = [IO.Path]::GetFullPath(
    'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Runs')
$resolvedRoot = [IO.Path]::GetFullPath($RunRoot)
if (
    -not $resolvedRoot.StartsWith(
        $approvedRoot + '\',
        [StringComparison]::OrdinalIgnoreCase)
) {
    throw 'The active export path is outside the fixed refresh root.'
}
$output = Join-Path $resolvedRoot 'Active'
New-Item -ItemType Directory -Path $output -Force | Out-Null

$connection = [Data.SqlClient.SqlConnection]::new(
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Invoice History Refresh Comparison')
$connection.Open()
try {
    $queries = [ordered]@{
        'CustomerInvoice.csv' = @'
SELECT
 FirmId,ArType,CustomerNumber,InvoiceNumber,
 CONVERT(char(10),InvoiceDate,23) InvoiceDate,
 CustomerName,CustomerNameResolutionType,
 AccountsReceivablePurchaseOrderNumber,SalesOrderNumber,
 SourceFile,SourceKeyRaw,SourceRecordHash
FROM canonical.CustomerInvoice
ORDER BY FirmId,ArType,CustomerNumber,InvoiceNumber;
'@
        'CustomerInvoiceLine.csv' = @'
SELECT
 FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceLineNumber,
 CONVERT(char(10),InvoiceDate,23) InvoiceDate,
 SalesOrderNumber,SalesOrderLineNumber,LineCode,ItemNumber,
 ItemDescription,ItemDescriptionResolutionType,
 CONVERT(char(10),EstimatedShipDate,23) EstimatedShipDate,
 OnTimeIndicator,QuantityShipped,UnitPrice,ExtendedPrice,
 WorkOrderNumber,WorkOrderResolutionStatus,WorkOrderCandidateCount,
 BillNumber,BomRevision,DrawingNumber,DrawingRevision,RevisionCode,
 ManufacturingResolutionType,SourceFile,SourceKeyRaw,SourceRecordHash
FROM canonical.CustomerInvoiceLine
ORDER BY
 FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceLineNumber;
'@
    }
    foreach ($entry in $queries.GetEnumerator()) {
        $command = $connection.CreateCommand()
        $command.CommandText = $entry.Value
        $command.CommandTimeout = 180
        $table = [Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        $rows = foreach ($row in $table.Rows) {
            $object = [ordered]@{}
            foreach ($column in $table.Columns) {
                $object[$column.ColumnName] = if (
                    $row.IsNull($column.ColumnName)
                ) { '' } else { $row[$column.ColumnName] }
            }
            [pscustomobject]$object
        }
        $rows | Export-Csv -LiteralPath (
            Join-Path $output $entry.Key) -NoTypeInformation -Encoding UTF8
    }
}
finally {
    $connection.Dispose()
}

[pscustomobject]@{
    Verdict = 'PASS'
    HeaderPath = Join-Path $output 'CustomerInvoice.csv'
    LinePath = Join-Path $output 'CustomerInvoiceLine.csv'
    SourceDatabase = 'DLE_OS_CANONICAL_LIVE'
    Access = 'SELECT_ONLY'
} | ConvertTo-Json
