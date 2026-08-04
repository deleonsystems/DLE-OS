[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'C:\DLE-OS\Repositories\DLE-OS'
$artifactRoot = Join-Path $repository (
    'Artifacts\EmployeeReferencePlatform001\' +
    'EMPLOYEEREFERENCEPLATFORM001-20260730T122647Z')
$login = 'DLE-OS-HOST\DLE-OS-LIVE-API'
$connectionString = (
    'Server=lpc:.\SQLEXPRESS;Database=master;' +
    'Integrated Security=True;Encrypt=False;TrustServerCertificate=True;' +
    'Pooling=False;' +
    'Application Name=Employee Reference Permission Qualification')

function Invoke-AsLiveApi {
    param(
        [Parameter(Mandatory)]
        [string]$Sql
    )

    $connection = [Data.SqlClient.SqlConnection]::new($connectionString)
    $connection.Open()
    try {
        $command = $connection.CreateCommand()
        $escapedLogin = $login.Replace("'", "''")
        $command.CommandText = "EXECUTE AS LOGIN = N'$escapedLogin';`n$Sql"
        $adapter = [Data.SqlClient.SqlDataAdapter]::new($command)
        $dataSet = [Data.DataSet]::new()
        [void]$adapter.Fill($dataSet)
        return $dataSet
    }
    finally {
        $connection.Dispose()
    }
}

function Test-Denied {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [string]$Sql
    )

    try {
        [void](Invoke-AsLiveApi -Sql $Sql)
        return [ordered]@{
            Name = $Name
            Passed = $false
            Evidence = 'Statement unexpectedly succeeded.'
        }
    }
    catch {
        return [ordered]@{
            Name = $Name
            Passed = $true
            Evidence = $_.Exception.GetBaseException().Message
        }
    }
}

function Invoke-AdminQuery {
    param(
        [Parameter(Mandatory)]
        [string]$Sql
    )

    $connection = [Data.SqlClient.SqlConnection]::new($connectionString)
    $connection.Open()
    try {
        $command = $connection.CreateCommand()
        $command.CommandText = $Sql
        $adapter = [Data.SqlClient.SqlDataAdapter]::new($command)
        $dataSet = [Data.DataSet]::new()
        [void]$adapter.Fill($dataSet)
        return $dataSet
    }
    finally {
        $connection.Dispose()
    }
}

$readData = Invoke-AsLiveApi -Sql @'
USE [DLE_OS_CANONICAL_LIVE];
SELECT
    SUSER_SNAME() AS EffectiveLogin,
    USER_NAME() AS DatabaseUser,
    (SELECT COUNT_BIG(*) FROM canonical.EmployeeReferenceViewer)
        AS EmployeeCount,
    (SELECT COUNT_BIG(*) FROM canonical.EmployeeOperationalCode)
        AS OperationalCodeCount,
    (SELECT COUNT_BIG(*) FROM liveapi.EmployeeReferenceMetadata)
        AS MetadataRowCount;
'@
$readRow = $readData.Tables[0].Rows[0]

$escapedLoginForQuery = $login.Replace("'", "''")
$roleData = Invoke-AdminQuery -Sql @"
SELECT
    MAX(CASE WHEN rolep.name = N'sysadmin' THEN 1 ELSE 0 END)
        AS IsSysAdmin,
    MAX(CASE WHEN rolep.name = N'serveradmin' THEN 1 ELSE 0 END)
        AS IsServerAdmin,
    MAX(CASE WHEN rolep.name = N'securityadmin' THEN 1 ELSE 0 END)
        AS IsSecurityAdmin
FROM sys.server_principals AS memberp
LEFT JOIN sys.server_role_members AS membership
  ON membership.member_principal_id = memberp.principal_id
LEFT JOIN sys.server_principals AS rolep
  ON rolep.principal_id = membership.role_principal_id
WHERE memberp.name = N'$escapedLoginForQuery';
"@
$roleRow = $roleData.Tables[0].Rows[0]

