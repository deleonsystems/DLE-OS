[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Inspect','Grant','Remove')]
    [string]$Mode,

    [Parameter(Mandatory)]
    [string]$ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serviceIdentity = 'DLE-OS-HOST\DLE-OS-DEV-FRONTEND'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$grantPath = Join-Path $repository 'Tools\SecurityFoundation\Database\007_GrantDevelopmentFrontendService.sql'
$validatePath = Join-Path $repository 'Tools\SecurityFoundation\Database\007_ValidateDevelopmentFrontendService.sql'
$connectionString = 'Server=lpc:.\SQLEXPRESS;Database=master;Integrated Security=True;Encrypt=False;TrustServerCertificate=True'
$result = [ordered]@{
    Mode = $Mode
    ExecutedAs = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    ServiceIdentity = $serviceIdentity
}

function Invoke-SqlBatch([string]$Sql) {
    $connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        foreach ($batch in [regex]::Split($Sql,'(?im)^\s*GO\s*$')) {
            if ([string]::IsNullOrWhiteSpace($batch)) { continue }
            $command = $connection.CreateCommand()
            try {
                $command.CommandText = $batch
                $command.CommandTimeout = 180
                [void]$command.ExecuteNonQuery()
            }
            finally { $command.Dispose() }
        }
    }
    finally { $connection.Dispose() }
}

function Get-PrincipalState {
    $connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        try {
            $command.CommandText = @"
SELECT
    CASE WHEN SUSER_ID(N'$serviceIdentity') IS NULL THEN 0 ELSE 1 END,
    CASE WHEN EXISTS (
        SELECT 1 FROM DLE_OS_SECURITY_DEV.sys.database_principals
        WHERE name=N'$serviceIdentity') THEN 1 ELSE 0 END,
    COALESCE(IS_SRVROLEMEMBER(N'sysadmin',N'$serviceIdentity'),0),
    (SELECT COUNT(*) FROM sys.server_role_members rm
     JOIN sys.server_principals member ON member.principal_id=rm.member_principal_id
     WHERE member.name=N'$serviceIdentity');
"@
            $reader = $command.ExecuteReader()
            try {
                if (-not $reader.Read()) { throw 'SQL principal state query returned no row.' }
                [ordered]@{
                    LoginExists = [bool]$reader.GetInt32(0)
                    UserExists = [bool]$reader.GetInt32(1)
                    IsSysadmin = [bool]$reader.GetInt32(2)
                    ServerRoleCount = $reader.GetInt32(3)
                }
            }
            finally { $reader.Dispose() }
        }
        finally { $command.Dispose() }
    }
    finally { $connection.Dispose() }
}

try {
    $before = Get-PrincipalState
    $result.Before = $before
    if ($before.LoginExists -xor $before.UserExists) {
        throw 'The dedicated DEV SQL principal is partial; bootstrap will not guess how to repair it.'
    }
    if ($before.IsSysadmin -or $before.ServerRoleCount -ne 0) {
        throw 'The dedicated DEV frontend identity must not belong to any fixed server role.'
    }

    switch ($Mode) {
        'Inspect' { }
        'Grant' {
            Invoke-SqlBatch (Get-Content -Raw -LiteralPath $grantPath)
            Invoke-SqlBatch (Get-Content -Raw -LiteralPath $validatePath)
        }
        'Remove' {
            Invoke-SqlBatch @"
USE [DLE_OS_SECURITY_DEV];
IF DATABASE_PRINCIPAL_ID(N'$serviceIdentity') IS NOT NULL
    DROP USER [$serviceIdentity];
GO
USE [master];
IF SUSER_ID(N'$serviceIdentity') IS NOT NULL
    DROP LOGIN [$serviceIdentity];
GO
"@
        }
    }

    $after = Get-PrincipalState
    $result.After = $after
    if ($Mode -eq 'Grant' -and (-not $after.LoginExists -or -not $after.UserExists -or
        $after.IsSysadmin -or $after.ServerRoleCount -ne 0)) {
        throw 'The dedicated DEV SQL principal did not reach the required least-privilege state.'
    }
    if ($Mode -eq 'Remove' -and ($after.LoginExists -or $after.UserExists)) {
        throw 'The transaction-created DEV SQL principal was not removed.'
    }
    $result.Verdict = 'PASS'
}
catch {
    $result.Error = $_.Exception.Message
    $result.Verdict = 'FAIL'
    throw
}
finally {
    New-Item -ItemType Directory -Path (Split-Path -Parent $ResultPath) -Force | Out-Null
    $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ResultPath -Encoding utf8
}
