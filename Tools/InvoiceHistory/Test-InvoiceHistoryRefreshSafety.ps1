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
    throw 'Refresh safety qualification requires non-elevated DLE-OS.'
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$artifact =
    Join-Path $repo (
        'Artifacts\InvoiceHistoryRefresh001\' +
        'INVOICEHISTORYREFRESH001-20260729T135205Z')
$runner = Join-Path $repo (
    'Tools\InvoiceHistory\Invoke-InvoiceHistoryRefresh.ps1')
$importer = Join-Path $repo (
    'Tools\InvoiceHistory\Import-InvoiceHistoryRefresh.ps1')
$package =
    'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Runs\' +
    'INVOICEHISTORYREFRESH-20260729T144540Z-0E301F3A\Package'
$lockPath =
    'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\' +
    'invoice-history-refresh.lock'

function Get-SqlState {
    $connection = [Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;')
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT
 (SELECT COUNT(*) FROM canonical.CustomerInvoice) HeaderCount,
 (SELECT COUNT(*) FROM canonical.CustomerInvoiceLine) LineCount,
 (SELECT COUNT(*) FROM platform.InvoiceHistoryRefreshRun) RefreshRunCount,
 (SELECT TOP (1) CONVERT(nvarchar(36),InvoiceHistoryImportRunId)
  FROM platform.InvoiceHistoryImportRun
  WHERE IsCommitted=1 AND ImportStatus=N'SUCCESS'
  ORDER BY ActivatedAtUtc DESC) ActiveImportRunId,
 (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(
    FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceLineNumber,
    InvoiceDate,SalesOrderNumber,SalesOrderLineNumber,LineCode,ItemNumber,
    ItemDescription,QuantityShipped,UnitPrice,ExtendedPrice,WorkOrderNumber,
    SourceRecordHash,UpdatedAtUtc))
  FROM canonical.CustomerInvoiceLine) LineChecksum;
'@
        $table = [Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        $row = $table.Rows[0]
        return [ordered]@{
            HeaderCount = [int]$row.HeaderCount
            LineCount = [int]$row.LineCount
            RefreshRunCount = [int]$row.RefreshRunCount
            ActiveImportRunId = [string]$row.ActiveImportRunId
            LineChecksum = [int]$row.LineChecksum
        }
    }
    finally {
        $connection.Dispose()
    }
}

$lock = [IO.File]::Open(
    $lockPath,
    [IO.FileMode]::CreateNew,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None)
try {
    $concurrencyOut = Join-Path $artifact 'CONCURRENCY.stdout.log'
    $concurrencyErr = Join-Path $artifact 'CONCURRENCY.stderr.log'
    $process = Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-NoLogo', '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-File', "`"$runner`"") `
        -RedirectStandardOutput $concurrencyOut `
        -RedirectStandardError $concurrencyErr `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    $concurrencyText =
        Get-Content -LiteralPath $concurrencyOut -Raw
    if (
        $process.ExitCode -ne 2 -or
        $concurrencyText -notmatch 'ALREADY_RUNNING'
    ) {
        throw 'The overlapping refresh did not fail closed.'
    }
}
finally {
    $lock.Dispose()
    Remove-Item -LiteralPath $lockPath -Force
}

$before = Get-SqlState
$rollbackError = $null
try {
    & $importer `
        -PackagePath $package `
        -QualificationInduceFailure | Out-Null
}
catch {
    $rollbackError = $_.Exception.Message
}
if ($rollbackError -notmatch 'Controlled Invoice History refresh rollback') {
    throw 'The controlled rollback failure was not observed.'
}
$after = Get-SqlState
$rollbackPassed = (
    ($before | ConvertTo-Json -Compress) -ceq
    ($after | ConvertTo-Json -Compress)
)
if (-not $rollbackPassed) {
    throw 'The active Invoice History SQL state changed after rollback.'
}

[ordered]@{
    Verdict = 'PASS'
    ExecutedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    WindowsIdentity = $identity.Name
    Elevated = $false
    ConcurrencyResult = 'ALREADY_RUNNING'
    ConcurrencyExitCode = $process.ExitCode
    RollbackResult = 'PASS'
    RollbackError = $rollbackError
    SqlBefore = $before
    SqlAfter = $after
    SourceAccess = 'NONE'
    SourceWrites = 0
} |
    ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath (
        Join-Path $artifact 'REFRESH_SAFETY_QUALIFICATION.json'
    ) -Encoding UTF8
