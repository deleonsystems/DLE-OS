[CmdletBinding()]
param(
    [string]$EvidenceRoot = 'C:\DLE-OS\Qualification\DevResilience\Phase1',
    [string]$GovernedBackupRoot = 'C:\DLE-OS\Backups\DevResilience'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
    $identity.Name -ine 'DLE-OS-HOST\Miguel') {
    throw 'An elevated DLE-OS-HOST\Miguel session is required.'
}

$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runId = 'phase1-database-backup-' + $stamp
$runEvidence = Join-Path $EvidenceRoot $runId
$runBackup = Join-Path $GovernedBackupRoot $runId
$null = New-Item -ItemType Directory -Path $runEvidence,$runBackup -Force

function New-Connection([string]$Database) {
    if ($Database -notin @('master','DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV')) {
        throw "Database outside the fixed Phase 1 allowlist: $Database"
    }
    New-Object System.Data.SqlClient.SqlConnection("Server=lpc:.\SQLEXPRESS;Database=$Database;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;Connect Timeout=10;Application Name=DLE-OS Phase1 Backup Only;")
}

function Invoke-Scalar([string]$Query) {
    $connection = New-Connection 'master'
    try { $connection.Open();$command=$connection.CreateCommand();$command.CommandText=$Query;$command.CommandTimeout=30;$command.ExecuteScalar() }
    finally { $connection.Dispose() }
}

function Invoke-NonQuery([string]$Query,[int]$Timeout=1800) {
    $connection = New-Connection 'master'
    try { $connection.Open();$command=$connection.CreateCommand();$command.CommandText=$Query;$command.CommandTimeout=$Timeout;$null=$command.ExecuteNonQuery() }
    finally { $connection.Dispose() }
}

$defaultBackupPath = [string](Invoke-Scalar "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(4000));")
if (-not $defaultBackupPath) { throw 'SQL Server did not report its default backup path.' }
$results = @()
foreach ($database in @('DLE_OS_OPERATIONAL_DEV','DLE_OS_SECURITY_DEV')) {
    $fileName = $database + '_' + $stamp + '_COPY_ONLY_CHECKSUM.bak'
    $sqlPath = Join-Path $defaultBackupPath $fileName
    $governedPath = Join-Path $runBackup $fileName
    if (Test-Path -LiteralPath $sqlPath) { throw "Versioned SQL backup already exists: $sqlPath" }
    if (Test-Path -LiteralPath $governedPath) { throw "Versioned governed backup already exists: $governedPath" }
    $escaped = $sqlPath.Replace("'","''")
    $started = [DateTimeOffset]::UtcNow
    Invoke-NonQuery "BACKUP DATABASE [$database] TO DISK=N'$escaped' WITH COPY_ONLY,CHECKSUM,INIT,NAME=N'DLE-OS Phase1 $database $stamp',STATS=10;"
    $completed = [DateTimeOffset]::UtcNow
    Copy-Item -LiteralPath $sqlPath -Destination $governedPath
    $sqlHash = (Get-FileHash -LiteralPath $sqlPath -Algorithm SHA256).Hash
    $governedHash = (Get-FileHash -LiteralPath $governedPath -Algorithm SHA256).Hash
    $results += [pscustomobject]@{
        Database=$database
        StartedUtc=$started
        CompletedUtc=$completed
        SqlBackupPath=$sqlPath
        GovernedBackupPath=$governedPath
        Size=(Get-Item -LiteralPath $governedPath).Length
        SqlBackupSha256=$sqlHash
        GovernedBackupSha256=$governedHash
        CopiesMatch=($sqlHash -ceq $governedHash)
        BackupCreatedWithCopyOnlyAndChecksum=$true
        RestoreVerifyOnly='BLOCKED_EXISTING_SQL_AUTHORITY_REQUIRED'
        IsolatedRestoreTest='NOT_RUN'
    }
}

$summary = [ordered]@{
    Schema='dle-os.phase1-dev-database-backups.v1'
    RunId=$runId
    CompletedUtc=[DateTimeOffset]::UtcNow
    Identity=$identity.Name
    IsSysadmin=[int](Invoke-Scalar "SELECT IS_SRVROLEMEMBER('sysadmin');")
    HasCreateAnyDatabase=[int](Invoke-Scalar "SELECT HAS_PERMS_BY_NAME(NULL,NULL,'CREATE ANY DATABASE');")
    Backups=$results
    BackupCreationPassed=(@($results | Where-Object { -not $_.CopiesMatch }).Count -eq 0 -and $results.Count -eq 2)
    RestoreQualificationPassed=$false
    Blocker='Miguel has database backup authority but not the existing SQL authority required for RESTORE VERIFYONLY or isolated CREATE/RESTORE DATABASE operations. No SQL permissions were changed.'
}
$summaryPath = Join-Path $runEvidence 'database-backup-summary.json'
$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 12
if (-not $summary.BackupCreationPassed) { throw 'One or more DEV database backup copies failed hash comparison.' }
