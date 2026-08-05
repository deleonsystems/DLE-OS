SET XACT_ABORT ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF SCHEMA_ID(N'operational') IS NULL EXEC(N'CREATE SCHEMA operational AUTHORIZATION dbo;');

IF OBJECT_ID(N'operational.SalesOrderLineWorkOrderInterpretationEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.SalesOrderLineWorkOrderInterpretationEvent
    (
        EventId uniqueidentifier NOT NULL,
        EventSequence bigint IDENTITY(1,1) NOT NULL,
        RmaCaseId uniqueidentifier NULL,
        RmaMemberSequence int NULL,
        CustomerNumber varchar(6) NOT NULL,
        SalesOrderNumber varchar(7) NOT NULL,
        SalesOrderLineNumber varchar(3) NOT NULL,
        ActiveWorkOrderNumber varchar(7) NULL,
        HistoricalWorkOrderNumber varchar(7) NULL,
        RelationshipRole varchar(32) NOT NULL,
        ResultingOperationalStatus varchar(40) NOT NULL,
        Reason nvarchar(500) NOT NULL,
        RecordedBy nvarchar(256) NOT NULL,
        RecordedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_SalesOrderLineWorkOrderInterpretationEvent_RecordedAtUtc
            DEFAULT SYSUTCDATETIME(),
        SupersedesEventId uniqueidentifier NULL,
        RequestCorrelationId uniqueidentifier NOT NULL,
        CONSTRAINT PK_SalesOrderLineWorkOrderInterpretationEvent PRIMARY KEY (EventId),
        CONSTRAINT UQ_SalesOrderLineWorkOrderInterpretationEvent_Sequence UNIQUE (EventSequence),
        CONSTRAINT UQ_SalesOrderLineWorkOrderInterpretationEvent_Correlation UNIQUE (RequestCorrelationId),
        CONSTRAINT FK_SalesOrderLineWorkOrderInterpretationEvent_Supersedes
            FOREIGN KEY (SupersedesEventId)
            REFERENCES operational.SalesOrderLineWorkOrderInterpretationEvent(EventId),
        CONSTRAINT FK_SalesOrderLineWorkOrderInterpretationEvent_RmaMember
            FOREIGN KEY (RmaCaseId, RmaMemberSequence)
            REFERENCES operational.RmaReworkCaseMember(CaseId, MemberSequence),
        CONSTRAINT CK_SalesOrderLineWorkOrderInterpretationEvent_Identity CHECK
            (CustomerNumber NOT LIKE '%[^0-9]%' AND LEN(CustomerNumber)=6 AND
             SalesOrderNumber NOT LIKE '%[^0-9]%' AND LEN(SalesOrderNumber)=7 AND
             SalesOrderLineNumber NOT LIKE '%[^0-9]%' AND LEN(SalesOrderLineNumber)=3),
        CONSTRAINT CK_SalesOrderLineWorkOrderInterpretationEvent_RmaMember CHECK
            ((RmaCaseId IS NULL AND RmaMemberSequence IS NULL) OR
             (RmaCaseId IS NOT NULL AND RmaMemberSequence IS NOT NULL)),
        CONSTRAINT CK_SalesOrderLineWorkOrderInterpretationEvent_Role CHECK
            (RelationshipRole IN ('ORIGINAL_BUILD','HISTORICAL_REFERENCE','RMA_ASSIGNED')),
        CONSTRAINT CK_SalesOrderLineWorkOrderInterpretationEvent_Status CHECK
            (ResultingOperationalStatus IN
                ('RETURN_REVIEW_REQUIRED','RMA_DECISION_PENDING','RMA_WORK_ORDER_ASSIGNED')),
        CONSTRAINT CK_SalesOrderLineWorkOrderInterpretationEvent_WorkOrders CHECK
            ((ResultingOperationalStatus='RMA_WORK_ORDER_ASSIGNED' AND ActiveWorkOrderNumber IS NOT NULL) OR
             (ResultingOperationalStatus<>'RMA_WORK_ORDER_ASSIGNED' AND ActiveWorkOrderNumber IS NULL)),
        CONSTRAINT CK_SalesOrderLineWorkOrderInterpretationEvent_Historical CHECK
            ((RelationshipRole IN ('ORIGINAL_BUILD','HISTORICAL_REFERENCE') AND HistoricalWorkOrderNumber IS NOT NULL) OR
             RelationshipRole='RMA_ASSIGNED'),
        CONSTRAINT CK_SalesOrderLineWorkOrderInterpretationEvent_Reason CHECK
            (LEN(LTRIM(RTRIM(Reason)))>=10)
    );

    CREATE INDEX IX_SalesOrderLineWorkOrderInterpretationEvent_LineHistory
        ON operational.SalesOrderLineWorkOrderInterpretationEvent
        (CustomerNumber,SalesOrderNumber,SalesOrderLineNumber,EventSequence DESC);
END;
GO

CREATE OR ALTER VIEW operational.vw_CurrentSalesOrderLineWorkOrderInterpretation
AS
WITH Ranked AS
(
    SELECT event.*,
        ROW_NUMBER() OVER
        (
            PARTITION BY CustomerNumber,SalesOrderNumber,SalesOrderLineNumber
            ORDER BY EventSequence DESC
        ) AS EventRank
    FROM operational.SalesOrderLineWorkOrderInterpretationEvent event
)
SELECT EventId,RmaCaseId,RmaMemberSequence,CustomerNumber,SalesOrderNumber,
       SalesOrderLineNumber,ActiveWorkOrderNumber,HistoricalWorkOrderNumber,
       RelationshipRole,ResultingOperationalStatus,Reason,RecordedBy,RecordedAtUtc,
       SupersedesEventId,RequestCorrelationId
FROM Ranked
WHERE EventRank=1;
GO

CREATE OR ALTER TRIGGER operational.tr_SalesOrderLineWorkOrderInterpretationEvent_AppendOnly
ON operational.SalesOrderLineWorkOrderInterpretationEvent
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51041, 'Sales Order line Work Order interpretation events are append-only.', 1;
END;
GO
