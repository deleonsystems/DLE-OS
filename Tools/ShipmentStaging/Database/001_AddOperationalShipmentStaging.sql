SET XACT_ABORT ON;
SET NOCOUNT ON;

IF SCHEMA_ID(N'operational') IS NULL EXEC(N'CREATE SCHEMA operational AUTHORIZATION dbo;');

IF OBJECT_ID(N'operational.ShipmentStaging', N'U') IS NULL
BEGIN
    CREATE TABLE operational.ShipmentStaging
    (
        ShipmentStagingId uniqueidentifier NOT NULL,
        ShipmentNumber nvarchar(40) NOT NULL,
        CustomerNumber nvarchar(6) NOT NULL,
        CustomerNameSnapshot nvarchar(160) NULL,
        SalesOrderNumber nvarchar(7) NOT NULL,
        SalesOrderLineNumber nvarchar(3) NOT NULL,
        ItemNumber nvarchar(40) NOT NULL,
        Revision nvarchar(30) NULL,
        QuantityProcessed decimal(19,6) NOT NULL,
        CanonicalOpenQuantityAtShipment decimal(19,6) NULL,
        UnitOfMeasure nvarchar(20) NULL,
        WorkOrderNumber nvarchar(7) NULL,
        WorkOrderRelationshipSource nvarchar(50) NOT NULL,
        DirectFulfillment bit NOT NULL CONSTRAINT DF_ShipmentStaging_DirectFulfillment DEFAULT(0),
        RmaReworkCaseId uniqueidentifier NULL,
        ShipmentReference nvarchar(100) NULL,
        RequestId nvarchar(100) NOT NULL,
        IdempotencyKey nvarchar(160) NOT NULL,
        ProcessedAtUtc datetime2(3) NOT NULL,
        ProcessedBy nvarchar(256) NOT NULL,
        CurrentStatus nvarchar(40) NOT NULL,
        CurrentEventSequence bigint NOT NULL,
        CurrentProposalRunId uniqueidentifier NULL,
        ConfirmedDecisionEventId uniqueidentifier NULL,
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_ShipmentStaging_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        RowVersion rowversion NOT NULL,
        CONSTRAINT PK_ShipmentStaging PRIMARY KEY (ShipmentStagingId),
        CONSTRAINT UQ_ShipmentStaging_ShipmentNumber UNIQUE (ShipmentNumber),
        CONSTRAINT UQ_ShipmentStaging_IdempotencyKey UNIQUE (IdempotencyKey),
        CONSTRAINT CK_ShipmentStaging_Quantity CHECK (QuantityProcessed > 0),
        CONSTRAINT CK_ShipmentStaging_CanonicalOpenQuantity CHECK
            (CanonicalOpenQuantityAtShipment IS NULL OR CanonicalOpenQuantityAtShipment >= QuantityProcessed),
        CONSTRAINT CK_ShipmentStaging_Status CHECK (CurrentStatus IN
            (N'AWAITING_ERP_EVIDENCE',N'POSSIBLE_MATCH_FOUND',N'MATCH_REVIEW_REQUIRED',
             N'ERP_CONFIRMED',N'MISMATCH_EXCEPTION',N'CANCELLED')),
        CONSTRAINT CK_ShipmentStaging_WorkOrderSource CHECK (WorkOrderRelationshipSource IN
            (N'EXACT_CANONICAL',N'GOVERNED_APPROVAL',N'RMA_DECISION',N'NO_WORK_ORDER_REQUIRED'))
    );
    CREATE INDEX IX_ShipmentStaging_Line ON operational.ShipmentStaging
        (CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,CurrentStatus);
END;

