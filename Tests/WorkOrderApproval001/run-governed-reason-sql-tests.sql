:ON ERROR EXIT
SET NOCOUNT ON;
BEGIN TRANSACTION;
GO

:r Tools/WorkOrderApproval/Database/001_AddSalesOrderLineWorkOrderDecision.sql
:r Tools/WorkOrderApproval/Database/002_AddGovernedDecisionReasons.sql

INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 ApprovedWorkOrderNumber,SupersedesDecisionId,CandidateResolutionStatusAtDecision,
 CandidateSetHash,CandidateSetJson,SelectionSource,DecisionReason,DecisionReasonCode,
 DecisionNote,ApprovedBy,RequestCorrelationId)
VALUES
(NEWID(),'001082','0011998','040','APPROVE','0115505',NULL,
 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',REPLICATE('A',64),'[]','TEST',
 'Work Order verified from supporting documentation','SUPPORTING_DOCUMENTATION_VERIFIED',
 NULL,'DLE-OS-HOST\DLE-OS',NEWID());

IF NOT EXISTS
(
    SELECT 1 FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision
    WHERE DecisionReasonCode='SUPPORTING_DOCUMENTATION_VERIFIED'
      AND DecisionNote IS NULL
)
    THROW 51101, 'Governed predefined reason did not persist.', 1;

INSERT operational.SalesOrderLineWorkOrderDecisionEvent
(DecisionId,CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,DecisionAction,
 ApprovedWorkOrderNumber,SupersedesDecisionId,CandidateResolutionStatusAtDecision,
 CandidateSetHash,CandidateSetJson,SelectionSource,DecisionReason,DecisionReasonCode,
 DecisionNote,ApprovedBy,RequestCorrelationId)
VALUES
(NEWID(),'001082','0011999','010','APPROVE','0115506',NULL,
 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE',REPLICATE('B',64),'[]','TEST',
 'Other','OTHER','Supporting email verified.','DLE-OS-HOST\DLE-OS',NEWID());

IF NOT EXISTS
(
    SELECT 1 FROM operational.vw_CurrentSalesOrderLineWorkOrderDecision
    WHERE DecisionReasonCode='OTHER' AND DecisionNote='Supporting email verified.'
)
    THROW 51102, 'Other reason note did not persist.', 1;

ROLLBACK TRANSACTION;
PRINT 'WORKORDER-APPROVAL-001 governed reason SQL migration and persistence: PASS';
