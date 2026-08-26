[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$OutputRoot,
    [Parameter(Mandatory=$true)]
    [string]$HashAttestationPath,
    [Parameter(Mandatory=$true)]
    [string]$HashAttestationSha256,
    [string]$RunId,
    [string[]]$ApprovedPriorRestoreCleanup=@()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedIdentity = 'DLE-OS-HOST\DLE-OS'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not [string]::Equals($identity,$expectedIdentity,[StringComparison]::OrdinalIgnoreCase)) {
    throw "Restore qualification must run as $expectedIdentity; current identity is $identity."
}

$expectedBackups = @(
    [ordered]@{
        Database='DLE_OS_OPERATIONAL_DEV'
        SqlPath='C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\Backup\DLE_OS_OPERATIONAL_DEV_20260826T044836Z_COPY_ONLY_CHECKSUM.bak'
        GovernedPath='C:\DLE-OS\Backups\DevResilience\phase1-database-backup-20260826T044836Z\DLE_OS_OPERATIONAL_DEV_20260826T044836Z_COPY_ONLY_CHECKSUM.bak'
        Sha256='5AED4F19FF33328E727A5D2C39FCF3E7C0009919F4D56B9413450C3684A7894D'
    },
    [ordered]@{
        Database='DLE_OS_SECURITY_DEV'
        SqlPath='C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\Backup\DLE_OS_SECURITY_DEV_20260826T044836Z_COPY_ONLY_CHECKSUM.bak'
        GovernedPath='C:\DLE-OS\Backups\DevResilience\phase1-database-backup-20260826T044836Z\DLE_OS_SECURITY_DEV_20260826T044836Z_COPY_ONLY_CHECKSUM.bak'
        Sha256='CA1B269F53108548183A5483B7C5F0D47B4E87F2EA1A25929B2F8B2B57AA43ED'
    }
)

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
if ([string]::IsNullOrWhiteSpace($RunId)) { $RunId = 'phase1-restore-qualification-' + $stamp }
if ($RunId -notmatch '^phase1-restore-qualification-[0-9]{8}T[0-9]{6}Z$') { throw "Invalid restore qualification run ID: $RunId" }
$runRoot = Join-Path $OutputRoot $RunId
$null = New-Item -ItemType Directory -Path $runRoot -Force
$transcriptPath = Join-Path $runRoot 'restore-qualification-transcript.log'
Start-Transcript -LiteralPath $transcriptPath -Force | Out-Null

$allowedActiveDatabases = @('DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV')
$createdDatabases = New-Object Collections.Generic.List[string]
$result = [ordered]@{
    Schema='dle-os.phase1-restore-qualification.v1'
    StartedUtc=[DateTimeOffset]::UtcNow
    Identity=$identity
    PersistentPermissionsChanged=$false
    ActiveDatabasePermissionsChanged=$false
    Backups=@()
    Cleanup=[ordered]@{Attempted=$false;Passed=$false;Removed=@();Remaining=@()}
    PriorFailedRestoreCleanup=@()
    Passed=$false
}

function Get-Sha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required file is absent: $Path" }
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Escape-SqlLiteral([string]$Value) { $Value.Replace("'", "''") }
function Quote-SqlIdentifier([string]$Value) { '[' + $Value.Replace(']', ']]') + ']' }

function Assert-AllowedDatabase([string]$Database) {
    if ($Database -eq 'master' -or $Database -in $allowedActiveDatabases) { return }
    if ($Database -notmatch '^DLE_OS_(OPERATIONAL|SECURITY)_DEV_RESTORE_TEST_[0-9]{8}T[0-9]{6}Z$') {
        throw "Refusing SQL access outside the Phase 1 DEV allowlist: $Database"
    }
}

function New-SqlConnection([string]$Database='master') {
    Assert-AllowedDatabase $Database
    $connectionString = "Server=lpc:.\SQLEXPRESS;Database=$Database;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=15;Application Name=DLE-OS Phase1 Isolated Restore Qualification;"
    New-Object System.Data.SqlClient.SqlConnection($connectionString)
}

