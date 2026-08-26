[CmdletBinding()]
param(
    [string]$RepositoryRoot = 'C:\DLE-OS\Repositories\DLE-OS',
    [string]$QualificationRoot = 'C:\DLE-OS\Qualification\DevResilience\Phase1',
    [string]$GovernedBackupRoot = 'C:\DLE-OS\Backups\DevResilience'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Phase 1 preservation requires an elevated Miguel administrator session.'
}
if (-not [string]::Equals($identity.Name, 'DLE-OS-HOST\Miguel', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Phase 1 preservation requires DLE-OS-HOST\Miguel; current identity is $($identity.Name)."
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runId = 'phase1-' + $stamp
$evidenceRoot = Join-Path $QualificationRoot $runId
$backupRoot = Join-Path $GovernedBackupRoot $runId
$preservationRoot = Join-Path $backupRoot 'Preservation'
$taskEvidenceRoot = Join-Path $evidenceRoot 'Tasks'
$databaseEvidenceRoot = Join-Path $evidenceRoot 'Databases'
$filesystemEvidenceRoot = Join-Path $evidenceRoot 'Filesystem'
$regressionEvidenceRoot = Join-Path $evidenceRoot 'Regression'
$null = New-Item -ItemType Directory -Path $evidenceRoot,$backupRoot,$preservationRoot,$taskEvidenceRoot,$databaseEvidenceRoot,$filesystemEvidenceRoot,$regressionEvidenceRoot -Force
$transcriptPath = Join-Path $evidenceRoot 'phase1-transcript.log'
Start-Transcript -LiteralPath $transcriptPath -Force | Out-Null

$candidateTaskPath = '\'
$candidateTaskName = 'DLE-OS DEV Operational ControlHost 5054 Candidate'
$legacyTaskPath = '\DLE-OS\Development\'
$legacyTaskName = 'Operational ControlHost 5054'
$allowedDatabases = @('DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV')
$createdRestoreDatabases = New-Object Collections.Generic.List[string]
$restoreEvidenceComplete = $false

function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
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

function New-SqlConnection([string]$Database = 'master') {
    if ($Database -ne 'master' -and $Database -notin $allowedDatabases -and $Database -notmatch '^DLE_OS_(OPERATIONAL|SECURITY)_DEV_RESTORE_TEST_[0-9]{8}T[0-9]{6}Z$') {
        throw "Refusing SQL access outside the Phase 1 DEV allowlist: $Database"
    }
    $connectionString = "Server=lpc:.\SQLEXPRESS;Database=$Database;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=10;Application Name=DLE-OS Phase1 Preservation;"
    New-Object System.Data.SqlClient.SqlConnection($connectionString)
}

function Invoke-SqlTable([string]$Database,[string]$Query,[int]$TimeoutSeconds = 120) {
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

function Invoke-SqlNonQuery([string]$Database,[string]$Query,[int]$TimeoutSeconds = 900) {
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

function Escape-SqlLiteral([string]$Value) { $Value.Replace("'", "''") }
function Quote-SqlIdentifier([string]$Value) { '[' + $Value.Replace(']', ']]') + ']' }

function Invoke-WebEvidence([string]$Uri,[switch]$UseDefaultCredentials) {
    try {
        $parameters = @{ Uri=$Uri; TimeoutSec=20; UseBasicParsing=$true }
        if ($UseDefaultCredentials) { $parameters.UseDefaultCredentials = $true }
        $response = Invoke-WebRequest @parameters
        [ordered]@{ Passed=([int]$response.StatusCode -eq 200); Status=[int]$response.StatusCode; Uri=$Uri; Body=$response.Content }
    }
    catch {
        $status = $null
        if ($_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch {} }
        [ordered]@{ Passed=$false; Status=$status; Uri=$Uri; Error=$_.Exception.Message }
    }
}

function Get-TaskEvidence([string]$TaskPath,[string]$TaskName,[string]$FileStem) {
    $task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskPath $TaskPath -TaskName $TaskName
    $xmlPath = Join-Path $taskEvidenceRoot ($FileStem + '.xml')
    Export-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName | Set-Content -LiteralPath $xmlPath -Encoding Unicode
    [ordered]@{
        TaskPath=$TaskPath
        TaskName=$TaskName
        State=[string]$task.State
        Enabled=[bool]$task.Settings.Enabled
        Principal=[ordered]@{UserId=$task.Principal.UserId;LogonType=[string]$task.Principal.LogonType;RunLevel=[string]$task.Principal.RunLevel}
        Triggers=@($task.Triggers | ForEach-Object { [ordered]@{Type=$_.CimClass.CimClassName;Enabled=$_.Enabled;StartBoundary=$_.StartBoundary;Delay=$_.Delay} })
        Actions=@($task.Actions | ForEach-Object { [ordered]@{Execute=$_.Execute;Arguments=$_.Arguments;WorkingDirectory=$_.WorkingDirectory} })
        ExecutionTimeLimit=[string]$task.Settings.ExecutionTimeLimit
        RestartCount=[int]$task.Settings.RestartCount
        RestartInterval=[string]$task.Settings.RestartInterval
        MultipleInstances=[string]$task.Settings.MultipleInstances
        LastRunTime=$info.LastRunTime
        LastTaskResult=[int64]$info.LastTaskResult
        XmlPath=$xmlPath
        XmlSha256=Get-Sha256 $xmlPath
    }
}

function Get-HealthSnapshot {
    $services = @('MSSQL$SQLEXPRESS','DleOsKeycloak','sshd','BrAmSvc','WinDefend','mpssvc','DleOsDevelopmentFrontend') | ForEach-Object {
        Get-Service -Name $_ -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType
    }
    $frontend = Invoke-WebEvidence 'http://dle-os-host:5051/shared'
    $canonical = Invoke-WebEvidence 'http://127.0.0.1:5052/api/platform/live/v1/readiness'
    $guard = Invoke-WebEvidence 'http://127.0.0.1:5052/api/development/v1/security'
    $keycloak = Invoke-WebEvidence 'https://auth.internal.dlemfg.com/realms/dle-os/.well-known/openid-configuration'
    $operational = Invoke-WebEvidence 'http://dle-os-host:5051/api/operations-center/v1/work-orders/0115622/verified-status-history' -UseDefaultCredentials
    $sql = Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT @@SERVERNAME ServerName,SUSER_SNAME() LoginName,IS_SRVROLEMEMBER('sysadmin') IsSysadmin,CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) ProductVersion;")
    $candidate = Get-ScheduledTask -TaskPath $candidateTaskPath -TaskName $candidateTaskName
    $legacy = Get-ScheduledTask -TaskPath $legacyTaskPath -TaskName $legacyTaskName
    $secureBoot = try { [bool](Confirm-SecureBootUEFI) } catch { $null }
    $deviceGuard = Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard -ErrorAction SilentlyContinue |
        Select-Object VirtualizationBasedSecurityStatus,SecurityServicesConfigured,SecurityServicesRunning,CodeIntegrityPolicyEnforcementStatus,UsermodeCodeIntegrityPolicyEnforcementStatus
    $defender = Get-MpComputerStatus |
        Select-Object AMServiceEnabled,AntivirusEnabled,BehaviorMonitorEnabled,RealTimeProtectionEnabled,IsTamperProtected,AntivirusSignatureLastUpdated
    [ordered]@{
        CapturedUtc=[DateTimeOffset]::UtcNow
        Frontend5051=$frontend
        Canonical5052=$canonical
        CanonicalGuard=$guard
        Operational5051To5054=$operational
        Keycloak=$keycloak
        Sql=$sql
        Services=$services
        Listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 22,5051,5052,5054,5041,5042,5043 } | Select-Object LocalAddress,LocalPort,OwningProcess,State)
        Candidate=[ordered]@{State=[string]$candidate.State;Enabled=[bool]$candidate.Settings.Enabled;ExecutionTimeLimit=[string]$candidate.Settings.ExecutionTimeLimit}
        Legacy=[ordered]@{State=[string]$legacy.State;Enabled=[bool]$legacy.Settings.Enabled}
        SacState=[int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
        SecureBoot=$secureBoot
        DeviceGuard=$deviceGuard
        Defender=$defender
        SshFirewall=@(Get-NetFirewallRule -DisplayName 'OpenSSH SSH Server (sshd)' -ErrorAction SilentlyContinue | ForEach-Object {
            [ordered]@{Name=$_.Name;Enabled=[string]$_.Enabled;Direction=[string]$_.Direction;Action=[string]$_.Action;RemoteAddress=@(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $_ | Select-Object -ExpandProperty RemoteAddress)}
        })
        LiveListeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 5041,5042,5043 } | Select-Object LocalAddress,LocalPort,OwningProcess)
    }
}

