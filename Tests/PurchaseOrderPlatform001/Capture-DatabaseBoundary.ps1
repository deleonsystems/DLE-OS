[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Before', 'After')]
    [string] $Phase
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$artifactRoot = (
    'C:\DLE-OS\Repositories\DLE-OS\Artifacts\' +
    'PurchaseOrderPlatform001\' +
    'PURCHASEORDERPLATFORM001-20260729T212157Z')
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$results = [ordered]@{}
foreach ($database in 'DLE_OS', 'DLE_OS_PLATFORM_LAB',
    'DLE_OS_CANONICAL_LIVE') {
    $connection = [Data.SqlClient.SqlConnection]::new(
        "Server=lpc:.\SQLEXPRESS;Database=$database;" +
        'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
        'Application Name=DLE-OS Purchase Order Boundary Evidence')
    $connection.Open()
    try {
        $command = $connection.CreateCommand()
        $command.CommandText = @'
SELECT
    DB_NAME() AS DatabaseName,
    CONVERT(varchar(33), d.create_date, 126) AS DatabaseCreatedAt,
    COUNT(DISTINCT o.object_id) AS UserTableCount,
    COALESCE(SUM(p.rows), 0) AS UserTableRows,
    CONVERT(varchar(33), MAX(o.modify_date), 126) AS LatestObjectModifyDate
FROM sys.databases AS d
CROSS JOIN sys.objects AS o
LEFT JOIN sys.partitions AS p
  ON p.object_id = o.object_id
 AND p.index_id IN (0, 1)
WHERE d.name = DB_NAME()
  AND o.type = N'U'
GROUP BY d.create_date;
'@
        $reader = $command.ExecuteReader()
        [void]$reader.Read()
        $results[$database] = [ordered]@{
            DatabaseName = $reader.GetString(0)
            DatabaseCreatedAt = $reader.GetString(1)
            UserTableCount = $reader.GetInt32(2)
            UserTableRows = $reader.GetInt64(3)
            LatestObjectModifyDate = if ($reader.IsDBNull(4)) {
                $null
            } else { $reader.GetString(4) }
        }
        $reader.Close()
    }
    finally {
        $connection.Dispose()
    }
}

$evidence = [ordered]@{
    Phase = $Phase
    CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Databases = $results
}
$path = Join-Path $artifactRoot (
    "PURCHASE_ORDER_DATABASE_BOUNDARY_$($Phase.ToUpperInvariant()).json")
$evidence | ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath $path -Encoding UTF8
$evidence | ConvertTo-Json -Depth 6