function Invoke-SqlTable([string]$Database,[string]$Query,[int]$TimeoutSeconds=300) {
    $connection = New-SqlConnection $Database
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = $Query
        $command.CommandTimeout = $TimeoutSeconds
        $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($command)
        $table = New-Object System.Data.DataTable
        $null = $adapter.Fill($table)
        Write-Output -NoEnumerate $table
    }
    finally { $connection.Dispose() }
}

function Invoke-SqlNonQuery([string]$Database,[string]$Query,[int]$TimeoutSeconds=1800) {
    $connection = New-SqlConnection $Database
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = $Query
        $command.CommandTimeout = $TimeoutSeconds
        $null = $command.ExecuteNonQuery()
    }
    finally { $connection.Dispose() }
}

function Convert-DataTableRows([System.Data.DataTable]$Table) {
    @($Table.Rows | ForEach-Object {
        $row = [ordered]@{}
        foreach ($column in $Table.Columns) {
            $value = $_[$column.ColumnName]
            $row[$column.ColumnName] = if ($value -is [DBNull]) { $null } else { $value }
        }
        [pscustomobject]$row
    })
}

function Get-DatabaseSnapshot([string]$Database) {
    $objectCounts = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
SELECT type_desc AS ObjectType,COUNT_BIG(*) AS ObjectCount
FROM sys.objects WHERE is_ms_shipped=0 GROUP BY type_desc ORDER BY type_desc;
"@)
    $tableCounts = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
SELECT s.name AS SchemaName,t.name AS TableName,
       SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS [RowCount]
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
LEFT JOIN sys.partitions p ON p.object_id=t.object_id
WHERE t.is_ms_shipped=0
GROUP BY s.name,t.name ORDER BY s.name,t.name;
"@)
    $securityCounts = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
SELECT
 (SELECT COUNT_BIG(*) FROM sys.database_principals WHERE principal_id>4 AND name NOT IN ('guest','INFORMATION_SCHEMA','sys')) AS PrincipalCount,
 (SELECT COUNT_BIG(*) FROM sys.database_permissions) AS PermissionCount,
 (SELECT COUNT_BIG(*) FROM sys.database_role_members) AS RoleMembershipCount;
"@)
    [ordered]@{Database=$Database;ObjectCounts=$objectCounts;TableCounts=$tableCounts;SecurityCounts=$securityCounts}
}

function Test-SnapshotMatch($Active,$Restored) {
    $objectsMatch = (($Active.ObjectCounts | ConvertTo-Json -Compress -Depth 8) -ceq ($Restored.ObjectCounts | ConvertTo-Json -Compress -Depth 8))
    $tablesMatch = (($Active.TableCounts | ConvertTo-Json -Compress -Depth 8) -ceq ($Restored.TableCounts | ConvertTo-Json -Compress -Depth 8))
    $securityMatch = (($Active.SecurityCounts | ConvertTo-Json -Compress -Depth 8) -ceq ($Restored.SecurityCounts | ConvertTo-Json -Compress -Depth 8))
    [ordered]@{ObjectCountsMatch=$objectsMatch;TableRowCountsMatch=$tablesMatch;SecurityCountsMatch=$securityMatch;Passed=($objectsMatch -and $tablesMatch -and $securityMatch)}
}

