[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requiredIdentity = 'DLE-OS-HOST\DLE-OS'
$resultPath = 'C:\ProgramData\DLE-OS\Keycloak\State\database-bootstrap.json'
$result = [ordered]@{
    Verdict = 'FAIL'
    Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    CompletedAtUtc = $null
}

try {
    if ($result.Identity -ine $requiredIdentity) {
        throw "Keycloak database bootstrap requires $requiredIdentity."
    }

    $master = [System.Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=master;Integrated Security=True;Encrypt=False;TrustServerCertificate=True')
    try {
        $master.Open()
        $command = $master.CreateCommand()
        try {
            $command.CommandTimeout = 180
            $command.CommandText = @"
IF DB_ID(N'DLE_OS_KEYCLOAK_DEV') IS NULL CREATE DATABASE DLE_OS_KEYCLOAK_DEV;
IF SUSER_ID(N'NT SERVICE\DleOsKeycloak') IS NULL
    CREATE LOGIN [NT SERVICE\DleOsKeycloak] FROM WINDOWS;
IF SUSER_ID(N'dleos_keycloak') IS NOT NULL
    ALTER LOGIN [dleos_keycloak] DISABLE;
"@
            [void]$command.ExecuteNonQuery()
        }
        finally { $command.Dispose() }
    }
    finally { $master.Dispose() }

    $database = [System.Data.SqlClient.SqlConnection]::new(
        'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_KEYCLOAK_DEV;Integrated Security=True;Encrypt=False;TrustServerCertificate=True')
    try {
        $database.Open()
        $command = $database.CreateCommand()
        try {
            $command.CommandText = @"
IF USER_ID(N'NT SERVICE\DleOsKeycloak') IS NULL
    CREATE USER [NT SERVICE\DleOsKeycloak] FOR LOGIN [NT SERVICE\DleOsKeycloak];
IF IS_ROLEMEMBER(N'db_owner',N'NT SERVICE\DleOsKeycloak')<>1
    ALTER ROLE db_owner ADD MEMBER [NT SERVICE\DleOsKeycloak];
IF USER_ID(N'dleos_keycloak') IS NOT NULL
BEGIN
    IF IS_ROLEMEMBER(N'db_owner',N'dleos_keycloak')=1
        ALTER ROLE db_owner DROP MEMBER [dleos_keycloak];
    DROP USER [dleos_keycloak];
END;
"@
            [void]$command.ExecuteNonQuery()
        }
        finally { $command.Dispose() }
    }
    finally { $database.Dispose() }

    $result.Verdict = 'PASS'
    $result.Database = 'DLE_OS_KEYCLOAK_DEV'
    $result.Login = 'NT SERVICE\DleOsKeycloak'
    $result.LegacySqlLogin = 'DISABLED_AND_UNMAPPED'
}
catch {
    $result.Error = $_.Exception.Message
    throw
}
finally {
    $result.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
