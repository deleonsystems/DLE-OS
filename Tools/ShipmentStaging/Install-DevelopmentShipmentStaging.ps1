[CmdletBinding()]
param(
    [string] $EvidencePath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -ine 'DLE-OS-HOST\DLE-OS') {
    throw 'Shipment Staging development installation requires the approved DLE-OS identity.'
}

$database = 'DLE_OS_OPERATIONAL_DEV'
$developmentConnection = "Server=lpc:.\SQLEXPRESS;Database=$database;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;"
$productionConnection = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadOnly;'
$migrationPaths = @(
    (Join-Path $PSScriptRoot 'Database\001_AddOperationalShipmentStaging.sql'),
    (Join-Path $PSScriptRoot 'Database\002_AddShipmentQuantityBaseline.sql')
)

function Open-Connection([string] $ConnectionString) {
    $connection = [System.Data.SqlClient.SqlConnection]::new($ConnectionString)
    $connection.Open()
    return $connection
}

function Get-ProductionFingerprint {
    $connection = Open-Connection $productionConnection
    try {
        $command = $connection.CreateCommand()
        $command.CommandText = @"
SELECT COUNT_BIG(*) AS TableCount,
       COALESCE(SUM(CONVERT(bigint,p.rows)),0) AS TotalRows
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
WHERE s.name=N'operational';
"@
        $reader = $command.ExecuteReader()
        try {
            [void]$reader.Read()
            return [ordered]@{ TableCount=[int64]$reader.GetValue(0); TotalRows=[int64]$reader.GetValue(1) }
        }
        finally { $reader.Dispose(); $command.Dispose() }
    }
    finally { $connection.Dispose() }
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Identity = $identity
    Database = $database
    Migrations = $migrationPaths
    ProductionBefore = Get-ProductionFingerprint
}

try {
    $connection = Open-Connection $developmentConnection
    try {
        if ($connection.Database -ne $database) { throw 'The development database boundary is invalid.' }
        $transaction = $connection.BeginTransaction()
        try {
            foreach ($migrationPath in $migrationPaths) {
                $script = Get-Content -Raw -LiteralPath $migrationPath
                foreach ($batch in [regex]::Split($script, '(?im)^\s*GO\s*$')) {
                    if ([string]::IsNullOrWhiteSpace($batch)) { continue }
                    $command = $connection.CreateCommand()
                    $command.Transaction = $transaction
                    $command.CommandText = $batch
                    try { [void]$command.ExecuteNonQuery() } finally { $command.Dispose() }
                }
            }
            $transaction.Commit()
        }
        catch {
            try { $transaction.Rollback() } catch { }
            throw
        }
        finally { $transaction.Dispose() }

        $command = $connection.CreateCommand()
        $command.CommandText = @"
SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
WHERE s.name=N'operational' AND t.name IN
(N'ShipmentStaging',N'ShipmentStagingEvent',N'ShipmentReconciliationRun',
 N'ShipmentInvoiceMatchProposal',N'ShipmentInvoiceDecisionEvent',N'ShipmentInvoiceAllocation');
"@
        try { $evidence.RequiredTableCount = [int]$command.ExecuteScalar() } finally { $command.Dispose() }
        if ($evidence.RequiredTableCount -ne 6) { throw 'The governed Shipment Staging schema is incomplete.' }
    }
    finally { $connection.Dispose() }

    $evidence.ProductionAfter = Get-ProductionFingerprint
    if (($evidence.ProductionBefore | ConvertTo-Json -Compress) -ne
        ($evidence.ProductionAfter | ConvertTo-Json -Compress)) {
        throw 'Production operational data changed during the development-only installation.'
    }
    $evidence.Verdict = 'PASS'
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    if ($EvidencePath) {
        New-Item -ItemType Directory -Path (Split-Path $EvidencePath -Parent) -Force | Out-Null
        $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    }
}

[pscustomobject]$evidence