function Get-OperationalEvidence([string]$Database) {
    $rows = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
SELECT
 (SELECT COUNT_BIG(*) FROM operational.OperationsCenterVerifiedStatusEvent) AS VerifiedStatusCount,
 (SELECT MAX(RecordedAtUtc) FROM operational.OperationsCenterVerifiedStatusEvent) AS LatestVerifiedStatusUtc,
 (SELECT COUNT_BIG(*) FROM operational.OperationsCenterVerifiedStatusEvent WHERE WorkOrderNumber='0115622' AND StatusText='In production - unknown emp') AS Wo0115622ExpectedStatusCount,
 (SELECT COUNT_BIG(*) FROM operational.OperationsCenterWorkOrderVerifiedStatusEvent WHERE WorkOrderNumber='0115623' AND StatusText LIKE '%kit short%') AS Wo0115623KitShortStatusCount,
 (SELECT COUNT_BIG(*) FROM operational.KittingDispositionEvent WHERE WorkOrderNumber='0115623' AND ResultingDisposition='KIT_SHORT') AS Wo0115623KitShortDispositionCount,
 (SELECT COUNT_BIG(*) FROM operational.KittingCase WHERE WorkOrderNumber='0115621' AND IsActive=1) AS Wo0115621ActiveKittingCaseCount,
 (SELECT COUNT_BIG(*) FROM operational.KittingCaseEvent WHERE Actor='dev.kitting') AS DevKittingEventCount,
 (SELECT MAX(EventAtUtc) FROM operational.KittingCaseEvent WHERE Actor='dev.kitting') AS LatestDevKittingEventUtc,
 (SELECT COUNT_BIG(*) FROM operational.RmaReworkCase) AS RmaReworkCaseCount,
 (SELECT COUNT_BIG(*) FROM operational.RmaReworkCaseMember) AS RmaReworkMemberCount,
 (SELECT COUNT_BIG(*) FROM operational.RmaReworkCaseEvent) AS RmaReworkEventCount,
 (SELECT COUNT_BIG(*) FROM operational.ShipmentStaging) AS ShipmentStagingCount,
 (SELECT COUNT_BIG(*) FROM operational.ShipmentStagingEvent) AS ShipmentStagingEventCount;
"@)
    $row = @($rows)[0]
    $passed = [int64]$row.VerifiedStatusCount -gt 0 -and
        [datetime]$row.LatestVerifiedStatusUtc -ge [datetime]'2026-08-22T00:00:00Z' -and
        [int64]$row.Wo0115622ExpectedStatusCount -gt 0 -and
        ([int64]$row.Wo0115623KitShortStatusCount -gt 0 -or [int64]$row.Wo0115623KitShortDispositionCount -gt 0) -and
        [int64]$row.Wo0115621ActiveKittingCaseCount -gt 0 -and
        [int64]$row.DevKittingEventCount -gt 0 -and
        [datetime]$row.LatestDevKittingEventUtc -ge [datetime]'2026-08-18T00:00:00Z' -and
        [int64]$row.RmaReworkCaseCount -gt 0 -and [int64]$row.RmaReworkMemberCount -gt 0 -and [int64]$row.RmaReworkEventCount -gt 0 -and
        [int64]$row.ShipmentStagingCount -gt 0 -and [int64]$row.ShipmentStagingEventCount -gt 0
    [ordered]@{Values=$row;Passed=$passed}
}

function Get-SecurityEvidence([string]$Database) {
    $requiredTables = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
DECLARE @required TABLE(SchemaName sysname,TableName sysname);
INSERT @required VALUES
 ('security','User'),('security','ExternalIdentity'),('security','Role'),('security','Permission'),
 ('security','UserRole'),('security','RolePermission'),('security','AuditEvent');
SELECT r.SchemaName,r.TableName,CASE WHEN t.object_id IS NULL THEN 0 ELSE 1 END AS Present
FROM @required r LEFT JOIN sys.schemas s ON s.name=r.SchemaName
LEFT JOIN sys.tables t ON t.schema_id=s.schema_id AND t.name=r.TableName
ORDER BY r.TableName;
"@)
    $identities = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
SELECT u.UserName,u.AccountStatus,r.RoleCode,r.IsSuperAdmin,ur.IsActive AS AssignmentActive
FROM security.[User] u
LEFT JOIN security.UserRole ur ON ur.UserId=u.UserId AND ur.IsActive=1
LEFT JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsActive=1
WHERE u.NormalizedUserName IN ('MIGUEL','DEV.KITTING')
ORDER BY u.NormalizedUserName,r.RoleCode;
"@)
    $counts = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
SELECT
 (SELECT COUNT_BIG(*) FROM security.[User]) AS UserCount,
 (SELECT COUNT_BIG(*) FROM security.[Role]) AS RoleCount,
 (SELECT COUNT_BIG(*) FROM security.Permission) AS PermissionCount,
 (SELECT COUNT_BIG(*) FROM security.UserRole WHERE IsActive=1) AS ActiveUserRoleCount,
 (SELECT COUNT_BIG(*) FROM security.RolePermission WHERE IsActive=1) AS ActiveRolePermissionCount,
 (SELECT COUNT_BIG(*) FROM security.ExternalIdentity WHERE IsActive=1) AS ActiveExternalIdentityCount;
"@)
    $missingTables = @($requiredTables | Where-Object { [int]$_.Present -ne 1 })
    $miguel = @($identities | Where-Object { $_.UserName -ieq 'Miguel' -and $_.AccountStatus -eq 'ACTIVE' -and $_.RoleCode -eq 'SUPER_ADMIN' -and [bool]$_.IsSuperAdmin })
    $devKitting = @($identities | Where-Object { $_.UserName -ieq 'dev.kitting' -and $_.AccountStatus -eq 'ACTIVE' -and $_.RoleCode -eq 'DEV_KITTING_OPERATOR' -and -not [bool]$_.IsSuperAdmin })
    $devKittingSuper = @($identities | Where-Object { $_.UserName -ieq 'dev.kitting' -and [bool]$_.IsSuperAdmin })
    [ordered]@{
        RequiredTables=$requiredTables
        IdentityRoleMappings=$identities
        Counts=@($counts)[0]
        Passed=($missingTables.Count -eq 0 -and $miguel.Count -eq 1 -and $devKitting.Count -eq 1 -and $devKittingSuper.Count -eq 0)
    }
}

