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
    throw 'Missing-row qualification requires non-elevated DLE-OS.'
}

$repo = 'C:\DLE-OS\Repositories\DLE-OS'
$runs = 'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\Runs'
$base = Join-Path $runs (
    'INVOICEHISTORYREFRESH-20260729T144540Z-0E301F3A\Package')
$python =
    'C:\Users\DLE-OS\.cache\codex-runtimes\codex-primary-runtime\' +
    'dependencies\python\python.exe'
$builder = Join-Path $repo (
    'Tests\InvoiceHistoryRefresh001\create_refresh_update_fixtures.py')
$importer = Join-Path $repo (
    'Tools\InvoiceHistory\Import-InvoiceHistoryRefresh.ps1')
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
function New-RunId {
    "INVOICEHISTORYREFRESH-$stamp-" +
        ([Guid]::NewGuid().ToString('N').Substring(0, 8).ToUpperInvariant())
}
$updateRun = New-RunId
$restoreRun = New-RunId
$missingRun = New-RunId
$fixture = (
    & $python $builder --base $base --runs-root $runs `
        --update-run-id $updateRun --restore-run-id $restoreRun `
        --missing-run-id $missingRun
) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw 'Missing-row fixture construction failed.'
}

$parts = $fixture.missing.naturalKey -split '\|', 5
function Get-LineCount {
    $connection = [Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;')
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT COUNT(*) FROM canonical.CustomerInvoiceLine
WHERE FirmId=@Firm AND ArType=@ArType AND CustomerNumber=@Customer
 AND InvoiceNumber=@Invoice AND InvoiceLineNumber=@Line;
'@
        [void]$command.Parameters.AddWithValue('@Firm', $parts[0])
        [void]$command.Parameters.AddWithValue('@ArType', $parts[1])
        [void]$command.Parameters.AddWithValue('@Customer', $parts[2])
        [void]$command.Parameters.AddWithValue('@Invoice', $parts[3])
        [void]$command.Parameters.AddWithValue('@Line', $parts[4])
        return [int]$command.ExecuteScalar()
    }
    finally {
        $connection.Dispose()
    }
}

$before = Get-LineCount
$result = (
    & $importer -PackagePath $fixture.missing.package `
        -QualificationAllowFixture
) | ConvertFrom-Json
$after = Get-LineCount
if (
    $before -ne 1 -or $after -ne 1 -or
    $result.Result -ne 'SUCCESS_WITH_CLARIFICATIONS' -or
    $result.ExpectedCounts.LineMissing -ne 1 -or
    $result.ChangeCount -ne 0
) {
    throw 'MissingFromSource retention qualification failed.'
}

[ordered]@{
    Verdict = 'PASS'
    WindowsIdentity = $identity.Name
    Result = $result
    NaturalKey = $fixture.missing.naturalKey
    RowCountBefore = $before
    RowCountAfter = $after
    MissingRowRetained = $true
    SourceAccess = 'NONE'
} |
    ConvertTo-Json -Depth 7 |
    Set-Content -LiteralPath (
        Join-Path $repo (
            'Artifacts\InvoiceHistoryRefresh001\' +
            'INVOICEHISTORYREFRESH001-20260729T135205Z\' +
            'MISSING_ROW_RETENTION_QUALIFICATION.json')
    ) -Encoding UTF8