IF OBJECT_ID(N'operational.ShipmentStagingEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.ShipmentStagingEvent
    (
        ShipmentStagingEventId uniqueidentifier NOT NULL,
        ShipmentStagingId uniqueidentifier NOT NULL,
        EventSequence bigint IDENTITY(1,1) NOT NULL,
        EventType nvarchar(40) NOT NULL,
        ResultingStatus nvarchar(40) NOT NULL,
        ReasonCode nvarchar(80) NULL,
        DecisionNote nvarchar(1000) NULL,
        SupersedesEventId uniqueidentifier NULL,
        RecordedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_ShipmentStagingEvent_RecordedAtUtc DEFAULT(SYSUTCDATETIME()),
        RecordedBy nvarchar(256) NOT NULL,
        CorrelationId nvarchar(160) NOT NULL,
        EvidenceJson nvarchar(max) NULL,
        CONSTRAINT PK_ShipmentStagingEvent PRIMARY KEY (ShipmentStagingEventId),
        CONSTRAINT UQ_ShipmentStagingEvent_Correlation UNIQUE (CorrelationId),
        CONSTRAINT FK_ShipmentStagingEvent_Staging FOREIGN KEY (ShipmentStagingId)
            REFERENCES operational.ShipmentStaging(ShipmentStagingId),
        CONSTRAINT FK_ShipmentStagingEvent_Supersedes FOREIGN KEY (SupersedesEventId)
            REFERENCES operational.ShipmentStagingEvent(ShipmentStagingEventId),
        CONSTRAINT CK_ShipmentStagingEvent_Status CHECK (ResultingStatus IN
            (N'AWAITING_ERP_EVIDENCE',N'POSSIBLE_MATCH_FOUND',N'MATCH_REVIEW_REQUIRED',
             N'ERP_CONFIRMED',N'MISMATCH_EXCEPTION',N'CANCELLED')),
        CONSTRAINT CK_ShipmentStagingEvent_EvidenceJson CHECK
            (EvidenceJson IS NULL OR ISJSON(EvidenceJson)=1)
    );
    CREATE INDEX IX_ShipmentStagingEvent_Timeline ON operational.ShipmentStagingEvent
        (ShipmentStagingId,EventSequence);
END;

IF OBJECT_ID(N'operational.ShipmentReconciliationRun', N'U') IS NULL
BEGIN
    CREATE TABLE operational.ShipmentReconciliationRun
    (
        ReconciliationRunId uniqueidentifier NOT NULL,
        InvoiceHistoryImportRunId uniqueidentifier NULL,
        TriggerType nvarchar(40) NOT NULL,
        StartedAtUtc datetime2(3) NOT NULL,
        CompletedAtUtc datetime2(3) NULL,
        Result nvarchar(20) NOT NULL,
        ShipmentCount int NOT NULL CONSTRAINT DF_ShipmentReconciliationRun_ShipmentCount DEFAULT(0),
        FailureCode nvarchar(80) NULL,
        FailureMessage nvarchar(1000) NULL,
        CorrelationId nvarchar(160) NOT NULL,
        CONSTRAINT PK_ShipmentReconciliationRun PRIMARY KEY (ReconciliationRunId),
        CONSTRAINT UQ_ShipmentReconciliationRun_Correlation UNIQUE (CorrelationId),
        CONSTRAINT CK_ShipmentReconciliationRun_Result CHECK (Result IN (N'RUNNING',N'SUCCEEDED',N'FAILED'))
    );
END;

IF OBJECT_ID(N'operational.ShipmentInvoiceMatchProposal', N'U') IS NULL
BEGIN
    CREATE TABLE operational.ShipmentInvoiceMatchProposal
    (
        ShipmentInvoiceMatchProposalId uniqueidentifier NOT NULL,
        ReconciliationRunId uniqueidentifier NOT NULL,
        ShipmentStagingId uniqueidentifier NOT NULL,
        InvoiceHistoryLineId nvarchar(100) NOT NULL,
        InvoiceNumber nvarchar(20) NULL,
        InvoiceLineNumber nvarchar(20) NULL,
        InvoiceDate date NULL,
        InvoiceQuantity decimal(19,6) NOT NULL,
        MatchClassification nvarchar(40) NOT NULL,
        MatchScore int NOT NULL,
        EvidenceSummary nvarchar(1000) NOT NULL,
        ContradictionSummary nvarchar(1000) NULL,
        EvidenceSnapshotJson nvarchar(max) NOT NULL,
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_ShipmentInvoiceMatchProposal_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        CONSTRAINT PK_ShipmentInvoiceMatchProposal PRIMARY KEY (ShipmentInvoiceMatchProposalId),
        CONSTRAINT FK_ShipmentInvoiceMatchProposal_Run FOREIGN KEY (ReconciliationRunId)
            REFERENCES operational.ShipmentReconciliationRun(ReconciliationRunId),
        CONSTRAINT FK_ShipmentInvoiceMatchProposal_Staging FOREIGN KEY (ShipmentStagingId)
            REFERENCES operational.ShipmentStaging(ShipmentStagingId),
        CONSTRAINT UQ_ShipmentInvoiceMatchProposal UNIQUE
            (ReconciliationRunId,ShipmentStagingId,InvoiceHistoryLineId),
        CONSTRAINT CK_ShipmentInvoiceMatchProposal_Classification CHECK (MatchClassification IN
            (N'EXACT_ONE_TO_ONE',N'PARTIAL_QUANTITY',N'MULTIPLE_CANDIDATES',N'OVER_INVOICE',N'POSSIBLE_MATCH')),
        CONSTRAINT CK_ShipmentInvoiceMatchProposal_Evidence CHECK (ISJSON(EvidenceSnapshotJson)=1)
    );
    CREATE INDEX IX_ShipmentInvoiceMatchProposal_Current ON operational.ShipmentInvoiceMatchProposal
        (ShipmentStagingId,ReconciliationRunId,MatchScore DESC);
END;

IF OBJECT_ID(N'operational.ShipmentInvoiceDecisionEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.ShipmentInvoiceDecisionEvent
    (
        ShipmentInvoiceDecisionEventId uniqueidentifier NOT NULL,
        ShipmentStagingId uniqueidentifier NOT NULL,
        ShipmentInvoiceMatchProposalId uniqueidentifier NULL,
        DecisionSequence bigint IDENTITY(1,1) NOT NULL,
        DecisionType nvarchar(30) NOT NULL,
        ResultingStatus nvarchar(40) NOT NULL,
        ReasonCode nvarchar(80) NULL,
        DecisionNote nvarchar(1000) NULL,
        ConfirmedQuantity decimal(19,6) NULL,
        SupersedesDecisionEventId uniqueidentifier NULL,
        RecordedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_ShipmentInvoiceDecisionEvent_RecordedAtUtc DEFAULT(SYSUTCDATETIME()),
        RecordedBy nvarchar(256) NOT NULL,
        CorrelationId nvarchar(160) NOT NULL,
        EvidenceSnapshotJson nvarchar(max) NULL,
        CONSTRAINT PK_ShipmentInvoiceDecisionEvent PRIMARY KEY (ShipmentInvoiceDecisionEventId),
        CONSTRAINT UQ_ShipmentInvoiceDecisionEvent_Correlation UNIQUE (CorrelationId),
        CONSTRAINT FK_ShipmentInvoiceDecisionEvent_Staging FOREIGN KEY (ShipmentStagingId)
            REFERENCES operational.ShipmentStaging(ShipmentStagingId),
        CONSTRAINT FK_ShipmentInvoiceDecisionEvent_Proposal FOREIGN KEY (ShipmentInvoiceMatchProposalId)
            REFERENCES operational.ShipmentInvoiceMatchProposal(ShipmentInvoiceMatchProposalId),
        CONSTRAINT FK_ShipmentInvoiceDecisionEvent_Supersedes FOREIGN KEY (SupersedesDecisionEventId)
            REFERENCES operational.ShipmentInvoiceDecisionEvent(ShipmentInvoiceDecisionEventId),
        CONSTRAINT CK_ShipmentInvoiceDecisionEvent_Type CHECK (DecisionType IN
            (N'CONFIRM_MATCH',N'REJECT_MATCH',N'MARK_EXCEPTION',N'CANCEL_SHIPMENT')),
        CONSTRAINT CK_ShipmentInvoiceDecisionEvent_Evidence CHECK
            (EvidenceSnapshotJson IS NULL OR ISJSON(EvidenceSnapshotJson)=1)
    );
    CREATE INDEX IX_ShipmentInvoiceDecisionEvent_Timeline ON operational.ShipmentInvoiceDecisionEvent
        (ShipmentStagingId,DecisionSequence);
END;

IF OBJECT_ID(N'operational.ShipmentInvoiceAllocation', N'U') IS NULL
BEGIN
    CREATE TABLE operational.ShipmentInvoiceAllocation
    (
        ShipmentInvoiceAllocationId uniqueidentifier NOT NULL,
        ShipmentInvoiceDecisionEventId uniqueidentifier NOT NULL,
        ShipmentStagingId uniqueidentifier NOT NULL,
        InvoiceHistoryLineId nvarchar(100) NOT NULL,
        AllocatedQuantity decimal(19,6) NOT NULL,
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_ShipmentInvoiceAllocation_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        CONSTRAINT PK_ShipmentInvoiceAllocation PRIMARY KEY (ShipmentInvoiceAllocationId),
        CONSTRAINT FK_ShipmentInvoiceAllocation_Decision FOREIGN KEY (ShipmentInvoiceDecisionEventId)
            REFERENCES operational.ShipmentInvoiceDecisionEvent(ShipmentInvoiceDecisionEventId),
        CONSTRAINT FK_ShipmentInvoiceAllocation_Staging FOREIGN KEY (ShipmentStagingId)
            REFERENCES operational.ShipmentStaging(ShipmentStagingId),
        CONSTRAINT UQ_ShipmentInvoiceAllocation_DecisionLine UNIQUE
            (ShipmentInvoiceDecisionEventId,InvoiceHistoryLineId),
        CONSTRAINT CK_ShipmentInvoiceAllocation_Quantity CHECK (AllocatedQuantity > 0)
    );
    CREATE INDEX IX_ShipmentInvoiceAllocation_InvoiceLine ON operational.ShipmentInvoiceAllocation
        (InvoiceHistoryLineId,ShipmentStagingId);
END;

GO

IF COL_LENGTH(N'operational.ShipmentStaging', N'CanonicalOpenQuantityAtShipment') IS NULL
BEGIN
    ALTER TABLE operational.ShipmentStaging
        ADD CanonicalOpenQuantityAtShipment decimal(19,6) NULL;
END;
GO

CREATE OR ALTER TRIGGER operational.TR_ShipmentStagingEvent_AppendOnly
ON operational.ShipmentStagingEvent INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 51031, 'Shipment staging events are append-only.', 1;
END;
GO
CREATE OR ALTER TRIGGER operational.TR_ShipmentInvoiceDecisionEvent_AppendOnly
ON operational.ShipmentInvoiceDecisionEvent INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 51032, 'Shipment invoice decisions are append-only.', 1;
END;
GO
CREATE OR ALTER TRIGGER operational.TR_ShipmentInvoiceAllocation_AppendOnly
ON operational.ShipmentInvoiceAllocation INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 51033, 'Shipment invoice allocations are append-only.', 1;
END;
GO

CREATE OR ALTER VIEW operational.vw_CurrentShipmentStaging
AS
SELECT s.*,
       p.ShipmentInvoiceMatchProposalId AS ProposedMatchId,
       p.InvoiceHistoryLineId AS ProposedInvoiceHistoryLineId,
       p.InvoiceNumber AS ProposedInvoiceNumber,
       p.InvoiceLineNumber AS ProposedInvoiceLineNumber,
       p.InvoiceDate AS ProposedInvoiceDate,
       p.InvoiceQuantity AS ProposedInvoiceQuantity,
       p.MatchClassification,
       p.MatchScore,
       p.EvidenceSummary,
       p.ContradictionSummary
FROM operational.ShipmentStaging s
OUTER APPLY
(
    SELECT TOP (1) proposal.*
    FROM operational.ShipmentInvoiceMatchProposal proposal
    WHERE proposal.ShipmentStagingId=s.ShipmentStagingId
      AND proposal.ReconciliationRunId=s.CurrentProposalRunId
    ORDER BY proposal.MatchScore DESC, proposal.CreatedAtUtc, proposal.ShipmentInvoiceMatchProposalId
) p;
GO
