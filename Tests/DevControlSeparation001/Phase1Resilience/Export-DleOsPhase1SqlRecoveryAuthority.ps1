[CmdletBinding()]
param(
    [string]$OutputRoot = 'C:\DLE-OS\Qualification\DevResilience\Phase1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
    $identity.Name -ine 'DLE-OS-HOST\Miguel') {
    throw 'An elevated DLE-OS-HOST\Miguel session is required for the read-only authority audit.'
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runRoot = Join-Path $OutputRoot ('phase1-sql-authority-audit-' + $stamp)
$null = New-Item -ItemType Directory -Path $runRoot -Force

trap {
    [ordered]@{
        Schema='dle-os.phase1-sql-recovery-authority-audit-failure.v1'
        FailedUtc=[DateTimeOffset]::UtcNow
        ExceptionType=$_.Exception.GetType().FullName
        Message=$_.Exception.Message
        FullyQualifiedErrorId=$_.FullyQualifiedErrorId
        ScriptStackTrace=$_.ScriptStackTrace
        PersistentPermissionsChanged=$false
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runRoot 'sql-recovery-authority-audit-failure.json') -Encoding UTF8
    break
}

function Invoke-SqlTable([string]$Query) {
    $connection = New-Object System.Data.SqlClient.SqlConnection('Server=lpc:.\SQLEXPRESS;Database=master;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=10;Application Name=DLE-OS Phase1 SQL Authority Audit;')
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = $Query
        $command.CommandTimeout = 30
        $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($command)
        $table = New-Object System.Data.DataTable
        $null = $adapter.Fill($table)
        Write-Output -NoEnumerate $table
    }
    finally { $connection.Dispose() }
}

function Convert-Rows([System.Data.DataTable]$Table) {
    foreach ($dataRow in $Table.Rows) {
        $result = [ordered]@{}
        foreach ($column in $Table.Columns) {
            $value = $dataRow[$column.ColumnName]
            $result[$column.ColumnName] = if ($value -is [DBNull]) { $null } else { $value }
        }
        [pscustomobject]$result
    }
}

$serverIdentity = Convert-Rows (Invoke-SqlTable @"
SET NOCOUNT ON;
SELECT @@SERVERNAME AS ServerName,SUSER_SNAME() AS CurrentLogin,
       IS_SRVROLEMEMBER('sysadmin') AS CurrentIsSysadmin,
       IS_SRVROLEMEMBER('dbcreator') AS CurrentIsDbcreator,
       HAS_PERMS_BY_NAME(NULL,NULL,'CREATE ANY DATABASE') AS CurrentCreateAnyDatabase,
       HAS_PERMS_BY_NAME(NULL,NULL,'CONTROL SERVER') AS CurrentControlServer;
"@)

$fixedRoleMembers = Convert-Rows (Invoke-SqlTable @"
SET NOCOUNT ON;
SELECT rolep.name AS ServerRole,memberp.name AS MemberName,memberp.type_desc AS MemberType,
       memberp.is_disabled AS IsDisabled
FROM sys.server_role_members rm
JOIN sys.server_principals rolep ON rolep.principal_id=rm.role_principal_id
JOIN sys.server_principals memberp ON memberp.principal_id=rm.member_principal_id
WHERE rolep.name IN ('sysadmin','dbcreator')
ORDER BY rolep.name,memberp.name;
"@)

$visibleLogins = Convert-Rows (Invoke-SqlTable @"
SET NOCOUNT ON;
SELECT name,type_desc,is_disabled,create_date,modify_date
FROM sys.server_principals
WHERE type IN ('S','U','G')
ORDER BY name;
"@)

$knownNames = @(
    'DLE-OS-HOST\Administrator',
    'DLE-OS-HOST\DLEOS-Recovery',
    'DLE-OS-HOST\DLE-OS',
    'DLE-OS-HOST\Miguel',
    'NT AUTHORITY\SYSTEM',
    'NT SERVICE\MSSQL$SQLEXPRESS'
)
$knownAuthority = @()
foreach ($name in $knownNames) {
    $escaped = $name.Replace("'","''")
    $knownAuthority += Convert-Rows (Invoke-SqlTable "SET NOCOUNT ON; SELECT N'$escaped' AS PrincipalName,IS_SRVROLEMEMBER('sysadmin',N'$escaped') AS IsSysadmin,IS_SRVROLEMEMBER('dbcreator',N'$escaped') AS IsDbcreator;")
}

$sqlService = Get-CimInstance Win32_Service -Filter "Name='MSSQL`$SQLEXPRESS'" |
    Select-Object Name,DisplayName,State,StartMode,StartName,PathName

$localRecoveryAccounts = @('Administrator','DLEOS-Recovery','DLE-OS','Miguel') | ForEach-Object {
    Get-LocalUser -Name $_ -ErrorAction SilentlyContinue | Select-Object Name,Enabled,SID,PasswordExpires,PasswordRequired,LastLogon
}

$maintenanceTasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
    $task = $_
    $actionSummaries = @($task.Actions | ForEach-Object {
        $execute = if ($_.PSObject.Properties['Execute']) { [string]$_.Execute } else { [string]$_.CimClass.CimClassName }
        $arguments = if ($_.PSObject.Properties['Arguments']) { [string]$_.Arguments } else { '' }
        [pscustomobject]@{Execute=$execute;Arguments=$arguments}
    })
    $actionText = (@($actionSummaries | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join ' ')
    if ($task.TaskName -match '(?i)sql|backup|restore|recovery|canonical|snapshot' -or
        $actionText -match '(?i)sqlcmd|backup|restore|sqlexpress') {
        [pscustomobject]@{
            TaskPath=$task.TaskPath
            TaskName=$task.TaskName
            Principal=$task.Principal.UserId
            Enabled=[bool]$task.Settings.Enabled
            State=[string]$task.State
            ActionExecutable=@($actionSummaries | Select-Object -ExpandProperty Execute)
            MentionsBackup=($actionText -match '(?i)backup')
            MentionsRestore=($actionText -match '(?i)restore')
            MentionsSqlExpress=($actionText -match '(?i)sqlexpress|sqlcmd')
        }
    }
})

$result = [ordered]@{
    Schema='dle-os.phase1-sql-recovery-authority-audit.v1'
    CapturedUtc=[DateTimeOffset]::UtcNow
    WindowsIdentity=$identity.Name
    ServerIdentity=$serverIdentity
    FixedRoleMembers=$fixedRoleMembers
    VisibleLogins=$visibleLogins
    KnownPrincipalRoleChecks=$knownAuthority
    SqlService=$sqlService
    LocalRecoveryAccounts=$localRecoveryAccounts
    GovernedMaintenanceTasks=$maintenanceTasks
    ReadOnlyAudit=$true
    PersistentPermissionsChanged=$false
}
$outputPath = Join-Path $runRoot 'sql-recovery-authority-audit.json'
$result | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $outputPath -Encoding UTF8
$result | ConvertTo-Json -Depth 10
