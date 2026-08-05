SET XACT_ABORT ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF SCHEMA_ID(N'operational') IS NULL EXEC(N'CREATE SCHEMA operational AUTHORIZATION dbo;');

IF OBJECT_ID(N'operational.RmaReworkCase', N'U') IS NULL
BEGIN
    CREATE TABLE operational.RmaReworkCase
    (
        CaseId uniqueidentifier NOT NULL,
        CaseSequence bigint IDENTITY(1,1) NOT NULL,
        CustomerNumber varchar(6) NOT NULL,
        CaseType varchar(32) NOT NULL,
        CustomerRmaNumber nvarchar(80) NULL,
        InternalReference nvarchar(80) NULL,
        Notes nvarchar(1000) NULL,
        CaseStatus varchar(16) NOT NULL,
        CreatedBy nvarchar(256) NOT NULL,
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_RmaReworkCase_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        RequestCorrelationId uniqueidentifier NOT NULL,
        EvidenceToken char(64) NOT NULL,
        CONSTRAINT PK_RmaReworkCase PRIMARY KEY (CaseId),
        CONSTRAINT UQ_RmaReworkCase_Sequence UNIQUE (CaseSequence),
        CONSTRAINT UQ_RmaReworkCase_Correlation UNIQUE (RequestCorrelationId),
        CONSTRAINT CK_RmaReworkCase_Customer CHECK (CustomerNumber NOT LIKE '%[^0-9]%' AND LEN(CustomerNumber)=6),
        CONSTRAINT CK_RmaReworkCase_Type CHECK (CaseType IN ('RMA_RETURN_REPLACEMENT','CUSTOMER_REWORK','INTERNAL_REWORK','EVALUATION_REPAIR','OTHER')),
        CONSTRAINT CK_RmaReworkCase_Status CHECK (CaseStatus='ACTIVE'),
        CONSTRAINT CK_RmaReworkCase_Reference CHECK (NULLIF(LTRIM(RTRIM(CustomerRmaNumber)),N'') IS NOT NULL OR NULLIF(LTRIM(RTRIM(InternalReference)),N'') IS NOT NULL),
        CONSTRAINT CK_RmaReworkCase_OtherNote CHECK (CaseType<>'OTHER' OR NULLIF(LTRIM(RTRIM(Notes)),N'') IS NOT NULL)
    );
END;

IF OBJECT_ID(N'operational.RmaReworkCaseMember', N'U') IS NULL
BEGIN
    CREATE TABLE operational.RmaReworkCaseMember
    (
        CaseId uniqueidentifier NOT NULL,
        MemberSequence int NOT NULL,
        CustomerNumber varchar(6) NOT NULL,
        SalesOrderNumber varchar(7) NOT NULL,
        SalesOrderLineNumber varchar(3) NOT NULL,
        SalesOrderLineId varchar(16) NOT NULL,
        ItemNumber varchar(30) NOT NULL,
        Revision varchar(12) NULL,
        QuantityOrdered decimal(20,10) NOT NULL,
        ErpQuantityOpen decimal(20,10) NOT NULL,
        PendingInvoiceQuantity decimal(20,10) NOT NULL,
        OperationalQuantityOpen decimal(20,10) NOT NULL,
        RelatedWorkOrderNumber varchar(7) NULL,
        RelationshipStatus varchar(64) NOT NULL,
        RelationshipBasis varchar(80) NULL,
        CaseStatus varchar(16) NOT NULL,
        CapturedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_RmaReworkCaseMember_CapturedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_RmaReworkCaseMember PRIMARY KEY (CaseId, MemberSequence),
        CONSTRAINT FK_RmaReworkCaseMember_Case FOREIGN KEY (CaseId) REFERENCES operational.RmaReworkCase(CaseId),
        CONSTRAINT CK_RmaReworkCaseMember_Identity CHECK (
            CustomerNumber NOT LIKE '%[^0-9]%' AND LEN(CustomerNumber)=6 AND
            SalesOrderNumber NOT LIKE '%[^0-9]%' AND LEN(SalesOrderNumber)=7 AND
            SalesOrderLineNumber NOT LIKE '%[^0-9]%' AND LEN(SalesOrderLineNumber)=3 AND
            SalesOrderLineId=CustomerNumber+SalesOrderNumber+SalesOrderLineNumber),
        CONSTRAINT CK_RmaReworkCaseMember_Status CHECK (CaseStatus='ACTIVE')
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'operational.RmaReworkCaseMember') AND name=N'UX_RmaReworkCaseMember_ActiveLine')
    CREATE UNIQUE INDEX UX_RmaReworkCaseMember_ActiveLine
        ON operational.RmaReworkCaseMember(CustomerNumber,SalesOrderNumber,SalesOrderLineNumber)
        WHERE CaseStatus='ACTIVE';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'operational.RmaReworkCaseMember') AND name=N'IX_RmaReworkCaseMember_Case')
    CREATE INDEX IX_RmaReworkCaseMember_Case ON operational.RmaReworkCaseMember(CaseId,MemberSequence);

