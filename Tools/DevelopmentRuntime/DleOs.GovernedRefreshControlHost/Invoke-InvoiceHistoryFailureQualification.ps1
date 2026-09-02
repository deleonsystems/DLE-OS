[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^INVOICEHISTORYQUAL-[0-9]{8}T[0-9]{6}Z-[0-9A-F]{8}$')]
    [string] $QualificationRunId,
    [Parameter(Mandatory)][string] $EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$started = [DateTimeOffset]::UtcNow
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$fixturePath = Join-Path $PSScriptRoot 'qualification-fixtures.json'
$statusPath = 'C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json'

function Get-Hash([string] $Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-SqlState {
    $connection = [Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Application Name=DLE-OS Invoice History Failure Qualification')
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
 (SELECT TOP (1) PackageContentHash
  FROM platform.InvoiceHistoryImportRun
  WHERE IsCommitted=1 AND ImportStatus=N'SUCCESS'
  ORDER BY ActivatedAtUtc DESC) PackageHash,
 (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(
    FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceDate,CustomerName,
    CustomerNameResolutionType,AccountsReceivablePurchaseOrderNumber,
    SalesOrderNumber,SourceFile,SourceKeyRaw,SourceRecordHash,UpdatedAtUtc))
  FROM canonical.CustomerInvoice) HeaderChecksum,
 (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(
    FirmId,ArType,CustomerNumber,InvoiceNumber,InvoiceLineNumber,
    InvoiceDate,SalesOrderNumber,SalesOrderLineNumber,LineCode,ItemNumber,
    ItemDescription,QuantityShipped,UnitPrice,ExtendedPrice,WorkOrderNumber,
    SourceRecordHash,UpdatedAtUtc))
  FROM canonical.CustomerInvoiceLine) LineChecksum,
 (SELECT CONVERT(nvarchar(10),MAX(InvoiceDate),23)
  FROM canonical.CustomerInvoice) NewestInvoiceDate;
'@
        $table = [Data.DataTable]::new()
        $table.Load($command.ExecuteReader())
        $row = $table.Rows[0]
        [ordered]@{
            HeaderCount = [int]$row.HeaderCount
            LineCount = [int]$row.LineCount
            RefreshRunCount = [int]$row.RefreshRunCount
            ActiveImportRunId = [string]$row.ActiveImportRunId
            PackageHash = [string]$row.PackageHash
            HeaderChecksum = [int]$row.HeaderChecksum
            LineChecksum = [int]$row.LineChecksum
            NewestInvoiceDate = [string]$row.NewestInvoiceDate
        }
    }
    finally { $connection.Dispose() }
}

$result = [ordered]@{
    Schema = 'dle-os.invoice-history-failure-qualification.v1'
    QualificationRunId = $QualificationRunId
    StartedAtUtc = $started.ToString('O')
    WindowsIdentity = $identity.Name
    AdministratorRole = $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    SourceAccess = 'NONE'
    Art03Opened = $false
    Art13Opened = $false
    SourceLocksRequested = 0
    SourceWrites = 0
    PackageCreated = $false
    CanonicalCommitAllowed = $false
    Verdict = 'FAIL'
}

try {
    if ($identity.Name -ine 'DLE-OS-HOST\DLE-OS' -or $result.AdministratorRole) {
        throw 'Failure qualification requires the non-admin DLE-OS worker token.'
    }
    $fixture = Get-Content -LiteralPath $fixturePath -Raw | ConvertFrom-Json
    if ($fixture.schema -cne 'dle-os.governed-refresh-qualification-fixtures.v1' -or
        $fixture.mode -cne 'APPROVED_FAILURE_PRESERVATION_QUALIFICATION' -or
        [bool]$fixture.canonicalCommitAllowed -or $fixture.sourceAccess -cne 'NONE') {
        throw 'The fixed qualification fixture contract was rejected.'
    }
    if ((Get-Hash ([string]$fixture.importerPath)) -cne [string]$fixture.importerSha256) {
        throw 'The qualified importer hash changed.'
    }
    $manifest = Get-Content -LiteralPath (Join-Path ([string]$fixture.packagePath) 'manifest.json') -Raw |
        ConvertFrom-Json
    if ([string]$manifest.packageContentSha256 -cne [string]$fixture.packageContentSha256) {
        throw 'The fixed qualification package identity changed.'
    }
    $result.ImporterPath = [string]$fixture.importerPath
    $result.ImporterSha256 = Get-Hash ([string]$fixture.importerPath)
    $result.PackagePath = [string]$fixture.packagePath
    $result.PackageContentSha256 = [string]$manifest.packageContentSha256
    $result.SqlBefore = Get-SqlState
    $result.StatusSha256Before = Get-Hash $statusPath
    $failure = $null
    try {
        & ([string]$fixture.importerPath) -PackagePath ([string]$fixture.packagePath) `
            -QualificationInduceFailure | Out-Null
    }
    catch { $failure = $_.Exception.Message }
    if ($failure -notmatch 'Controlled Invoice History refresh rollback qualification') {
        throw "Expected controlled rollback was not observed: $failure"
    }
    $result.ExpectedFailure = $failure
    $result.SqlAfter = Get-SqlState
    $result.StatusSha256After = Get-Hash $statusPath
    $result.SqlStateUnchanged = (($result.SqlBefore | ConvertTo-Json -Compress) -ceq
        ($result.SqlAfter | ConvertTo-Json -Compress))
    $result.StatusUnchanged = $result.StatusSha256Before -ceq $result.StatusSha256After
    if (-not $result.SqlStateUnchanged -or -not $result.StatusUnchanged) {
        throw 'The active Invoice History generation changed during controlled rollback.'
    }
    $result.SqlTransactionRolledBack = $true
    $result.Verdict = 'PASS'
}
catch {
    $result.Error = $_.Exception.ToString()
}
finally {
    $result.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    $directory = Split-Path -Parent $EvidencePath
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    [IO.File]::WriteAllText($EvidencePath,
        (($result | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false))
}

if ($result.Verdict -cne 'PASS') { exit 1 }
