[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $EvidencePath,
    [switch] $PreflightOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.Name -ine 'DLE-OS-HOST\DLE-OS') {
    throw 'Development operational database initialization requires the approved DLE-OS identity.'
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$database = 'DLE_OS_OPERATIONAL_DEV'
$masterConnection = 'Server=lpc:.\SQLEXPRESS;Database=master;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;'
$developmentConnection = "Server=lpc:.\SQLEXPRESS;Database=$database;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;"
$productionConnection = 'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_CANONICAL_LIVE;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadOnly;'
$migrationPaths = @(
    'Tools\RmaRework\Database\001_AddRmaReworkCase.sql',
    'Tools\RmaRework\Database\002_AddSalesOrderLineWorkOrderInterpretation.sql',
    'Tools\WorkOrderApproval\Database\001_AddSalesOrderLineWorkOrderDecision.sql',
    'Tools\WorkOrderApproval\Database\002_AddGovernedDecisionReasons.sql',
    'Tools\WorkOrderApproval\Database\003_AddNoWorkOrderRequiredDecision.sql',
    'Tools\KittingDisposition\Database\001_AddKittingDispositionEvent.sql',
    'Tools\ShipmentStaging\Database\001_AddOperationalShipmentStaging.sql',
    'Tools\ShipmentStaging\Database\002_AddShipmentQuantityBaseline.sql'
)

function Open-Connection([string] $ConnectionString) {
    $connection = [System.Data.SqlClient.SqlConnection]::new($ConnectionString)
    $connection.Open()
    return $connection
}

function Invoke-Scalar($Connection, [string] $Sql, $Transaction = $null) {
    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    if ($null -ne $Transaction) { $command.Transaction = $Transaction }
    try { return $command.ExecuteScalar() } finally { $command.Dispose() }
}

function Invoke-NonQuery($Connection, [string] $Sql, $Transaction = $null) {
    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    if ($null -ne $Transaction) { $command.Transaction = $Transaction }
    try { [void]$command.ExecuteNonQuery() } finally { $command.Dispose() }
}

function Get-OperationalCounts([string] $ConnectionString) {
    $connection = Open-Connection $ConnectionString
    try {
        $tables = @('RmaReworkCase','RmaReworkCaseMember','RmaReworkCaseEvent',
            'SalesOrderLineWorkOrderInterpretationEvent','SalesOrderLineWorkOrderDecisionEvent',
            'KittingDispositionEvent')
        $counts = [ordered]@{}
        foreach ($table in $tables) {
            $exists = [int](Invoke-Scalar $connection "SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='operational' AND t.name='$table';")
            $counts[$table] = if ($exists) { [int64](Invoke-Scalar $connection "SELECT COUNT_BIG(*) FROM operational.[$table];") } else { $null }
        }
        return $counts
    }
    finally { $connection.Dispose() }
}

$evidence = [ordered]@{
    Verdict = 'FAIL'
    StartedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    Identity = $identity.Name
    Database = $database
    CanonicalReadSource = 'http://DLE-OS-HOST:5052'
    MigrationOrder = $migrationPaths
    ProductionCountsBefore = Get-OperationalCounts $productionConnection
}

try {
    $master = Open-Connection $masterConnection
    try {
        $exists = [int](Invoke-Scalar $master "SELECT COUNT(*) FROM sys.databases WHERE name=N'$database';") -eq 1
        $evidence.DatabaseExistedBefore = $exists
        if ($PreflightOnly) {
            $evidence.OperationalObjectsBefore = if ($exists) {
                $preflightConnection = Open-Connection $developmentConnection
                try { [int](Invoke-Scalar $preflightConnection "SELECT COUNT(*) FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id WHERE s.name='operational' AND o.is_ms_shipped=0;") }
                finally { $preflightConnection.Dispose() }
            } else { 0 }
            $evidence.MigrationProperties = [ordered]@{
                Additive = $true
                ExistingHistoryRewritten = $false
                CanonicalTablesModified = $false
                FailureBehavior = 'All migration batches run inside one outer transaction; failure rolls back migrated objects.'
                Repeatability = 'Scripts are structurally idempotent; initializer requires an empty development operational database for first installation.'
            }
            $evidence.ProductionCountsAfter = Get-OperationalCounts $productionConnection
            $evidence.Verdict = 'PREFLIGHT_PASS'
            return
        }
        if (-not $exists) {
            Invoke-NonQuery $master "CREATE DATABASE [$database]; ALTER DATABASE [$database] SET RECOVERY SIMPLE;"
            $evidence.DatabaseCreated = $true
        } else {
            $evidence.DatabaseCreated = $false
        }
    }
    finally { $master.Dispose() }

    $connection = Open-Connection $developmentConnection
    try {
        $existingOperationalObjects = [int](Invoke-Scalar $connection "SELECT COUNT(*) FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id WHERE s.name='operational' AND o.is_ms_shipped=0;")
        $evidence.OperationalObjectsBefore = $existingOperationalObjects
        if ($existingOperationalObjects -ne 0) {
            throw 'The development operational database is not empty; refusing to merge unknown state.'
        }
        $evidence.CanonicalSchemaPresent = [int](Invoke-Scalar $connection "SELECT COUNT(*) FROM sys.schemas WHERE name='canonical';") -ne 0
        if ($evidence.CanonicalSchemaPresent) { throw 'The development operational database must not contain a canonical schema.' }

        $migrationTransaction = $connection.BeginTransaction()
        try {
            foreach ($relativePath in $migrationPaths) {
                $path = Join-Path $repository $relativePath
                $script = Get-Content -Raw -LiteralPath $path
                foreach ($batch in [regex]::Split($script, '(?im)^\s*GO\s*$')) {
                    if (-not [string]::IsNullOrWhiteSpace($batch)) {
                        Invoke-NonQuery $connection $batch $migrationTransaction
                    }
                }
            }
            $migrationTransaction.Commit()
        }
        catch {
            $migrationTransaction.Rollback()
            throw
        }
        finally { $migrationTransaction.Dispose() }

        $requiredTables = @('RmaReworkCase','RmaReworkCaseMember','RmaReworkCaseEvent',
            'SalesOrderLineWorkOrderInterpretationEvent','SalesOrderLineWorkOrderDecisionEvent',
            'KittingDispositionEvent')
        foreach ($table in $requiredTables) {
            if ([int](Invoke-Scalar $connection "SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='operational' AND t.name='$table';") -ne 1) {
                throw "Required migrated table is absent: operational.$table"
            }
        }

        Invoke-NonQuery $connection 'SET XACT_ABORT OFF;'
        $qualification = $connection.BeginTransaction()
        try {
            $baseColumns = @"
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 ApprovedWorkOrderNumber,SupersedesDecisionId,CandidateResolutionStatusAtDecision,
 CandidateSetHash,CandidateSetJson,SelectionSource,DecisionReason,DecisionReasonCode,
 DecisionNote,ApprovedBy,RequestCorrelationId)
"@
            $codes = @('ERP_CONFIRMED_CANDIDATE_MATCH','SALES_ORDER_ITEM_MATCH',
                'HISTORICAL_RELATIONSHIP_VERIFIED','SUPPORTING_DOCUMENTATION_VERIFIED',
                'CUSTOMER_RMA_RELATIONSHIP_VERIFIED','SUPERVISOR_REVIEW','OTHER')
            $labels = @{
                ERP_CONFIRMED_CANDIDATE_MATCH='ERP confirmed and candidate matches'
                SALES_ORDER_ITEM_MATCH='Candidate matches Sales Order and item'
                HISTORICAL_RELATIONSHIP_VERIFIED='Historical relationship verified'
                SUPPORTING_DOCUMENTATION_VERIFIED='Work Order verified from supporting documentation'
                CUSTOMER_RMA_RELATIONSHIP_VERIFIED='Customer or RMA relationship verified'
                SUPERVISOR_REVIEW='Supervisor review'
                OTHER='Other'
            }
            for ($index=0; $index -lt $codes.Count; $index++) {
                $code = $codes[$index]
                $line = ($index + 1).ToString('000')
                $note = if ($code -eq 'OTHER') { "N'Governed development explanation.'" } else { 'NULL' }
                $label = $labels[$code].Replace("'", "''")
                Invoke-NonQuery $connection ("INSERT operational.SalesOrderLineWorkOrderDecisionEvent $baseColumns VALUES(NEWID(),'001082','0099999','$line','APPROVE','0115505',NULL,'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',REPLICATE('$index',64),'[]','TEST',N'$label','$code',$note,'DLE-OS-HOST\DLE-OS',NEWID());") $qualification
            }
            $accepted = [int](Invoke-Scalar $connection "SELECT COUNT(*) FROM operational.SalesOrderLineWorkOrderDecisionEvent WHERE SalesOrderNumber='0099999';" $qualification)
            if ($accepted -ne 7) { throw "Expected seven governed reason fixtures; found $accepted." }
            if ([int](Invoke-Scalar $connection "SELECT COUNT(*) FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision WHERE SalesOrderNumber='0099999' AND DecisionReasonCode='SUPPORTING_DOCUMENTATION_VERIFIED' AND DecisionReason='Work Order verified from supporting documentation' AND DecisionNote IS NULL;" $qualification) -ne 1) {
                throw 'The current approval view did not return the governed code, label, and null predefined note.'
            }

            foreach ($invalidSql in @(
                "INSERT operational.SalesOrderLineWorkOrderDecisionEvent $baseColumns VALUES(NEWID(),'001082','0099998','001','APPROVE','0115505',NULL,'TEST',REPLICATE('X',64),'[]','TEST','Unknown','UNKNOWN',NULL,'DLE-OS-HOST\DLE-OS',NEWID());",
                "INSERT operational.SalesOrderLineWorkOrderDecisionEvent $baseColumns VALUES(NEWID(),'001082','0099998','002','APPROVE','0115505',NULL,'TEST',REPLICATE('Y',64),'[]','TEST','Other','OTHER',N'   ','DLE-OS-HOST\DLE-OS',NEWID());"
            )) {
                try { Invoke-NonQuery $connection $invalidSql $qualification; throw 'An invalid governed reason fixture was accepted.' }
                catch [System.Data.SqlClient.SqlException] { }
            }

            Invoke-NonQuery $connection "INSERT operational.SalesOrderLineWorkOrderDecisionEvent $baseColumns VALUES(NEWID(),'001082','0099997','001','APPROVE','0115505',NULL,'TEST',REPLICATE('L',64),'[]','TEST','Legacy free-text reason',NULL,NULL,'DLE-OS-HOST\DLE-OS',NEWID());" $qualification
            if ([int](Invoke-Scalar $connection "SELECT COUNT(*) FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision WHERE SalesOrderNumber='0099997' AND DecisionReason='Legacy free-text reason' AND DecisionReasonCode IS NULL;" $qualification) -ne 1) {
                throw 'Legacy free-text approval was not queryable through the current view.'
            }
            try {
                Invoke-NonQuery $connection "UPDATE operational.SalesOrderLineWorkOrderDecisionEvent SET DecisionReason='rewrite';" $qualification
                throw 'Append-only update protection did not fire.'
            }
            catch [System.Data.SqlClient.SqlException] {
                if ($_.Exception.Number -ne 51001) { throw }
            }
            try {
                Invoke-NonQuery $connection "DELETE FROM operational.SalesOrderLineWorkOrderDecisionEvent;" $qualification
                throw 'Append-only delete protection did not fire.'
            }
            catch [System.Data.SqlClient.SqlException] {
                if ($_.Exception.Number -ne 51001) { throw }
            }
            $qualification.Rollback()
            $evidence.SqlQualification = 'PASS'
        }
        catch {
            try { $qualification.Rollback() } catch { }
            throw
        }
        finally { $qualification.Dispose() }
    }
    finally { $connection.Dispose() }

    $evidence.DevelopmentCountsAfter = Get-OperationalCounts $developmentConnection
    $evidence.ProductionCountsAfter = Get-OperationalCounts $productionConnection
    if (($evidence.ProductionCountsBefore | ConvertTo-Json -Compress) -ne
        ($evidence.ProductionCountsAfter | ConvertTo-Json -Compress)) {
        throw 'Production operational row counts changed during development database initialization.'
    }
    $evidence.Verdict = 'PASS'
}
catch {
    $evidence.Error = $_.Exception.Message
    throw
}
finally {
    $evidence.CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    New-Item -ItemType Directory -Path (Split-Path $EvidencePath -Parent) -Force | Out-Null
    $evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

[pscustomobject]$evidence
