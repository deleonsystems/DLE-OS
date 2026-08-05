SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'operational.SalesOrderLineWorkOrderDecisionEvent', N'DecisionReasonCode') IS NULL
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent
        ADD DecisionReasonCode varchar(64) NULL;
GO

IF COL_LENGTH(N'operational.SalesOrderLineWorkOrderDecisionEvent', N'DecisionNote') IS NULL
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent
        ADD DecisionNote nvarchar(500) NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent')
      AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode'
)
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent WITH CHECK
        ADD CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode
        CHECK (DecisionReasonCode IS NULL OR DecisionReasonCode IN
            ('ERP_CONFIRMED_CANDIDATE_MATCH','SALES_ORDER_ITEM_MATCH',
             'HISTORICAL_RELATIONSHIP_VERIFIED','SUPPORTING_DOCUMENTATION_VERIFIED',
             'CUSTOMER_RMA_RELATIONSHIP_VERIFIED','SUPERVISOR_REVIEW','OTHER'));
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent')
      AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_OtherNote'
)
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent WITH CHECK
        ADD CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_OtherNote
        CHECK (DecisionReasonCode IS NULL OR DecisionReasonCode <> 'OTHER'
            OR NULLIF(LTRIM(RTRIM(DecisionNote)),N'') IS NOT NULL);
GO

CREATE OR ALTER VIEW operational.vw_CurrentSalesOrderLineWorkOrderDecision
AS
WITH RankedEvents AS
(
    SELECT event.*,
        ROW_NUMBER() OVER
        (
            PARTITION BY CustomerNumber, SalesOrderNumber, SalesOrderLineNumber
            ORDER BY DecisionSequence DESC
        ) AS EventRank
    FROM operational.SalesOrderLineWorkOrderDecisionEvent AS event
)
SELECT
    DecisionSequence, DecisionId, CustomerNumber, SalesOrderNumber, SalesOrderLineNumber,
    DecisionAction, ApprovedWorkOrderNumber, SupersedesDecisionId,
    CandidateResolutionStatusAtDecision, CanonicalExactWorkOrderAtDecision,
    CandidateSnapshotIdAtDecision, CandidateSnapshotImportRunId,
    CandidateSetHash, CandidateSetJson, SelectionSource,
    DecisionReason, DecisionReasonCode, DecisionNote,
    ApprovedBy, ApprovedAtUtc, RequestCorrelationId
FROM RankedEvents
WHERE EventRank = 1
  AND DecisionAction IN ('APPROVE', 'REPLACE');
GO

-- Existing rows remain byte-for-byte append-only. Their original DecisionReason is
-- returned as legacy history; governed code/note columns apply to new events.
