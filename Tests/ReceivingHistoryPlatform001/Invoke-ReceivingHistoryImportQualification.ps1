[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$importer = Join-Path $repository (
    'Tools\ReceivingHistory\Import-ReceivingHistoryBaseline.ps1')
$artifact = Join-Path $repository (
    'Artifacts\ReceivingHistoryPlatform001\' +
    'RECEIVINGHISTORYPLATFORM001-20260730T030741Z\' +
    'RECEIVING_HISTORY_IMPORT_RESULTS.json')
$connectionString = (
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Receiving History Import Qualification')

function Invoke-Importer {
    param([switch] $InduceFailure)
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $importer
    )
    if ($InduceFailure) { $arguments += '-QualificationInduceFailure' }
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& powershell.exe @arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    [pscustomobject]@{
        ExitCode = $exitCode
        Text = ($output | Out-String).Trim()
    }
}

function Get-State {
    $connection = [Data.SqlClient.SqlConnection]::new($connectionString)
    $connection.Open()
    try {
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT
    (SELECT COUNT_BIG(*) FROM canonical.PurchaseReceipt),
    (SELECT COUNT_BIG(*) FROM canonical.PurchaseReceiptLine),
    (SELECT COUNT_BIG(*) FROM canonical.ReceiptRejection),
    (SELECT TOP (1) CONVERT(varchar(36), ReceivingHistoryImportRunId)
     FROM canonical.PurchaseReceipt);
'@
        $reader = $command.ExecuteReader()
        [void]$reader.Read()
        [ordered]@{
            HeaderCount = $reader.GetInt64(0)
            LineCount = $reader.GetInt64(1)
            RejectionCount = $reader.GetInt64(2)
            ReceivingHistoryImportRunId = $reader.GetString(3)
        }
    }
    finally {
        $connection.Dispose()
    }
}

$initialCall = Invoke-Importer
if ($initialCall.ExitCode -ne 0) {
    throw "Initial import failed: $($initialCall.Text)"
}
$initial = $initialCall.Text | ConvertFrom-Json
if ($initial.Behavior -notin @('IMPORTED', 'NO-OP')) {
    throw "Unexpected initial behavior: $($initial.Behavior)"
}

$noOpCall = Invoke-Importer
if ($noOpCall.ExitCode -ne 0) {
    throw "No-op re-import failed: $($noOpCall.Text)"
}
$noOp = $noOpCall.Text | ConvertFrom-Json
if (
    $noOp.Behavior -ne 'NO-OP' -or
    $noOp.ReceivingHistoryImportRunId -ne
        $initial.ReceivingHistoryImportRunId
) {
    throw 'Identical-package no-op qualification failed.'
}

$beforeFailure = Get-State
$failureCall = Invoke-Importer -InduceFailure
if (
    $failureCall.ExitCode -eq 0 -or
    $failureCall.Text -notmatch 'QUALIFICATION_INDUCED_FAILURE_AFTER_DELETE'
) {
    throw 'The induced failure did not fail at the qualified transaction gate.'
}
$afterFailure = Get-State
if (
    $beforeFailure.HeaderCount -ne $afterFailure.HeaderCount -or
    $beforeFailure.LineCount -ne $afterFailure.LineCount -or
    $beforeFailure.RejectionCount -ne $afterFailure.RejectionCount -or
    $beforeFailure.ReceivingHistoryImportRunId -ne
        $afterFailure.ReceivingHistoryImportRunId
) {
    throw 'The induced failure changed the committed Receiving History dataset.'
}

$connection = [Data.SqlClient.SqlConnection]::new($connectionString)
$connection.Open()
try {
    $command = $connection.CreateCommand()
    $command.CommandText = @'
EXECUTE AS USER = N'dle_receiving_history_import_executor';
SELECT
    USER_NAME(),
    HAS_PERMS_BY_NAME(N'canonical.PurchaseReceipt', N'OBJECT', N'SELECT'),
    HAS_PERMS_BY_NAME(N'canonical.PurchaseReceipt', N'OBJECT', N'INSERT'),
    HAS_PERMS_BY_NAME(N'canonical.PurchaseReceipt', N'OBJECT', N'DELETE'),
    HAS_PERMS_BY_NAME(N'canonical.PurchaseReceipt', N'OBJECT', N'ALTER'),
    HAS_PERMS_BY_NAME(NULL, N'DATABASE', N'CONTROL'),
    HAS_PERMS_BY_NAME(NULL, N'DATABASE', N'EXECUTE');
REVERT;
EXECUTE AS USER = N'DLE-OS-HOST\DLE-OS-LIVE-API';
SELECT
    USER_NAME(),
    HAS_PERMS_BY_NAME(
        N'canonical.ReceivingHistoryViewer', N'OBJECT', N'SELECT'),
    HAS_PERMS_BY_NAME(
        N'liveapi.ReceivingHistoryMetadata', N'OBJECT', N'SELECT'),
    HAS_PERMS_BY_NAME(N'canonical.PurchaseReceipt', N'OBJECT', N'INSERT'),
    HAS_PERMS_BY_NAME(N'canonical.PurchaseReceipt', N'OBJECT', N'UPDATE'),
    HAS_PERMS_BY_NAME(N'canonical.PurchaseReceipt', N'OBJECT', N'DELETE'),
    HAS_PERMS_BY_NAME(N'canonical.PurchaseReceipt', N'OBJECT', N'ALTER');
REVERT;
'@
    $reader = $command.ExecuteReader()
    [void]$reader.Read()
    $importPermissions = [ordered]@{
        Principal = $reader.GetString(0)
        CanSelect = $reader.GetInt32(1)
        CanInsert = $reader.GetInt32(2)
        CanDelete = $reader.GetInt32(3)
        CanAlter = $reader.GetInt32(4)
        CanControlDatabase = $reader.GetInt32(5)
        CanExecute = $reader.GetInt32(6)
    }
    [void]$reader.NextResult()
    [void]$reader.Read()
    $apiPermissions = [ordered]@{
        Principal = $reader.GetString(0)
        CanSelectViewer = $reader.GetInt32(1)
        CanSelectMetadata = $reader.GetInt32(2)
        CanInsert = $reader.GetInt32(3)
        CanUpdate = $reader.GetInt32(4)
        CanDelete = $reader.GetInt32(5)
        CanAlter = $reader.GetInt32(6)
    }
    $reader.Close()
}
finally {
    $connection.Dispose()
}
if (
    $importPermissions.CanSelect -ne 1 -or
    $importPermissions.CanInsert -ne 1 -or
    $importPermissions.CanDelete -ne 1 -or
    $importPermissions.CanAlter -ne 0 -or
    $importPermissions.CanControlDatabase -ne 0 -or
    $importPermissions.CanExecute -ne 0 -or
    $apiPermissions.CanSelectViewer -ne 1 -or
    $apiPermissions.CanSelectMetadata -ne 1 -or
    $apiPermissions.CanInsert -ne 0 -or
    $apiPermissions.CanUpdate -ne 0 -or
    $apiPermissions.CanDelete -ne 0 -or
    $apiPermissions.CanAlter -ne 0
) {
    throw 'Receiving History SQL permission qualification failed.'
}

$result = [ordered]@{
    Verdict = 'PASS'
    CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Initial = $initial
    NoOp = $noOp
    InducedFailureExitCode = $failureCall.ExitCode
    InducedFailureMessage = $failureCall.Text
    BeforeInducedFailure = $beforeFailure
    AfterInducedFailure = $afterFailure
    RollbackPreservedCommittedSnapshot = $true
    ImporterPermissions = $importPermissions
    LiveApiPermissions = $apiPermissions
}
$result | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $artifact -Encoding UTF8
$result | ConvertTo-Json -Depth 8