$denials = @(
    Test-Denied -Name 'INSERT denied' -Sql @'
USE [DLE_OS_CANONICAL_LIVE];
INSERT canonical.EmployeeReference
(
    FirmId, EmployeeNumber, DisplayName, EmployeeStatus, IsActive,
    SourceSystem, SourceRecordIdentity, EmployeeReferenceImportRunId
)
SELECT N'ZZ', N'999999999', N'PERMISSION TEST', N'Active', 1,
       N'PERMISSION_TEST', N'PERMISSION_TEST',
       EmployeeReferenceImportRunId
FROM liveapi.EmployeeReferenceMetadata;
'@
    Test-Denied -Name 'UPDATE denied' -Sql @'
USE [DLE_OS_CANONICAL_LIVE];
UPDATE canonical.EmployeeReference SET DisplayName = DisplayName;
'@
    Test-Denied -Name 'DELETE denied' -Sql @'
USE [DLE_OS_CANONICAL_LIVE];
DELETE FROM canonical.EmployeeReference WHERE 1 = 0;
'@
    Test-Denied -Name 'ALTER denied' -Sql @'
USE [DLE_OS_CANONICAL_LIVE];
ALTER TABLE canonical.EmployeeReference
ADD PermissionQualificationShouldNeverExist bit NULL;
'@
    Test-Denied -Name 'DLE_OS access denied' -Sql @'
USE [DLE_OS];
SELECT TOP (1) * FROM sys.tables;
'@
    Test-Denied -Name 'DLE_OS_PLATFORM_LAB access denied' -Sql @'
USE [DLE_OS_PLATFORM_LAB];
SELECT TOP (1) * FROM sys.tables;
'@
)

$listener = Get-NetTCPConnection -State Listen -LocalPort 5042 |
    Select-Object -First 1
$runtime = Get-CimInstance Win32_Process -Filter (
    "ProcessId = $($listener.OwningProcess)")
$runtimeOwner = Invoke-CimMethod -InputObject $runtime -MethodName GetOwner

$evidence = [ordered]@{
    CapturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    ExpectedLogin = $login
    EffectiveLogin = [string]$readRow.EffectiveLogin
    DatabaseUser = [string]$readRow.DatabaseUser
    ReadQualification = [ordered]@{
        EmployeeCount = [long]$readRow.EmployeeCount
        OperationalCodeCount = [long]$readRow.OperationalCodeCount
        MetadataRowCount = [long]$readRow.MetadataRowCount
    }
    DatabaseAccess = [ordered]@{
        DLE_OS_CANONICAL_LIVE = 'SELECT succeeded'
        DLE_OS = 'USE denied'
        DLE_OS_PLATFORM_LAB = 'USE denied'
    }
    ServerRoles = [ordered]@{
        sysadmin = [int]$roleRow.IsSysAdmin
        serveradmin = [int]$roleRow.IsServerAdmin
        securityadmin = [int]$roleRow.IsSecurityAdmin
    }
    WriteDenials = $denials
    Runtime = [ordered]@{
        Port = 5042
        ProcessId = [int]$listener.OwningProcess
        ProcessName = $runtime.Name
        Owner = "$($runtimeOwner.Domain)\$($runtimeOwner.User)"
        CommandLine = $runtime.CommandLine
    }
}

$passed = (
    $evidence.EffectiveLogin -eq $login -and
    $evidence.ReadQualification.EmployeeCount -eq 11 -and
    $evidence.ReadQualification.OperationalCodeCount -eq 18 -and
    $evidence.ReadQualification.MetadataRowCount -eq 1 -and
    $evidence.ServerRoles.sysadmin -eq 0 -and
    $evidence.ServerRoles.serveradmin -eq 0 -and
    $evidence.ServerRoles.securityadmin -eq 0 -and
    @($denials | Where-Object { -not $_.Passed }).Count -eq 0 -and
    $evidence.Runtime.Owner -eq $login
)
$evidence['Verdict'] = if ($passed) { 'PASS' } else { 'FAIL' }

$path = Join-Path $artifactRoot (
    'EMPLOYEE_REFERENCE_SQL_PERMISSION_EVIDENCE.json')
$evidence | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $path -Encoding UTF8
$evidence | ConvertTo-Json -Depth 8

if (-not $passed) {
    throw 'Employee Reference SQL permission qualification failed.'
}
