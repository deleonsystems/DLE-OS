[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (
    $identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or
    $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
) {
    throw 'Refresh promotion qualification requires non-elevated DLE-OS.'
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$python =
    'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\python\python.exe'
$fixtureBuilder = Join-Path $repo (
    'Tests\InvoiceHistoryRefresh001\create_refresh_update_fixtures.py')
$importer = Join-Path $repo (
    'Tools\InvoiceHistory\Import-InvoiceHistoryRefresh.ps1')
$runsRoot = 'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Runs'
$base = Join-Path $runsRoot (
    'INVOICEHISTORYREFRESH-20260729T144540Z-0E301F3A\Package')
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$updateRunId = "INVOICEHISTORYREFRESH-$stamp-" +
    ([Guid]::NewGuid().ToString('N').Substring(0, 8).ToUpperInvariant())
$restoreRunId = "INVOICEHISTORYREFRESH-$stamp-" +
    ([Guid]::NewGuid().ToString('N').Substring(0, 8).ToUpperInvariant())
$fixtureJson = & $python $fixtureBuilder `
    --base $base `
    --runs-root $runsRoot `
    --update-run-id $updateRunId `
    --restore-run-id $restoreRunId
if ($LASTEXITCODE -ne 0) {
    throw 'Qualification fixture construction failed.'
}
$fixture = $fixtureJson | ConvertFrom-Json
$parts = $fixture.update.naturalKey -split '\|', 5

function Open-Connection {
    $connection = [Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;')
    $connection.Open()
    return $connection
}

function Get-State {
    $connection = Open-Connection
    try {
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT
 (SELECT COUNT(*) FROM canonical.CustomerInvoice) HeaderCount,
 (SELECT COUNT(*) FROM canonical.CustomerInvoiceLine) LineCount,
 (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(
    FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceLineNumber,
    InvoiceDate,SalesOrderNumber,SalesOrderLineNumber,LineCode,ItemNumber,
    ItemDescription,QuantityShipped,UnitPrice,ExtendedPrice,WorkOrderNumber,
    SourceRecordHash))
  FROM canonical.CustomerInvoiceLine) BusinessChecksum,
 ItemDescription,
 CONVERT(nvarchar(36),LastInvoiceHistoryRefreshRunId) LastRefreshRunId,
 UpdatedAtUtc
FROM canonical.CustomerInvoiceLine
WHERE FirmId=@Firm AND ArType=@ArType AND CustomerNumber=@Customer
 AND InvoiceNumber=@Invoice AND InvoiceLineNumber=@Line;
'@
        [void]$command.Parameters.AddWithValue('@Firm', $parts[0])
        [void]$command.Parameters.AddWithValue('@ArType', $parts[1])
        [void]$command.Parameters.AddWithValue('@Customer', $parts[2])
        [void]$command.Parameters.AddWithValue('@Invoice', $parts[3])
        [void]$command.Parameters.AddWithValue('@Line', $parts[4])
        $table = [Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        $row = $table.Rows[0]
        return [ordered]@{
            HeaderCount = [int]$row.HeaderCount
            LineCount = [int]$row.LineCount
            BusinessChecksum = [int]$row.BusinessChecksum
            ItemDescription = [string]$row.ItemDescription
            LastRefreshRunId = [string]$row.LastRefreshRunId
            UpdatedAtUtc = ([DateTime]$row.UpdatedAtUtc).ToString('O')
        }
    }
    finally {
        $connection.Dispose()
    }
}

$before = Get-State
$updateResult = $null
$restoreResult = $null
try {
    $updateResult = (
        & $importer `
            -PackagePath $fixture.update.package `
            -QualificationAllowFixture
    ) | ConvertFrom-Json
    $changed = Get-State
    if (
        $updateResult.Result -ne 'SUCCESS' -or
        $changed.ItemDescription -ne $fixture.update.fixtureDescription
    ) {
        throw 'The controlled update fixture was not promoted.'
    }

    $restoreResult = (
        & $importer `
            -PackagePath $fixture.restore.package `
            -QualificationAllowFixture
    ) | ConvertFrom-Json
    $after = Get-State
    if (
        $restoreResult.Result -ne 'SUCCESS' -or
        $after.ItemDescription -ne $before.ItemDescription -or
        $after.HeaderCount -ne $before.HeaderCount -or
        $after.LineCount -ne $before.LineCount -or
        $after.BusinessChecksum -ne $before.BusinessChecksum
    ) {
        throw 'The controlled fixture was not fully restored.'
    }
}
catch {
    $connection = Open-Connection
    $transaction = $connection.BeginTransaction()
    try {
        $command = $connection.CreateCommand()
        $command.Transaction = $transaction
        $command.CommandText = @'
UPDATE canonical.CustomerInvoiceLine
SET ItemDescription=@Description,
    LastInvoiceHistoryRefreshRunId=@LastRefresh,
    UpdatedAtUtc=@UpdatedAt
WHERE FirmId=@Firm AND ArType=@ArType AND CustomerNumber=@Customer
 AND InvoiceNumber=@Invoice AND InvoiceLineNumber=@Line;
UPDATE platform.InvoiceHistoryRefreshRun SET IsCommitted=0
WHERE RefreshExecutionRunId IN (@UpdateRun,@RestoreRun);
'@
        [void]$command.Parameters.AddWithValue(
            '@Description', $before.ItemDescription)
        [void]$command.Parameters.AddWithValue(
            '@LastRefresh',
            $(if ($before.LastRefreshRunId) {
                [Guid]$before.LastRefreshRunId
            } else { [DBNull]::Value }))
        [void]$command.Parameters.AddWithValue(
            '@UpdatedAt', [DateTime]$before.UpdatedAtUtc)
        [void]$command.Parameters.AddWithValue('@Firm', $parts[0])
        [void]$command.Parameters.AddWithValue('@ArType', $parts[1])
        [void]$command.Parameters.AddWithValue('@Customer', $parts[2])
        [void]$command.Parameters.AddWithValue('@Invoice', $parts[3])
        [void]$command.Parameters.AddWithValue('@Line', $parts[4])
        [void]$command.Parameters.AddWithValue('@UpdateRun', $updateRunId)
        [void]$command.Parameters.AddWithValue('@RestoreRun', $restoreRunId)
        [void]$command.ExecuteNonQuery()
        $transaction.Commit()
    }
    catch {
        $transaction.Rollback()
        throw
    }
    finally {
        $transaction.Dispose()
        $connection.Dispose()
    }
    throw
}

[ordered]@{
    Verdict = 'PASS'
    WindowsIdentity = $identity.Name
    Elevated = $false
    NaturalKey = $fixture.update.naturalKey
    UpdateResult = $updateResult
    RestoreResult = $restoreResult
    Before = $before
    After = $after
    ActiveDatasetRestored = $true
    SourceAccess = 'NONE'
    SourceWrites = 0
} |
    ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (
        Join-Path $repo (
            'Artifacts\InvoiceHistoryRefresh001\' +
            'INVOICEHISTORYREFRESH001-20260729T135205Z\' +
            'REFRESH_PROMOTION_QUALIFICATION.json')
    ) -Encoding UTF8
