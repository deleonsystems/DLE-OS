[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$schema = (
    'C:\DLE-OS\Repositories\DLE-OS\Tools\ReceivingHistory\Database\' +
    '032_AddReceivingHistoryPlatform.sql')
$connectionString = (
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=DLE-OS Receiving History Schema Installer'
)
if (-not (Test-Path -LiteralPath $schema -PathType Leaf)) {
    throw "Receiving History schema is missing: $schema"
}
$text = Get-Content -LiteralPath $schema -Raw
if (
    $text -notmatch '(?im)^USE \[DLE_OS_CANONICAL_LIVE\];\s*$' -or
    $text -match '(?i)\bUSE\s+\[(DLE_OS|DLE_OS_PLATFORM_LAB)\]'
) {
    throw 'Schema target is outside the qualified LIVE database boundary.'
}

$connection = [Data.SqlClient.SqlConnection]::new($connectionString)
$connection.Open()
try {
    foreach ($batch in [regex]::Split($text, '(?im)^\s*GO\s*$')) {
        if ([string]::IsNullOrWhiteSpace($batch)) { continue }
        $command = $connection.CreateCommand()
        $command.CommandText = $batch
        $command.CommandTimeout = 180
        [void]$command.ExecuteNonQuery()
        $command.Dispose()
    }
    $verify = $connection.CreateCommand()
    $verify.CommandText = @'
SELECT DB_NAME(),
       OBJECT_ID(N'canonical.PurchaseReceipt', N'U'),
       OBJECT_ID(N'canonical.PurchaseReceiptLine', N'U'),
       OBJECT_ID(N'canonical.ReceiptRejection', N'U'),
       OBJECT_ID(N'canonical.ReceivingHistoryViewer', N'V'),
       OBJECT_ID(N'liveapi.ReceivingHistoryMetadata', N'V');
'@
    $reader = $verify.ExecuteReader()
    [void]$reader.Read()
    if (
        $reader.GetString(0) -cne 'DLE_OS_CANONICAL_LIVE' -or
        $reader.IsDBNull(1) -or $reader.IsDBNull(2) -or
        $reader.IsDBNull(3) -or $reader.IsDBNull(4) -or
        $reader.IsDBNull(5)
    ) {
        throw 'Receiving History schema verification failed.'
    }
    $reader.Close()
    [ordered]@{
        Verdict = 'PASS'
        Database = 'DLE_OS_CANONICAL_LIVE'
        SchemaSha256 = (
            Get-FileHash -LiteralPath $schema -Algorithm SHA256).Hash
    } | ConvertTo-Json
}
finally {
    $connection.Dispose()
}