IF OBJECT_ID(N'operational.RmaReworkCaseEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.RmaReworkCaseEvent
    (
        EventId uniqueidentifier NOT NULL,
        EventSequence bigint IDENTITY(1,1) NOT NULL,
        CaseId uniqueidentifier NOT NULL,
        EventType varchar(32) NOT NULL,
        EventPayloadJson nvarchar(max) NOT NULL,
        RecordedBy nvarchar(256) NOT NULL,
        RecordedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_RmaReworkCaseEvent_RecordedAtUtc DEFAULT SYSUTCDATETIME(),
        ExpectedPriorEventId uniqueidentifier NULL,
        RequestCorrelationId uniqueidentifier NOT NULL,
        CONSTRAINT PK_RmaReworkCaseEvent PRIMARY KEY (EventId),
        CONSTRAINT UQ_RmaReworkCaseEvent_Sequence UNIQUE (EventSequence),
        CONSTRAINT UQ_RmaReworkCaseEvent_Correlation UNIQUE (RequestCorrelationId),
        CONSTRAINT FK_RmaReworkCaseEvent_Case FOREIGN KEY (CaseId) REFERENCES operational.RmaReworkCase(CaseId),
        CONSTRAINT CK_RmaReworkCaseEvent_Type CHECK (EventType IN ('CASE_CREATED','LINE_ADDED')),
        CONSTRAINT CK_RmaReworkCaseEvent_Json CHECK (ISJSON(EventPayloadJson)=1),
        CONSTRAINT CK_RmaReworkCaseEvent_Initial CHECK (
            (EventType='CASE_CREATED' AND ExpectedPriorEventId IS NULL) OR
            (EventType='LINE_ADDED' AND ExpectedPriorEventId IS NOT NULL))
    );
END;
ELSE
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.RmaReworkCaseEvent') AND name=N'CK_RmaReworkCaseEvent_Type')
        ALTER TABLE operational.RmaReworkCaseEvent DROP CONSTRAINT CK_RmaReworkCaseEvent_Type;
    ALTER TABLE operational.RmaReworkCaseEvent WITH CHECK ADD CONSTRAINT CK_RmaReworkCaseEvent_Type
        CHECK (EventType IN ('CASE_CREATED','LINE_ADDED'));
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.RmaReworkCaseEvent') AND name=N'CK_RmaReworkCaseEvent_Initial')
        ALTER TABLE operational.RmaReworkCaseEvent DROP CONSTRAINT CK_RmaReworkCaseEvent_Initial;
    ALTER TABLE operational.RmaReworkCaseEvent WITH CHECK ADD CONSTRAINT CK_RmaReworkCaseEvent_Initial
        CHECK ((EventType='CASE_CREATED' AND ExpectedPriorEventId IS NULL) OR
               (EventType='LINE_ADDED' AND ExpectedPriorEventId IS NOT NULL));
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'operational.RmaReworkCaseEvent') AND name=N'IX_RmaReworkCaseEvent_Case')
    CREATE INDEX IX_RmaReworkCaseEvent_Case ON operational.RmaReworkCaseEvent(CaseId,EventSequence DESC);

GO
CREATE OR ALTER VIEW operational.vw_ActiveRmaReworkCaseMember
AS
SELECT c.CaseId,c.CaseSequence,c.CustomerNumber,c.CaseType,c.CustomerRmaNumber,c.InternalReference,
       c.Notes,c.CaseStatus,c.CreatedBy,c.CreatedAtUtc,m.MemberSequence,m.SalesOrderNumber,
       m.SalesOrderLineNumber,m.SalesOrderLineId,m.ItemNumber,m.Revision,m.QuantityOrdered,
       m.ErpQuantityOpen,m.PendingInvoiceQuantity,m.OperationalQuantityOpen,m.RelatedWorkOrderNumber,
       m.RelationshipStatus,m.RelationshipBasis,m.CapturedAtUtc
FROM operational.RmaReworkCase c
JOIN operational.RmaReworkCaseMember m ON m.CaseId=c.CaseId
WHERE c.CaseStatus='ACTIVE' AND m.CaseStatus='ACTIVE';
GO

CREATE OR ALTER TRIGGER operational.tr_RmaReworkCase_AppendOnly
ON operational.RmaReworkCase INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 51031, 'RMA/Rework cases are append-only.', 1;
END;
GO
CREATE OR ALTER TRIGGER operational.tr_RmaReworkCaseMember_AppendOnly
ON operational.RmaReworkCaseMember INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 51032, 'RMA/Rework case members are append-only.', 1;
END;
GO
CREATE OR ALTER TRIGGER operational.tr_RmaReworkCaseEvent_AppendOnly
ON operational.RmaReworkCaseEvent INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 51033, 'RMA/Rework case events are append-only.', 1;
END;
GO
