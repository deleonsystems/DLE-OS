SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'operational.SalesOrderLineWorkOrderDecisionEvent', N'DecisionClassification') IS NULL
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent
        ADD DecisionClassification varchar(64) NULL;
GO

IF EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent')
      AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_WorkOrder'
)
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent
        DROP CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_WorkOrder;
GO

ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent WITH CHECK
    ADD CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_WorkOrder
    CHECK
    (
        (DecisionAction = 'REVOKE' AND ApprovedWorkOrderNumber IS NULL)
        OR
        (DecisionAction IN ('APPROVE','REPLACE') AND
            (
                (COALESCE(DecisionClassification,'WORK_ORDER_APPROVAL') = 'WORK_ORDER_APPROVAL'
                    AND ApprovedWorkOrderNumber IS NOT NULL)
                OR
                (DecisionClassification = 'NO_WORK_ORDER_REQUIRED_COMPONENT'
                    AND ApprovedWorkOrderNumber IS NULL)
            ))
    );
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent')
      AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_Classification'
)
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent WITH CHECK
        ADD CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_Classification
        CHECK (DecisionClassification IS NULL OR DecisionClassification IN
            ('WORK_ORDER_APPROVAL','NO_WORK_ORDER_REQUIRED_COMPONENT'));
GO

IF EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent')
      AND name=N'CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode'
)
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent
        DROP CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode;
GO

IF EXISTS
(
    SELECT 1 FROM operational.SalesOrderLineWorkOrderDecisionEvent
    WHERE DecisionReasonCode='PURCHASED_RESALE_ITEM'
)
BEGIN
    -- Retired values remain readable in append-only history but are not accepted for new rows.
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent WITH NOCHECK
        ADD CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode
        CHECK (DecisionReasonCode IS NULL OR DecisionReasonCode IN
            ('ERP_CONFIRMED_CANDIDATE_MATCH','SALES_ORDER_ITEM_MATCH',
             'HISTORICAL_RELATIONSHIP_VERIFIED','SUPPORTING_DOCUMENTATION_VERIFIED',
             'CUSTOMER_RMA_RELATIONSHIP_VERIFIED','SUPERVISOR_REVIEW',
             'PART_COMPONENT_ONLY','CUSTOMER_SUPPLIED_MATERIAL',
             'SHIPPING_REPLACEMENT_MATERIAL_ONLY','OTHER'));
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent
        CHECK CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode;
END
ELSE
    ALTER TABLE operational.SalesOrderLineWorkOrderDecisionEvent WITH CHECK
        ADD CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode
        CHECK (DecisionReasonCode IS NULL OR DecisionReasonCode IN
            ('ERP_CONFIRMED_CANDIDATE_MATCH','SALES_ORDER_ITEM_MATCH',
             'HISTORICAL_RELATIONSHIP_VERIFIED','SUPPORTING_DOCUMENTATION_VERIFIED',
             'CUSTOMER_RMA_RELATIONSHIP_VERIFIED','SUPERVISOR_REVIEW',
             'PART_COMPONENT_ONLY','CUSTOMER_SUPPLIED_MATERIAL',
             'SHIPPING_REPLACEMENT_MATERIAL_ONLY','OTHER'));
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
    DecisionAction,
    COALESCE(DecisionClassification,'WORK_ORDER_APPROVAL') AS DecisionClassification,
    ApprovedWorkOrderNumber, SupersedesDecisionId,
    CandidateResolutionStatusAtDecision, CanonicalExactWorkOrderAtDecision,
    CandidateSnapshotIdAtDecision, CandidateSnapshotImportRunId,
    CandidateSetHash, CandidateSetJson, SelectionSource,
    DecisionReason, DecisionReasonCode, DecisionNote,
    ApprovedBy, ApprovedAtUtc, RequestCorrelationId
FROM RankedEvents
WHERE EventRank = 1
  AND DecisionAction IN ('APPROVE', 'REPLACE');
GO

-- Existing decision events remain append-only and are interpreted as WORK_ORDER_APPROVAL.