function Get-DatabaseSnapshot([string]$Database) {
    $objectCounts = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
SELECT type_desc AS ObjectType,COUNT_BIG(*) AS [ObjectCount] FROM sys.objects WHERE is_ms_shipped=0 GROUP BY type_desc ORDER BY type_desc;
"@)
    $tableCounts = Convert-DataTableRows (Invoke-SqlTable $Database @"
SET NOCOUNT ON;
SELECT s.name AS SchemaName,t.name AS TableName,SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS [RowCount]
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
LEFT JOIN sys.partitions p ON p.object_id=t.object_id
WHERE t.is_ms_shipped=0 GROUP BY s.name,t.name ORDER BY s.name,t.name;
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

function Test-SnapshotsEquivalent($Source,$Restored) {
    $sourceObjects = $Source.ObjectCounts | ConvertTo-Json -Compress -Depth 5
    $restoredObjects = $Restored.ObjectCounts | ConvertTo-Json -Compress -Depth 5
    $sourceTables = $Source.TableCounts | ConvertTo-Json -Compress -Depth 5
    $restoredTables = $Restored.TableCounts | ConvertTo-Json -Compress -Depth 5
    $sourceSecurity = $Source.SecurityCounts | ConvertTo-Json -Compress -Depth 5
    $restoredSecurity = $Restored.SecurityCounts | ConvertTo-Json -Compress -Depth 5
    [ordered]@{
        ObjectCountsMatch=($sourceObjects -ceq $restoredObjects)
        TableRowCountsMatch=($sourceTables -ceq $restoredTables)
        SecurityCountsMatch=($sourceSecurity -ceq $restoredSecurity)
        Passed=($sourceObjects -ceq $restoredObjects -and $sourceTables -ceq $restoredTables -and $sourceSecurity -ceq $restoredSecurity)
    }
}

function Get-OperationalKnownRecords([string]$Database) {
    $query = @"
SET NOCOUNT ON;
SELECT
 (SELECT COUNT_BIG(*) FROM operational.OperationsCenterVerifiedStatusEvent WHERE WorkOrderNumber='0115622' AND StatusText='In production - unknown emp') AS Wo0115622ExpectedStatusCount,
 (SELECT COUNT_BIG(*) FROM operational.OperationsCenterWorkOrderVerifiedStatusEvent WHERE WorkOrderNumber='0115623' AND StatusText LIKE '%kit short%') AS Wo0115623KitShortStatusCount,
 (SELECT COUNT_BIG(*) FROM operational.KittingDispositionEvent WHERE WorkOrderNumber='0115623' AND ResultingDisposition='KIT_SHORT') AS Wo0115623KitShortHistoryCount,
 (SELECT COUNT_BIG(*) FROM operational.KittingCase WHERE WorkOrderNumber='0115621' AND IsActive=1) AS Wo0115621ActiveKittingCaseCount,
 (SELECT COUNT_BIG(*) FROM operational.KittingCaseEvent WHERE Actor='dev.kitting') AS DevKittingEventCount,
 (SELECT MAX(RecordedAtUtc) FROM operational.OperationsCenterVerifiedStatusEvent) AS LatestOperationsCenterStatusUtc;
"@
    Convert-DataTableRows (Invoke-SqlTable $Database $query)
}

function Backup-And-RestoreDatabase([string]$Database,[string]$DefaultBackupPath,[string]$DefaultDataPath) {
    if ($Database -notin $allowedDatabases) { throw "Backup refused for non-DEV database $Database" }
    $fileStem = $Database + '_' + $stamp + '_COPY_ONLY_CHECKSUM'
    $sqlBackupPath = Join-Path $DefaultBackupPath ($fileStem + '.bak')
    $governedBackupPath = Join-Path $backupRoot ($fileStem + '.bak')
    if (Test-Path -LiteralPath $sqlBackupPath) { throw "Versioned SQL backup already exists: $sqlBackupPath" }
    if (Test-Path -LiteralPath $governedBackupPath) { throw "Versioned governed backup already exists: $governedBackupPath" }
    $quotedDatabase = Quote-SqlIdentifier $Database
    $escapedBackup = Escape-SqlLiteral $sqlBackupPath
    $startedUtc = [DateTimeOffset]::UtcNow
    Invoke-SqlNonQuery 'master' "BACKUP DATABASE $quotedDatabase TO DISK=N'$escapedBackup' WITH COPY_ONLY,CHECKSUM,INIT,NAME=N'DLE-OS Phase1 $Database $stamp',STATS=10;" 1800
    $completedUtc = [DateTimeOffset]::UtcNow
    Invoke-SqlNonQuery 'master' "RESTORE VERIFYONLY FROM DISK=N'$escapedBackup' WITH CHECKSUM;" 900
    Copy-Item -LiteralPath $sqlBackupPath -Destination $governedBackupPath
    $sourceSnapshot = Get-DatabaseSnapshot $Database
    $restoreName = $Database + '_RESTORE_TEST_' + $stamp
    $createdRestoreDatabases.Add($restoreName)
    $fileList = Invoke-SqlTable 'master' "RESTORE FILELISTONLY FROM DISK=N'$escapedBackup';" 300
    $moves = New-Object Collections.Generic.List[string]
    $dataIndex = 0
    $logIndex = 0
    foreach ($file in $fileList.Rows) {
        $logical = Escape-SqlLiteral ([string]$file.LogicalName)
        if ([string]$file.Type -eq 'L') {
            $logIndex++
            $destination = Join-Path $DefaultDataPath ($restoreName + '_log' + $logIndex + '.ldf')
        } else {
            $dataIndex++
            $destination = Join-Path $DefaultDataPath ($restoreName + '_data' + $dataIndex + '.mdf')
        }
        $moves.Add("MOVE N'$logical' TO N'$(Escape-SqlLiteral $destination)'")
    }
    $restoreSql = "RESTORE DATABASE $(Quote-SqlIdentifier $restoreName) FROM DISK=N'$escapedBackup' WITH CHECKSUM,RECOVERY," + ($moves -join ',') + ';'
    Invoke-SqlNonQuery 'master' $restoreSql 1800
    $restoredSnapshot = Get-DatabaseSnapshot $restoreName
    $comparison = Test-SnapshotsEquivalent $sourceSnapshot $restoredSnapshot
    $known = $null
    $knownPassed = $true
    if ($Database -eq 'DLE_OS_OPERATIONAL_DEV') {
        $known = @(Get-OperationalKnownRecords $restoreName)[0]
        $knownPassed = [int64]$known.Wo0115622ExpectedStatusCount -gt 0 -and
            [int64]$known.Wo0115623KitShortStatusCount -gt 0 -and
            [int64]$known.Wo0115623KitShortHistoryCount -gt 0 -and
            [int64]$known.Wo0115621ActiveKittingCaseCount -gt 0 -and
            [int64]$known.DevKittingEventCount -gt 0 -and
            [datetime]$known.LatestOperationsCenterStatusUtc -ge [datetime]'2026-08-22T00:00:00Z'
    }
    $result = [ordered]@{
        Database=$Database
        StartedUtc=$startedUtc
        CompletedUtc=$completedUtc
        SqlBackupPath=$sqlBackupPath
        GovernedBackupPath=$governedBackupPath
        BackupSize=(Get-Item -LiteralPath $governedBackupPath).Length
        SqlBackupSha256=Get-Sha256 $sqlBackupPath
        GovernedBackupSha256=Get-Sha256 $governedBackupPath
        CopiesMatch=((Get-Sha256 $sqlBackupPath) -ceq (Get-Sha256 $governedBackupPath))
        VerifyOnly='PASS'
        RestoreDatabase=$restoreName
        RestoreComparison=$comparison
        KnownOperationalRecords=$known
        KnownOperationalRecordsPassed=$knownPassed
        Passed=($comparison.Passed -and $knownPassed)
    }
    $resultPath = Join-Path $databaseEvidenceRoot ($Database + '-backup-restore.json')
    $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding UTF8
    if (-not $result.Passed) { throw "Restore qualification failed for $Database; the isolated restore database has been retained for review." }
    $result
}

function Get-FileInventory([string[]]$Roots) {
    $items = New-Object Collections.Generic.List[object]
    foreach ($root in $Roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $rootItem = Get-Item -LiteralPath $root -Force
        if (-not $rootItem.PSIsContainer) {
            $items.Add([pscustomobject]@{Path=$rootItem.FullName;Length=$rootItem.Length;LastWriteTimeUtc=$rootItem.LastWriteTimeUtc;Sha256=Get-Sha256 $rootItem.FullName})
            continue
        }
        foreach ($file in Get-ChildItem -LiteralPath $root -File -Recurse -Force) {
            $items.Add([pscustomobject]@{Path=$file.FullName;Length=$file.Length;LastWriteTimeUtc=$file.LastWriteTimeUtc;Sha256=Get-Sha256 $file.FullName})
        }
    }
    @($items)
}

try {
    $candidateTask = Get-TaskEvidence $candidateTaskPath $candidateTaskName 'candidate-5054-task'
    $legacyTask = Get-TaskEvidence $legacyTaskPath $legacyTaskName 'legacy-5054-task'
    [ordered]@{Candidate=$candidateTask;Legacy=$legacyTask} | ConvertTo-Json -Depth 15 |
        Set-Content -LiteralPath (Join-Path $taskEvidenceRoot 'task-preflight.json') -Encoding UTF8
    if (-not $candidateTask.Enabled -or $candidateTask.State -ne 'Running' -or $candidateTask.ExecutionTimeLimit -ne 'PT0S') { throw 'Candidate task is not at the qualified running/unlimited baseline.' }
    if ($legacyTask.Enabled -or $legacyTask.State -ne 'Disabled') { throw 'Legacy task is not at the qualified disabled baseline.' }
    $candidateAction = @($candidateTask.Actions)[0]
    if ($candidateAction.WorkingDirectory -notmatch '^C:\\DLE-OS\\Development\\OperationalControlHost5054\\Releases\\(dev5054-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12})$') {
        throw 'Candidate task does not reference a governed immutable release.'
    }
    $releaseId = $Matches[1]
    $releasePath = $candidateAction.WorkingDirectory
    $manifestPath = Join-Path 'C:\DLE-OS\Development\OperationalControlHost5054\Manifests' ($releaseId + '.json')
    $launcherPath = Join-Path $releasePath 'Start-DevOperationalControlHost5054.ps1'
    $executablePath = Join-Path $releasePath 'DleOs.DevOperationalControlHost.exe'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if (@($manifest.files).Count -ne 47) { throw "Expected 47 manifested release files; found $(@($manifest.files).Count)." }
    $releaseFiles = @($manifest.files | ForEach-Object {
        $path = Join-Path $releasePath $_.relativePath
        [ordered]@{RelativePath=$_.relativePath;ExpectedLength=[int64]$_.length;ActualLength=(Get-Item -LiteralPath $path).Length;ExpectedSha256=$_.sha256;ActualSha256=Get-Sha256 $path}
    })
    $releaseMismatches = @($releaseFiles | Where-Object { $_.ExpectedLength -ne $_.ActualLength -or $_.ExpectedSha256 -cne $_.ActualSha256 })
    if ($releaseMismatches.Count -ne 0) { throw 'The running immutable release differs from its governed manifest.' }
    $runtimeSid = (New-Object Security.Principal.NTAccount('DLE-OS-HOST','DLE-OS-DEV-CONTROL')).Translate([Security.Principal.SecurityIdentifier]).Value
    $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath,$executablePath,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
        $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
        [ordered]@{ProcessId=[int]$_.ProcessId;ParentProcessId=[int]$_.ParentProcessId;ExecutablePath=$_.ExecutablePath;CommandLine=$_.CommandLine;CreationDate=$_.CreationDate;WorkingSetSize=[int64]$_.WorkingSetSize;Owner=if($owner.ReturnValue -eq 0){"$($owner.Domain)\$($owner.User)"}else{$null}}
    })
    if ($processes.Count -ne 1 -or $processes[0].Owner -ine 'DLE-OS-HOST\DLE-OS-DEV-CONTROL') { throw 'The qualified 5054 runtime process identity/count is not intact.' }
    $gitExecutable = 'C:\Program Files\Git\cmd\git.exe'
    if (-not (Test-Path -LiteralPath $gitExecutable -PathType Leaf)) { throw 'The governed Git executable is unavailable.' }
    $gitHeadOutput = @(& $gitExecutable -c "safe.directory=$RepositoryRoot" -C $RepositoryRoot rev-parse HEAD 2>&1)
    if ($LASTEXITCODE -ne 0 -or $gitHeadOutput.Count -eq 0) { throw ('Unable to capture Git HEAD: ' + ($gitHeadOutput -join ' ')) }
    $gitHead = ([string]$gitHeadOutput[0]).Trim()
    $gitBranchOutput = @(& $gitExecutable -c "safe.directory=$RepositoryRoot" -C $RepositoryRoot branch --show-current 2>&1)
    if ($LASTEXITCODE -ne 0 -or $gitBranchOutput.Count -eq 0) { throw ('Unable to capture the Git branch: ' + ($gitBranchOutput -join ' ')) }
    $gitBranch = ([string]$gitBranchOutput[0]).Trim()
    $gitStatus = @(& $gitExecutable -c "safe.directory=$RepositoryRoot" -C $RepositoryRoot status --short --untracked-files=all 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('Unable to capture complete Git status: ' + ($gitStatus -join ' ')) }
    $healthBefore = Get-HealthSnapshot
    $baseline = [ordered]@{
        Schema='dle-os.phase1-qualified-runtime-baseline.v1';RunId=$runId;CapturedUtc=[DateTimeOffset]::UtcNow;ElevatedIdentity=$identity.Name
        Release=[ordered]@{ReleaseId=$releaseId;ReleasePath=$releasePath;FileCount=$releaseFiles.Count;Files=$releaseFiles;ManifestPath=$manifestPath;ManifestSha256=Get-Sha256 $manifestPath;LauncherPath=$launcherPath;LauncherSha256=Get-Sha256 $launcherPath}
        CandidateTask=$candidateTask;LegacyTask=$legacyTask
        RuntimeIdentity=[ordered]@{Name='DLE-OS-HOST\DLE-OS-DEV-CONTROL';Sid=$runtimeSid}
        RuntimeConfiguration=[ordered]@{Listener='http://dle-os-host:5054';OperationalDatabase='DLE_OS_OPERATIONAL_DEV';SecurityDatabase='DLE_OS_SECURITY_DEV';CanonicalReadEndpoint='http://DLE-OS-HOST:5052';DevDataRoot='C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data';ValidatorPublicKey='C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem'}
        Processes=$processes;Listener5054=@(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction Stop | Select-Object LocalAddress,LocalPort,OwningProcess,State)
        Health=$healthBefore;Git=[ordered]@{Head=$gitHead;Branch=$gitBranch;Status=$gitStatus}
    }
    $baselinePath = Join-Path $evidenceRoot 'qualified-runtime-baseline.json'
    $baseline | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $baselinePath -Encoding UTF8

    $serverPaths = @(Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(4000)) DefaultBackupPath,CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(4000)) DefaultDataPath;"))[0]
    if (-not $serverPaths.DefaultBackupPath -or -not $serverPaths.DefaultDataPath) { throw 'SQL Server did not report its governed default backup/data paths.' }
    $databaseInventory = @($allowedDatabases | ForEach-Object { Get-DatabaseSnapshot $_ })
    $databaseInventory | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $databaseEvidenceRoot 'active-dev-database-inventory.json') -Encoding UTF8

    $operationalResult = Backup-And-RestoreDatabase 'DLE_OS_OPERATIONAL_DEV' $serverPaths.DefaultBackupPath $serverPaths.DefaultDataPath
    $securityResult = Backup-And-RestoreDatabase 'DLE_OS_SECURITY_DEV' $serverPaths.DefaultBackupPath $serverPaths.DefaultDataPath
    $restoreEvidenceComplete = $operationalResult.Passed -and $securityResult.Passed
    if (-not $restoreEvidenceComplete) { throw 'One or more isolated restore qualifications failed.' }

    foreach ($restoreName in @($createdRestoreDatabases)) {
        Invoke-SqlNonQuery 'master' "ALTER DATABASE $(Quote-SqlIdentifier $restoreName) SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE $(Quote-SqlIdentifier $restoreName);" 300
    }
    $cleanup = [ordered]@{CapturedUtc=[DateTimeOffset]::UtcNow;DroppedRestoreDatabases=@($createdRestoreDatabases);RemainingRestoreDatabases=Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name LIKE 'DLE[_]OS[_]%[_]DEV[_]RESTORE[_]TEST[_]%';");ActiveDevDatabases=Convert-DataTableRows (Invoke-SqlTable 'master' "SET NOCOUNT ON; SELECT name,state_desc FROM sys.databases WHERE name IN ('DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV');")}
    $cleanup | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $databaseEvidenceRoot 'restore-test-cleanup.json') -Encoding UTF8

    $filesystemRoots = @(
        'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data',
        'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem',
        $releasePath,
        $manifestPath,
        'C:\DLE-OS\Development\OperationalControlHost5054\Pointers',
        'C:\DLE-OS\Development\OperationalControlHost5054\Evidence'
    )
    $filesystemInventory = Get-FileInventory $filesystemRoots
    $filesystemInventory | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $filesystemEvidenceRoot 'governed-dev-filesystem-inventory.json') -Encoding UTF8
    $releaseArchive = Join-Path $preservationRoot ($releaseId + '.zip')
    Compress-Archive -Path (Join-Path $releasePath '*') -DestinationPath $releaseArchive -CompressionLevel Optimal
    $devDataArchive = Join-Path $preservationRoot ('DevelopmentOperationalControl-Data-' + $stamp + '.zip')
    Compress-Archive -Path 'C:\ProgramData\DLE-OS\DevelopmentOperationalControl\Data\*' -DestinationPath $devDataArchive -CompressionLevel Optimal
    Copy-Item -LiteralPath $manifestPath,$launcherPath,(Join-Path $taskEvidenceRoot 'candidate-5054-task.xml'),(Join-Path $taskEvidenceRoot 'legacy-5054-task.xml') -Destination $preservationRoot
    Copy-Item -LiteralPath 'C:\ProgramData\DLE-OS\DevelopmentIdentity\Keys\validator-public.pem' -Destination $preservationRoot
    $pointerStatePath = 'C:\DLE-OS\Development\OperationalControlHost5054\Pointers\pointer-state.json'
    if (Test-Path -LiteralPath $pointerStatePath -PathType Leaf) { Copy-Item -LiteralPath $pointerStatePath -Destination $preservationRoot }
    $selectedEvidence = @(
        'dev5054-candidate-current-state.json','dev5054-15-minute-stability.json','dev5054-credential-task-repair.json',
        'dev5054-negative-live-access.json','dev5054-legacy-task-disposition.json','dev-operational-data-inventory.json',
        'dev-operational-data-inventory-metadata.json'
    ) | ForEach-Object { Join-Path (Join-Path $RepositoryRoot 'Tests\DevControlSeparation001') $_ } | Where-Object { Test-Path -LiteralPath $_ }
    Copy-Item -LiteralPath $selectedEvidence -Destination $preservationRoot
    $preservationInventory = Get-FileInventory @($preservationRoot)
    $preservationInventory | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $filesystemEvidenceRoot 'preservation-package-inventory.json') -Encoding UTF8

    $healthAfter = Get-HealthSnapshot
    $healthAfter | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $regressionEvidenceRoot 'post-preservation-health.json') -Encoding UTF8
    $candidateFinalXmlPath = Join-Path $regressionEvidenceRoot 'candidate-5054-task-final.xml'
    $legacyFinalXmlPath = Join-Path $regressionEvidenceRoot 'legacy-5054-task-final.xml'
    Export-ScheduledTask -TaskPath $candidateTaskPath -TaskName $candidateTaskName | Set-Content -LiteralPath $candidateFinalXmlPath -Encoding Unicode
    Export-ScheduledTask -TaskPath $legacyTaskPath -TaskName $legacyTaskName | Set-Content -LiteralPath $legacyFinalXmlPath -Encoding Unicode
    $candidateTaskUnchanged = $candidateTask.XmlSha256 -ceq (Get-Sha256 $candidateFinalXmlPath)
    $legacyTaskUnchanged = $legacyTask.XmlSha256 -ceq (Get-Sha256 $legacyFinalXmlPath)
    $liveBefore = @($healthBefore.LiveListeners | ForEach-Object { "$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }) -join ';'
    $liveAfter = @($healthAfter.LiveListeners | ForEach-Object { "$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }) -join ';'
    $requiredServices = @('MSSQL$SQLEXPRESS','DleOsKeycloak','sshd','BrAmSvc','WinDefend','mpssvc','DleOsDevelopmentFrontend')
    $servicesHealthy = @($healthAfter.Services | Where-Object { $_.Name -in $requiredServices -and ([string]$_.Status -ne 'Running' -or [string]$_.StartType -ne 'Automatic') }).Count -eq 0
    $guardBody = if($healthAfter.CanonicalGuard.Body){$healthAfter.CanonicalGuard.Body|ConvertFrom-Json}else{$null}
    $regressionPassed = $healthAfter.Frontend5051.Passed -and $healthAfter.Canonical5052.Passed -and $healthAfter.CanonicalGuard.Passed -and
        $guardBody -and $guardBody.verdict -eq 'PASS' -and $guardBody.insert.result -eq 'DENIED' -and $guardBody.update.result -eq 'DENIED' -and $guardBody.delete.result -eq 'DENIED' -and
        $healthAfter.Keycloak.Passed -and $healthAfter.Operational5051To5054.Passed -and $servicesHealthy -and
        $healthAfter.Candidate.Enabled -and $healthAfter.Candidate.State -eq 'Running' -and -not $healthAfter.Legacy.Enabled -and $healthAfter.Legacy.State -eq 'Disabled' -and
        $healthAfter.SacState -eq $healthBefore.SacState -and $liveAfter -ceq $liveBefore -and $candidateTaskUnchanged -and $legacyTaskUnchanged -and
        @(Get-NetTCPConnection -State Listen -LocalPort 5054 -ErrorAction SilentlyContinue).Count -gt 0
    $final = [ordered]@{
        Schema='dle-os.phase1-preservation-summary.v1';RunId=$runId;CompletedUtc=[DateTimeOffset]::UtcNow
        EvidenceRoot=$evidenceRoot;GovernedBackupRoot=$backupRoot
        QualifiedRuntimeBaselineCaptured=$true;ReleaseFileCount=$releaseFiles.Count;ReleaseMismatchCount=$releaseMismatches.Count
        OperationalBackupVerified=$operationalResult.Passed;SecurityBackupVerified=$securityResult.Passed
        OperationalRestorePassed=$operationalResult.RestoreComparison.Passed;SecurityRestorePassed=$securityResult.RestoreComparison.Passed
        KnownRecentDevRecordsVerified=$operationalResult.KnownOperationalRecordsPassed
        RestoreTestsDroppedAfterEvidence=$true
        GovernedPreservationComplete=($preservationInventory.Count -gt 0)
        IndependentOffHostCopy='NOT YET'
        IndependentCopyReason='All identified governed backup and qualification destinations are on the C: volume of DLE-OS-HOST; no pre-approved off-host destination was found.'
        RuntimeRegressionPassed=$regressionPassed
        CandidateTaskUnchanged=$candidateTaskUnchanged
        LegacyTaskUnchanged=$legacyTaskUnchanged
        Phase1DataTransactionPassed=($operationalResult.Passed -and $securityResult.Passed -and $regressionPassed)
    }
    $finalPath = Join-Path $evidenceRoot 'phase1-preservation-summary.json'
    $final | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $finalPath -Encoding UTF8
    $final | ConvertTo-Json -Depth 10
    if (-not $final.Phase1DataTransactionPassed) { throw 'Phase 1 preservation completed but the final regression gate did not pass.' }
}
catch {
    $failure = [ordered]@{
        Schema='dle-os.phase1-preservation-failure.v1'
        RunId=$runId
        FailedUtc=[DateTimeOffset]::UtcNow
        ExceptionType=$_.Exception.GetType().FullName
        Message=$_.Exception.Message
        FullyQualifiedErrorId=$_.FullyQualifiedErrorId
        ScriptStackTrace=$_.ScriptStackTrace
        RestoreEvidenceComplete=$restoreEvidenceComplete
        IsolatedRestoreDatabases=@($createdRestoreDatabases)
    }
    $failure | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'phase1-failure.json') -Encoding UTF8
    throw
}
finally {
    if (-not $restoreEvidenceComplete -and $createdRestoreDatabases.Count -gt 0) {
        Write-Warning ('Restore evidence did not complete. Isolated restore databases were intentionally retained for review: ' + ($createdRestoreDatabases -join ', '))
    }
    try { Stop-Transcript | Out-Null } catch {}
}
