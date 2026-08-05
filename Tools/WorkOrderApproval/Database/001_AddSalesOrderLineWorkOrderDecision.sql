SET XACT_ABORT ON;
GO

IF SCHEMA_ID(N'operational') IS NULL
    EXEC(N'CREATE SCHEMA operational AUTHORIZATION dbo;');
GO

IF OBJECT_ID(N'operational.SalesOrderLineWorkOrderDecisionEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.SalesOrderLineWorkOrderDecisionEvent
    (
        DecisionSequence bigint IDENTITY(1,1) NOT NULL,
        DecisionId uniqueidentifier NOT NULL,
        CustomerNumber nvarchar(6) NOT NULL,
        SalesOrderNumber nvarchar(7) NOT NULL,
        SalesOrderLineNumber nvarchar(3) NOT NULL,
        DecisionAction varchar(8) NOT NULL,
        ApprovedWorkOrderNumber nvarchar(7) NULL,
        SupersedesDecisionId uniqueidentifier NULL,
        CandidateResolutionStatusAtDecision varchar(64) NOT NULL,
        CanonicalExactWorkOrderAtDecision nvarchar(7) NULL,
        CandidateSnapshotIdAtDecision nvarchar(128) NULL,
        CandidateSnapshotImportRunId uniqueidentifier NULL,
        CandidateSetHash char(64) NOT NULL,
        CandidateSetJson nvarchar(max) NOT NULL,
        SelectionSource varchar(40) NOT NULL,
        DecisionReason nvarchar(500) NOT NULL,
        DecisionReasonCode varchar(64) NULL,
        DecisionNote nvarchar(500) NULL,
        ApprovedBy nvarchar(256) NOT NULL,
        ApprovedAtUtc datetime2(7) NOT NULL
            CONSTRAINT DF_SalesOrderLineWorkOrderDecisionEvent_ApprovedAtUtc
            DEFAULT SYSUTCDATETIME(),
        RequestCorrelationId uniqueidentifier NOT NULL,
        CONSTRAINT PK_SalesOrderLineWorkOrderDecisionEvent PRIMARY KEY (DecisionId),
        CONSTRAINT UQ_SalesOrderLineWorkOrderDecisionEvent_Sequence UNIQUE (DecisionSequence),
        CONSTRAINT FK_SalesOrderLineWorkOrderDecisionEvent_Supersedes
            FOREIGN KEY (SupersedesDecisionId)
            REFERENCES operational.SalesOrderLineWorkOrderDecisionEvent(DecisionId),
        CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_Action
            CHECK (DecisionAction IN ('APPROVE', 'REPLACE', 'REVOKE')),
        CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_WorkOrder
            CHECK ((DecisionAction = 'REVOKE' AND ApprovedWorkOrderNumber IS NULL)
                OR (DecisionAction <> 'REVOKE' AND ApprovedWorkOrderNumber IS NOT NULL)),
        CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_Supersession
            CHECK ((DecisionAction = 'APPROVE' AND SupersedesDecisionId IS NULL)
                OR (DecisionAction IN ('REPLACE', 'REVOKE') AND SupersedesDecisionId IS NOT NULL)),
        CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_Reason
            CHECK (LEN(LTRIM(RTRIM(DecisionReason))) >= 3),
        CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_ReasonCode
            CHECK (DecisionReasonCode IS NULL OR DecisionReasonCode IN
                ('ERP_CONFIRMED_CANDIDATE_MATCH','SALES_ORDER_ITEM_MATCH',
                 'HISTORICAL_RELATIONSHIP_VERIFIED','SUPPORTING_DOCUMENTATION_VERIFIED',
                 'CUSTOMER_RMA_RELATIONSHIP_VERIFIED','SUPERVISOR_REVIEW','OTHER')),
        CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_OtherNote
            CHECK (DecisionReasonCode IS NULL OR DecisionReasonCode <> 'OTHER'
                OR NULLIF(LTRIM(RTRIM(DecisionNote)),N'') IS NOT NULL),
        CONSTRAINT CK_SalesOrderLineWorkOrderDecisionEvent_CandidateJson
            CHECK (ISJSON(CandidateSetJson) = 1),
        CONSTRAINT UQ_SalesOrderLineWorkOrderDecisionEvent_Correlation
            UNIQUE (RequestCorrelationId)
    );

    CREATE INDEX IX_SalesOrderLineWorkOrderDecisionEvent_LineHistory
        ON operational.SalesOrderLineWorkOrderDecisionEvent
        (CustomerNumber, SalesOrderNumber, SalesOrderLineNumber,
         DecisionSequence DESC)
        INCLUDE (DecisionAction, ApprovedWorkOrderNumber, SupersedesDecisionId,
                 ApprovedBy, CandidateResolutionStatusAtDecision);

    CREATE INDEX IX_SalesOrderLineWorkOrderDecisionEvent_Supersedes
        ON operational.SalesOrderLineWorkOrderDecisionEvent(SupersedesDecisionId)
        WHERE SupersedesDecisionId IS NOT NULL;
END;
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
    CandidateSnapshotIdAtDecision,
    CandidateSnapshotImportRunId, CandidateSetHash, CandidateSetJson,
    SelectionSource, DecisionReason, DecisionReasonCode, DecisionNote,
    ApprovedBy, ApprovedAtUtc,
    RequestCorrelationId
FROM RankedEvents
WHERE EventRank = 1
  AND DecisionAction IN ('APPROVE', 'REPLACE');
GO

CREATE OR ALTER TRIGGER operational.tr_SalesOrderLineWorkOrderDecisionEvent_AppendOnly
ON operational.SalesOrderLineWorkOrderDecisionEvent
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51001, 'Work Order decision events are append-only.', 1;
END;
GO

-- Intentionally no foreign keys to canonical objects: canonical refreshes replace those rows.