try {
    $actualAttestationHash = Get-Sha256 $HashAttestationPath
    if ($actualAttestationHash -cne $HashAttestationSha256) { throw 'Hash attestation integrity check failed.' }
    $hashAttestation = Get-Content -LiteralPath $HashAttestationPath -Raw | ConvertFrom-Json
    if ($hashAttestation.Schema -ne 'dle-os.phase1-backup-hash-attestation.v1' -or
        -not [string]::Equals([string]$hashAttestation.Identity,'DLE-OS-HOST\Miguel',[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Backup hash attestation identity/schema is invalid.'
    }
    $result.HashAttestation = [ordered]@{Path=$HashAttestationPath;Sha256=$actualAttestationHash;Identity=$hashAttestation.Identity;CapturedUtc=$hashAttestation.CapturedUtc}

    $authority = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT SUSER_SNAME() LoginName,IS_SRVROLEMEMBER('sysadmin') IsSysadmin,IS_SRVROLEMEMBER('dbcreator') IsDbcreator;")
    $authorityRow = @($authority)[0]
    $result.Authority = $authorityRow
    if (-not [string]::Equals([string]$authorityRow.LoginName,$expectedIdentity,[StringComparison]::OrdinalIgnoreCase) -or [int]$authorityRow.IsSysadmin -ne 1) {
        throw 'The governed DLE-OS recovery identity does not have its established sysadmin authority.'
    }

    foreach ($priorDatabase in $ApprovedPriorRestoreCleanup) {
        Assert-AllowedDatabase $priorDatabase
        $prior = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT d.name,d.state_desc,COUNT(s.session_id) AS OtherSessionCount FROM sys.databases d LEFT JOIN sys.dm_exec_sessions s ON s.database_id=d.database_id AND s.session_id<>@@SPID WHERE d.name=N'$(Escape-SqlLiteral $priorDatabase)' GROUP BY d.name,d.state_desc;")
        if (@($prior).Count -eq 0) {
            $result.PriorFailedRestoreCleanup += [pscustomobject]@{Database=$priorDatabase;Disposition='ALREADY_ABSENT';Passed=$true}
            continue
        }
        $priorFiles = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT physical_name FROM sys.master_files WHERE database_id=DB_ID(N'$(Escape-SqlLiteral $priorDatabase)');")
        if (@($priorFiles).Count -eq 0 -or @($priorFiles | Where-Object { $_.physical_name -notlike ('*' + $priorDatabase + '*') }).Count -ne 0) {
            throw "Prior restore-test database file identity is not narrowly attributable: $priorDatabase"
        }
        if ([int64]@($prior)[0].OtherSessionCount -ne 0) { throw "Prior restore-test database has an external session: $priorDatabase" }
        Invoke-SqlNonQuery 'master' "ALTER DATABASE $(Quote-SqlIdentifier $priorDatabase) SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE $(Quote-SqlIdentifier $priorDatabase);" 600
        $result.PriorFailedRestoreCleanup += [pscustomobject]@{Database=$priorDatabase;Disposition='REMOVED_FAILED_RUN_RESTORE_ONLY';Files=$priorFiles;Passed=$true}
    }

    $paths = Convert-DataTableRows (Invoke-SqlTable 'master' @"
SET NOCOUNT ON;
SELECT
 CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(4000)) AS DefaultDataPath,
 CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS nvarchar(4000)) AS DefaultLogPath;
"@)
    $defaultDataPath = [string]@($paths)[0].DefaultDataPath
    $defaultLogPath = [string]@($paths)[0].DefaultLogPath
    if ([string]::IsNullOrWhiteSpace($defaultDataPath) -or [string]::IsNullOrWhiteSpace($defaultLogPath)) { throw 'SQL default data/log paths are unavailable.' }

    foreach ($backup in $expectedBackups) {
        $attested = @($hashAttestation.Backups | Where-Object { $_.Database -eq $backup.Database })
        if ($attested.Count -ne 1) { throw "Hash attestation has no unique entry for $($backup.Database)." }
        $governedHash = [string]$attested[0].GovernedSha256
        $sqlHash = [string]$attested[0].SqlSha256
        if ($governedHash -cne $backup.Sha256 -or $sqlHash -cne $backup.Sha256) {
            throw "Backup hash mismatch for $($backup.Database)."
        }

        $restoreName = $backup.Database + '_RESTORE_TEST_' + $stamp
        Assert-AllowedDatabase $restoreName
        $existing = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT COUNT_BIG(*) AS ExistingCount FROM sys.databases WHERE name=N'$(Escape-SqlLiteral $restoreName)';")
        if ([int64]@($existing)[0].ExistingCount -ne 0) { throw "Restore target already exists: $restoreName" }

        $escapedBackupPath = Escape-SqlLiteral $backup.SqlPath
        $verifyCommand = "RESTORE VERIFYONLY FROM DISK=N'$escapedBackupPath' WITH CHECKSUM;"
        Invoke-SqlNonQuery 'master' $verifyCommand 900

        $fileList = Invoke-SqlTable 'master' "RESTORE FILELISTONLY FROM DISK=N'$escapedBackupPath';" 300
        $moves = New-Object Collections.Generic.List[string]
        $fileEvidence = New-Object Collections.Generic.List[object]
        $dataIndex = 0
        $logIndex = 0
        foreach ($file in $fileList.Rows) {
            $logicalName = [string]$file.LogicalName
            if ([string]$file.Type -eq 'L') {
                $logIndex++
                $physicalPath = Join-Path $defaultLogPath ($restoreName + '_log' + $logIndex + '.ldf')
            } else {
                $dataIndex++
                $extension = if ([string]$file.Type -eq 'S') { '.ndf' } else { '.mdf' }
                $physicalPath = Join-Path $defaultDataPath ($restoreName + '_data' + $dataIndex + $extension)
            }
            $moves.Add("MOVE N'$(Escape-SqlLiteral $logicalName)' TO N'$(Escape-SqlLiteral $physicalPath)'")
            $fileEvidence.Add([pscustomobject]@{LogicalName=$logicalName;Type=[string]$file.Type;PhysicalPath=$physicalPath})
        }
        if ($moves.Count -eq 0) { throw "No files were returned by RESTORE FILELISTONLY for $($backup.Database)." }

        $restoreCommand = "RESTORE DATABASE $(Quote-SqlIdentifier $restoreName) FROM DISK=N'$escapedBackupPath' WITH CHECKSUM,RECOVERY," + ($moves -join ',') + ';'
        Invoke-SqlNonQuery 'master' $restoreCommand 1800
        $createdDatabases.Add($restoreName)

        $activeSnapshot = Get-DatabaseSnapshot $backup.Database
        $restoredSnapshot = Get-DatabaseSnapshot $restoreName
        $comparison = Test-SnapshotMatch $activeSnapshot $restoredSnapshot
        $content = if ($backup.Database -eq 'DLE_OS_OPERATIONAL_DEV') { Get-OperationalEvidence $restoreName } else { Get-SecurityEvidence $restoreName }
        $databaseFiles = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT DB_NAME(database_id) DatabaseName,name LogicalName,type_desc TypeDescription,physical_name PhysicalName,state_desc StateDescription FROM sys.master_files WHERE database_id=DB_ID(N'$(Escape-SqlLiteral $restoreName)') ORDER BY file_id;")
        $serviceReferences = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT session_id,login_name,host_name,program_name,host_process_id FROM sys.dm_exec_sessions WHERE database_id=DB_ID(N'$(Escape-SqlLiteral $restoreName)') AND session_id<>@@SPID ORDER BY session_id;")
        $externalSessions = @($serviceReferences | Where-Object { $_.program_name -ne 'DLE-OS Phase1 Isolated Restore Qualification' })
        $noServiceReference = $externalSessions.Count -eq 0
        $passed = $comparison.Passed -and $content.Passed -and $noServiceReference

        $entry = [ordered]@{
            Database=$backup.Database
            GovernedBackupPath=$backup.GovernedPath
            SqlBackupPath=$backup.SqlPath
            ExpectedSha256=$backup.Sha256
            GovernedSha256=$governedHash
            SqlSha256=$sqlHash
            HashesPassed=$true
            VerifyCommand=$verifyCommand
            VerifyOnlyWithChecksum='PASS'
            RestoreDatabase=$restoreName
            RestoreCommand=$restoreCommand
            PlannedFiles=$fileEvidence
            RestoredFiles=$databaseFiles
            ActiveSnapshot=$activeSnapshot
            RestoredSnapshot=$restoredSnapshot
            Comparison=$comparison
            ContentEvidence=$content
            SessionsReferencingRestoreDatabase=$serviceReferences
            ExternalSessionsReferencingRestoreDatabase=$externalSessions
            NoOtherSessions=$noServiceReference
            ApplicationAccessGranted=$false
            Passed=$passed
        }
        $result.Backups += [pscustomobject]$entry
        $entry | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $runRoot ($backup.Database + '-restore-evidence.json')) -Encoding UTF8
        if (-not $passed) { throw "Isolated restore qualification failed for $($backup.Database); restore databases are retained for review." }
    }

    $result.Cleanup.Attempted = $true
    foreach ($database in @($createdDatabases)) {
        Assert-AllowedDatabase $database
        Invoke-SqlNonQuery 'master' "ALTER DATABASE $(Quote-SqlIdentifier $database) SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE $(Quote-SqlIdentifier $database);" 600
        $result.Cleanup.Removed += $database
    }
    $remaining = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name LIKE 'DLE[_]OS[_]%[_]DEV[_]RESTORE[_]TEST[_]%' ORDER BY name;")
    $result.Cleanup.Remaining = @($remaining | Select-Object -ExpandProperty name)
    $result.Cleanup.Passed = @($result.Cleanup.Remaining).Count -eq 0
    if (-not $result.Cleanup.Passed) { throw 'One or more Phase 1 restore-test databases remain after cleanup.' }

    $activeState = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT name,state_desc,user_access_desc FROM sys.databases WHERE name IN ('DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV') ORDER BY name;")
    $result.ActiveDatabaseFinalState = $activeState
    if (@($activeState).Count -ne 2 -or @($activeState | Where-Object { $_.state_desc -ne 'ONLINE' -or $_.user_access_desc -ne 'MULTI_USER' }).Count -ne 0) {
        throw 'An active DEV database is not ONLINE/MULTI_USER after qualification.'
    }
    $result.Passed = @($result.Backups).Count -eq 2 -and @($result.Backups | Where-Object { -not $_.Passed }).Count -eq 0 -and $result.Cleanup.Passed
}
catch {
    $result.Error = $_.Exception.Message
    $result.FailureUtc = [DateTimeOffset]::UtcNow
    throw
}
finally {
    $result.CompletedUtc = [DateTimeOffset]::UtcNow
    $resultPath = Join-Path $runRoot 'phase1-restore-qualification.json'
    $result | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $resultPath -Encoding UTF8
    Stop-Transcript | Out-Null
}

Write-Output (Join-Path $runRoot 'phase1-restore-qualification.json')
