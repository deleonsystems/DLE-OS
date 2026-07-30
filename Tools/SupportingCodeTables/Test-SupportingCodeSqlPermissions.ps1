[CmdletBinding()]
param(
    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$connectionString =
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Application Name=SUPPORTING-CODE-TABLES-PLATFORM-001-PERMISSION-TEST'
$connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
$results = [ordered]@{
    TestedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Login = 'DLE-OS-HOST\DLE-OS-LIVE-API'
    Verdict = 'FAIL'
}

function Invoke-TestStatement {
    param(
        [System.Data.SqlClient.SqlConnection] $Connection,
        [string] $Sql,
        [bool] $ShouldSucceed
    )
    $command = $Connection.CreateCommand()
    $command.CommandText = @"
EXECUTE AS LOGIN = 'DLE-OS-HOST\DLE-OS-LIVE-API';
BEGIN TRY
    $Sql
END TRY
BEGIN CATCH
    REVERT;
    THROW;
END CATCH;
REVERT;
"@
    try {
        $value = $command.ExecuteScalar()
        if (-not $ShouldSucceed) {
            throw 'A prohibited SQL statement unexpectedly succeeded.'
        }
        [ordered]@{ Result = 'ALLOWED'; Value = $value }
    }
    catch {
        if ($ShouldSucceed) { throw }
        $sqlException = $_.Exception
        while (
            $null -ne $sqlException.InnerException -and
            $sqlException -isnot [System.Data.SqlClient.SqlException]
        ) {
            $sqlException = $sqlException.InnerException
        }
        [ordered]@{
            Result = 'DENIED'
            ErrorNumber =
                if ($sqlException -is [System.Data.SqlClient.SqlException]) {
                    $sqlException.Number
                }
                else {
                    $null
                }
            Message = $_.Exception.Message
        }
    }
}

try {
    $connection.Open()
    $results.Select = Invoke-TestStatement $connection `
        'SELECT COUNT_BIG(*) FROM canonical.ReferenceCodeViewer;' $true
    $results.Insert = Invoke-TestStatement $connection `
        "INSERT canonical.ReferenceCode (
            FirmId, CodeDomain, CodeType, CodeValue, CodeDescription,
            ShortDescription, ParentCodeValue, SortOrder, IsActive,
            SourceType, AccessClassification, ResolutionStatus,
            SourceRecordIdentity, UsageCount, ReferenceCodeImportRunId,
            ImportedAtUtc
        ) VALUES (
            '01', 'TEST', 'TEST', 'TEST', 'TEST',
            NULL, NULL, NULL, 1, 'SourceMaster', 'InternalOnly',
            'Resolved', 'PERMISSION_TEST', 0,
            '36c23ba1-b09d-4df8-a794-6e324f46b483', SYSUTCDATETIME()
        ); SELECT 1;" $false
    $results.Update = Invoke-TestStatement $connection `
        "UPDATE canonical.ReferenceCode
         SET CodeDescription = CodeDescription
         WHERE ReferenceCodeId = -1; SELECT 1;" $false
    $results.Delete = Invoke-TestStatement $connection `
        "DELETE canonical.ReferenceCode
         WHERE ReferenceCodeId = -1; SELECT 1;" $false
    $results.Alter = Invoke-TestStatement $connection `
        "ALTER TABLE canonical.ReferenceCode ADD UnauthorizedTest bit NULL;
         SELECT 1;" $false
    $results.ProtectedDleOs = Invoke-TestStatement $connection `
        'SELECT TOP (1) * FROM DLE_OS.sys.tables;' $false
    $results.ProtectedHistorical = Invoke-TestStatement $connection `
        'SELECT TOP (1) * FROM DLE_OS_PLATFORM_LAB.sys.tables;' $false
    $results.Verdict = 'PASS'
}
finally {
    $connection.Dispose()
}

$json = $results | ConvertTo-Json -Depth 8
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $json | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}
$json
