SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'operational') IS NULL EXEC(N'CREATE SCHEMA operational AUTHORIZATION dbo;');

IF OBJECT_ID(N'operational.KittingDispositionEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.KittingDispositionEvent
    (
        EventId uniqueidentifier NOT NULL,
        EventSequence bigint IDENTITY(1,1) NOT NULL,
        WorkOrderNumber varchar(7) NOT NULL,
        EventType varchar(32) NOT NULL,
        ResultingDisposition varchar(16) NOT NULL,
        PreviousDisposition varchar(20) NOT NULL,
        ReasonCode varchar(40) NULL,
        Note nvarchar(500) NULL,
        CustomerNumber varchar(6) NOT NULL,
        AssemblyItemNumber varchar(50) NOT NULL,
        Revision varchar(30) NULL,
        OriginSalesOrderNumber varchar(7) NOT NULL,
        OriginSalesOrderLineNumber varchar(3) NOT NULL,
        CanonicalAnchorSalesOrderNumber varchar(7) NOT NULL,
        CanonicalAnchorSalesOrderLineNumber varchar(3) NOT NULL,
        GoverningRelationshipSource varchar(16) NOT NULL,
        RecordedBy nvarchar(256) NOT NULL,
        RecordedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_KittingDispositionEvent_RecordedAtUtc DEFAULT SYSUTCDATETIME(),
        SupersedesEventId uniqueidentifier NULL,
        ExpectedPriorEventId uniqueidentifier NULL,
        DocumentEvidenceStatus varchar(64) NOT NULL,
        CompleteEvidenceFileName varchar(64) NULL,
        ShortageEvidenceFileName varchar(64) NULL,
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_KittingDispositionEvent_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        RequestCorrelationId uniqueidentifier NOT NULL,
        CONSTRAINT PK_KittingDispositionEvent PRIMARY KEY (EventId),
        CONSTRAINT UQ_KittingDispositionEvent_Sequence UNIQUE (EventSequence),
        CONSTRAINT UQ_KittingDispositionEvent_Correlation UNIQUE (RequestCorrelationId),
        CONSTRAINT FK_KittingDispositionEvent_Supersedes FOREIGN KEY (SupersedesEventId)
            REFERENCES operational.KittingDispositionEvent(EventId),
        CONSTRAINT CK_KittingDispositionEvent_WorkOrder CHECK (WorkOrderNumber NOT LIKE '%[^0-9]%' AND LEN(WorkOrderNumber) BETWEEN 1 AND 7),
        CONSTRAINT CK_KittingDispositionEvent_Type CHECK (EventType IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE','KIT_DISPOSITION_CHANGED')),
        CONSTRAINT CK_KittingDispositionEvent_Result CHECK (ResultingDisposition IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE')),
        CONSTRAINT CK_KittingDispositionEvent_Previous CHECK (PreviousDisposition IN ('NOT_DISPOSITIONED','NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE')),
        CONSTRAINT CK_KittingDispositionEvent_Source CHECK (GoverningRelationshipSource IN ('EXACT','APPROVED')),
        CONSTRAINT CK_KittingDispositionEvent_Supersession CHECK
        (
            (PreviousDisposition = 'NOT_DISPOSITIONED' AND SupersedesEventId IS NULL AND ExpectedPriorEventId IS NULL AND EventType IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE'))
            OR
            (PreviousDisposition IS NOT NULL AND SupersedesEventId IS NOT NULL AND ExpectedPriorEventId = SupersedesEventId AND EventType = 'KIT_DISPOSITION_CHANGED')
        )
    );

    CREATE INDEX IX_KittingDispositionEvent_WorkOrderHistory
        ON operational.KittingDispositionEvent(WorkOrderNumber, EventSequence DESC);
    CREATE UNIQUE INDEX UX_KittingDispositionEvent_Supersedes
        ON operational.KittingDispositionEvent(SupersedesEventId) WHERE SupersedesEventId IS NOT NULL;
END;
GO

IF OBJECT_ID(N'operational.KittingDispositionEvent', N'U') IS NOT NULL
   AND NOT EXISTS
   (
       SELECT 1 FROM sys.check_constraints
       WHERE parent_object_id=OBJECT_ID(N'operational.KittingDispositionEvent')
         AND name=N'CK_KittingDispositionEvent_Result'
         AND definition LIKE N'%NEEDS_KITTING%'
   )
BEGIN
    ALTER TABLE operational.KittingDispositionEvent DROP CONSTRAINT CK_KittingDispositionEvent_Supersession;
    ALTER TABLE operational.KittingDispositionEvent DROP CONSTRAINT CK_KittingDispositionEvent_Previous;
    ALTER TABLE operational.KittingDispositionEvent DROP CONSTRAINT CK_KittingDispositionEvent_Result;
    ALTER TABLE operational.KittingDispositionEvent DROP CONSTRAINT CK_KittingDispositionEvent_Type;
    ALTER TABLE operational.KittingDispositionEvent ADD CONSTRAINT CK_KittingDispositionEvent_Type
        CHECK (EventType IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE','KIT_DISPOSITION_CHANGED'));
    ALTER TABLE operational.KittingDispositionEvent ADD CONSTRAINT CK_KittingDispositionEvent_Result
        CHECK (ResultingDisposition IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE'));
    ALTER TABLE operational.KittingDispositionEvent ADD CONSTRAINT CK_KittingDispositionEvent_Previous
        CHECK (PreviousDisposition IN ('NOT_DISPOSITIONED','NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE'));
    ALTER TABLE operational.KittingDispositionEvent ADD CONSTRAINT CK_KittingDispositionEvent_Supersession CHECK
    (
        (PreviousDisposition = 'NOT_DISPOSITIONED' AND SupersedesEventId IS NULL AND ExpectedPriorEventId IS NULL AND EventType IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE'))
        OR
        (PreviousDisposition IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE') AND SupersedesEventId IS NOT NULL AND ExpectedPriorEventId = SupersedesEventId AND EventType = 'KIT_DISPOSITION_CHANGED')
    );
END;
GO

IF EXISTS
(
    SELECT 1 FROM sys.columns
    WHERE object_id=OBJECT_ID(N'operational.KittingDispositionEvent')
      AND name=N'PreviousDisposition' AND is_nullable=1
)
BEGIN
    ALTER TABLE operational.KittingDispositionEvent DROP CONSTRAINT CK_KittingDispositionEvent_Previous;
    ALTER TABLE operational.KittingDispositionEvent DROP CONSTRAINT CK_KittingDispositionEvent_Supersession;
    ALTER TABLE operational.KittingDispositionEvent ALTER COLUMN PreviousDisposition varchar(20) NOT NULL;
    ALTER TABLE operational.KittingDispositionEvent ADD CONSTRAINT CK_KittingDispositionEvent_Previous
        CHECK (PreviousDisposition IN ('NOT_DISPOSITIONED','NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE'));
    ALTER TABLE operational.KittingDispositionEvent ADD CONSTRAINT CK_KittingDispositionEvent_Supersession CHECK
    (
        (PreviousDisposition = 'NOT_DISPOSITIONED' AND SupersedesEventId IS NULL AND ExpectedPriorEventId IS NULL AND EventType IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE'))
        OR
        (PreviousDisposition IN ('NEEDS_KITTING','KIT_SHORT','KIT_COMPLETE') AND SupersedesEventId IS NOT NULL AND ExpectedPriorEventId = SupersedesEventId AND EventType = 'KIT_DISPOSITION_CHANGED')
    );
END;
GO

CREATE OR ALTER VIEW operational.vw_CurrentKittingDisposition
AS
WITH Ranked AS
(
    SELECT event.*,
           ROW_NUMBER() OVER (PARTITION BY WorkOrderNumber ORDER BY EventSequence DESC) AS CurrentRank
    FROM operational.KittingDispositionEvent AS event
)
SELECT EventId, EventSequence, WorkOrderNumber, EventType, ResultingDisposition,
       PreviousDisposition, ReasonCode, Note, CustomerNumber, AssemblyItemNumber,
       Revision, OriginSalesOrderNumber, OriginSalesOrderLineNumber,
       CanonicalAnchorSalesOrderNumber, CanonicalAnchorSalesOrderLineNumber,
       GoverningRelationshipSource, RecordedBy, RecordedAtUtc, SupersedesEventId,
       ExpectedPriorEventId, DocumentEvidenceStatus, CompleteEvidenceFileName,
       ShortageEvidenceFileName, CreatedAtUtc, RequestCorrelationId
FROM Ranked
WHERE CurrentRank = 1;
GO

CREATE OR ALTER TRIGGER operational.tr_KittingDispositionEvent_AppendOnly
ON operational.KittingDispositionEvent
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51021, 'Kitting disposition events are append-only.', 1;
END;
GO

COMMIT TRANSACTION;
