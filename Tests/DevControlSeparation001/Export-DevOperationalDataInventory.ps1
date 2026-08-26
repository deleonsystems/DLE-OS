[CmdletBinding()]
param(
    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot 'dev-operational-data-inventory.json'
}
Add-Type -AssemblyName System.Data
$script:CurrentTable = $null

trap {
    [ordered]@{
        Schema = 'dle-os.dev-operational-data-inventory.error.v1'
        CapturedUtc = [DateTimeOffset]::UtcNow
        CurrentTable = $script:CurrentTable
        Error = $_.Exception.Message
        InnerError = $_.Exception.InnerException.Message
        ScriptStackTrace = $_.ScriptStackTrace
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$OutputPath.error.json" -Encoding utf8
    exit 1
}

function Invoke-ReadQuery {
    param(
        [System.Data.SqlClient.SqlConnection] $Connection,
        [string] $Sql
    )

    $command = $Connection.CreateCommand()
    $command.CommandTimeout = 30
    $command.CommandText = $Sql
    $reader = $command.ExecuteReader()
    try {
        $rows = @()
        while ($reader.Read()) {
            $row = [ordered]@{}
            for ($index = 0; $index -lt $reader.FieldCount; $index++) {
                $value = $reader.GetValue($index)
                $row[$reader.GetName($index)] = if ($value -is [DBNull]) { $null } else { $value }
            }
            $rows += [pscustomobject] $row
        }
        return $rows
    }
    finally {
        $reader.Close()
        $command.Dispose()
    }
}

$tables = @(
    @{ Table = 'operational.KittingCase'; Time = 'UpdatedAtUtc'; Actor = 'LastOperator'; Sample = 'CaseId,WorkOrderNumber,CaseState,RunNumber,IsActive,StartedBy,StartedAtUtc,LastOperator,LastWorkedAtUtc,UpdatedAtUtc' },
    @{ Table = 'operational.KittingCaseEvent'; Time = 'EventAtUtc'; Actor = 'Actor'; Sample = 'EventSequence,CaseId,EventType,Actor,EventAtUtc,WorkingVersion' },
    @{ Table = 'operational.KittingDispositionEvent'; Time = 'RecordedAtUtc'; Actor = 'RecordedBy'; Sample = 'EventSequence,WorkOrderNumber,EventType,ResultingDisposition,PreviousDisposition,ReasonCode,RecordedBy,RecordedAtUtc' },
    @{ Table = 'operational.KittingSubmission'; Time = 'SubmittedAtUtc'; Actor = 'SubmittedBy'; Sample = 'SubmissionId,CaseId,SubmissionType,VersionNumber,SubmittedBy,SubmittedAtUtc,PdfFileName,PdfSha256' },
    @{ Table = 'operational.LegacyKittingMaterialEvidence'; Time = 'BackfilledAtUtc'; Actor = 'BackfilledBy'; Sample = 'EvidenceSequence,WorkOrderNumber,MaterialStatus,EvidenceSource,ReconciliationClassification,BackfilledBy,BackfilledAtUtc' },
    @{ Table = 'operational.OperationsCenterVerifiedStatusEvent'; Time = 'RecordedAtUtc'; Actor = 'RecordedBy'; Sample = 'EventSequence,MasterRecordKey,SalesOrderNumber,SalesOrderLineNumber,WorkOrderNumber,StatusText,RecordedBy,RecordedAtUtc' },
    @{ Table = 'operational.OperationsCenterWorkOrderVerifiedStatusEvent'; Time = 'RecordedAtUtc'; Actor = 'RecordedBy'; Sample = 'EventSequence,WorkOrderNumber,StatusText,RecordedBy,RecordedAtUtc' },
    @{ Table = 'operational.RmaReworkCase'; Time = 'CreatedAtUtc'; Actor = 'CreatedBy'; Sample = 'CaseSequence,CaseId,CustomerNumber,CaseType,CustomerRmaNumber,InternalReference,CaseStatus,CreatedBy,CreatedAtUtc' },
    @{ Table = 'operational.RmaReworkCaseEvent'; Time = 'RecordedAtUtc'; Actor = 'RecordedBy'; Sample = 'EventSequence,CaseId,EventType,RecordedBy,RecordedAtUtc' },
    @{ Table = 'operational.RmaReworkCaseMember'; Time = 'CapturedAtUtc'; Actor = $null; Sample = 'CaseId,MemberSequence,SalesOrderNumber,SalesOrderLineNumber,ItemNumber,RelatedWorkOrderNumber,RelationshipStatus,CaseStatus,CapturedAtUtc' },
    @{ Table = 'operational.SalesOrderLineWorkOrderDecisionEvent'; Time = 'ApprovedAtUtc'; Actor = 'ApprovedBy'; Sample = 'DecisionSequence,DecisionId,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,ApprovedWorkOrderNumber,SelectionSource,DecisionReasonCode,DecisionClassification,ApprovedBy,ApprovedAtUtc' },
    @{ Table = 'operational.SalesOrderLineWorkOrderInterpretationEvent'; Time = 'RecordedAtUtc'; Actor = 'RecordedBy'; Sample = 'EventSequence,RmaCaseId,RmaMemberSequence,SalesOrderNumber,SalesOrderLineNumber,ActiveWorkOrderNumber,RelationshipRole,ResultingOperationalStatus,RecordedBy,RecordedAtUtc' },
    @{ Table = 'operational.ShipmentInvoiceAllocation'; Time = 'CreatedAtUtc'; Actor = $null; Sample = 'ShipmentInvoiceAllocationId,ShipmentInvoiceDecisionEventId,ShipmentStagingId,InvoiceHistoryLineId,AllocatedQuantity,CreatedAtUtc' },
    @{ Table = 'operational.ShipmentInvoiceDecisionEvent'; Time = 'RecordedAtUtc'; Actor = 'RecordedBy'; Sample = 'DecisionSequence,ShipmentStagingId,DecisionType,ResultingStatus,ReasonCode,ConfirmedQuantity,RecordedBy,RecordedAtUtc' },
    @{ Table = 'operational.ShipmentInvoiceMatchProposal'; Time = 'CreatedAtUtc'; Actor = $null; Sample = 'ShipmentInvoiceMatchProposalId,ReconciliationRunId,ShipmentStagingId,InvoiceNumber,InvoiceLineNumber,MatchClassification,MatchScore,CreatedAtUtc' },
    @{ Table = 'operational.ShipmentReconciliationRun'; Time = 'StartedAtUtc'; Actor = $null; Sample = 'ReconciliationRunId,TriggerType,StartedAtUtc,CompletedAtUtc,Result,ShipmentCount,FailureCode' },
    @{ Table = 'operational.ShipmentStaging'; Time = 'ProcessedAtUtc'; Actor = 'ProcessedBy'; Sample = 'ShipmentStagingId,ShipmentNumber,SalesOrderNumber,SalesOrderLineNumber,ItemNumber,QuantityProcessed,WorkOrderNumber,WorkOrderRelationshipSource,ProcessedBy,ProcessedAtUtc,CurrentStatus' },
    @{ Table = 'operational.ShipmentStagingEvent'; Time = 'RecordedAtUtc'; Actor = 'RecordedBy'; Sample = 'ShipmentStagingEventId,ShipmentStagingId,EventSequence,EventType,ResultingStatus,ReasonCode,RecordedBy,RecordedAtUtc' }
)

$connection = New-Object System.Data.SqlClient.SqlConnection (
    'Server=lpc:.\SQLEXPRESS;Database=DLE_OS_OPERATIONAL_DEV;' +
    'Integrated Security=True;Encrypt=False;Connect Timeout=8;' +
    'Application Name=DLE-OS ReadOnly Operational Audit;'
)

$connection.Open()
try {
    $identity = Invoke-ReadQuery $connection @"
SET NOCOUNT ON;
SELECT SUSER_SNAME() AS LoginName,
       ORIGINAL_LOGIN() AS OriginalLogin,
       DB_NAME() AS DatabaseName,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'SELECT') AS HasDatabaseSelect;
"@

    $inventory = @()
    foreach ($definition in $tables) {
        $script:CurrentTable = $definition.Table
        $actorExpression = if ($definition.Actor) {
            "(SELECT TOP (1) latest.[$($definition.Actor)] FROM $($definition.Table) AS latest ORDER BY latest.[$($definition.Time)] DESC)"
        }
        else {
            'CAST(NULL AS nvarchar(256))'
        }

        $summary = Invoke-ReadQuery $connection @"
SET NOCOUNT ON;
SELECT COUNT_BIG(*) AS [ExactRows],
       MAX([$($definition.Time)]) AS [MostRecentTimestamp],
       $actorExpression AS [MostRecentActor]
FROM $($definition.Table);
"@

        $samples = Invoke-ReadQuery $connection @"
SET NOCOUNT ON;
SELECT TOP (3) $($definition.Sample)
FROM $($definition.Table)
ORDER BY [$($definition.Time)] DESC;
"@

        $inventory += [ordered]@{
            Table = $definition.Table
            RowCount = $summary[0].ExactRows
            MostRecentTimestamp = $summary[0].MostRecentTimestamp
            MostRecentActor = $summary[0].MostRecentActor
            RecentSamples = $samples
        }
    }

    [ordered]@{
        Schema = 'dle-os.dev-operational-data-inventory.v1'
        CapturedUtc = [DateTimeOffset]::UtcNow
        Database = 'DLE_OS_OPERATIONAL_DEV'
        ReadOnlyAudit = $true
        Identity = $identity
        Tables = $inventory
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
}
finally {
    $connection.Close()
    $connection.Dispose()
}
