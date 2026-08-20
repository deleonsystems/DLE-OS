IF SCHEMA_ID(N'operational') IS NULL
    EXEC(N'CREATE SCHEMA operational');
GO

IF OBJECT_ID(N'operational.OperationsCenterVerifiedStatusEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.OperationsCenterVerifiedStatusEvent
    (
        EventId uniqueidentifier NOT NULL CONSTRAINT DF_OperationsCenterVerifiedStatusEvent_EventId DEFAULT(NEWID()),
        EventSequence bigint IDENTITY(1,1) NOT NULL,
        MasterRecordKey nvarchar(128) NOT NULL,
        CustomerNumber nvarchar(6) NOT NULL,
        SalesOrderNumber nvarchar(7) NOT NULL,
        SalesOrderLineNumber nvarchar(3) NOT NULL,
        WorkOrderNumber nvarchar(7) NULL,
        ItemNumber nvarchar(64) NULL,
        Description nvarchar(256) NULL,
        StatusText nvarchar(1000) NOT NULL,
        EvidenceSnapshotJson nvarchar(max) NULL,
        RecordedBy nvarchar(256) NOT NULL,
        RecordedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_OperationsCenterVerifiedStatusEvent_RecordedAtUtc DEFAULT(SYSUTCDATETIME()),
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_OperationsCenterVerifiedStatusEvent_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        RequestCorrelationId uniqueidentifier NOT NULL,
        CONSTRAINT PK_OperationsCenterVerifiedStatusEvent PRIMARY KEY(EventId),
        CONSTRAINT UQ_OperationsCenterVerifiedStatusEvent_Sequence UNIQUE(EventSequence),
        CONSTRAINT UQ_OperationsCenterVerifiedStatusEvent_Correlation UNIQUE(RequestCorrelationId),
        CONSTRAINT CK_OperationsCenterVerifiedStatusEvent_MasterRecordKey CHECK (LEN(MasterRecordKey) >= 14 AND MasterRecordKey LIKE N'%|%|%'),
        CONSTRAINT CK_OperationsCenterVerifiedStatusEvent_StatusText CHECK (LEN(LTRIM(RTRIM(StatusText))) BETWEEN 1 AND 1000),
        CONSTRAINT CK_OperationsCenterVerifiedStatusEvent_CustomerNumber CHECK (CustomerNumber NOT LIKE N'%[^0-9]%' AND LEN(CustomerNumber)=6),
        CONSTRAINT CK_OperationsCenterVerifiedStatusEvent_SalesOrderNumber CHECK (SalesOrderNumber NOT LIKE N'%[^0-9]%' AND LEN(SalesOrderNumber)=7),
        CONSTRAINT CK_OperationsCenterVerifiedStatusEvent_LineNumber CHECK (SalesOrderLineNumber NOT LIKE N'%[^0-9]%' AND LEN(SalesOrderLineNumber)=3)
    );

    CREATE INDEX IX_OperationsCenterVerifiedStatusEvent_MasterRecordKey
        ON operational.OperationsCenterVerifiedStatusEvent(MasterRecordKey, EventSequence DESC);

    CREATE INDEX IX_OperationsCenterVerifiedStatusEvent_Line
        ON operational.OperationsCenterVerifiedStatusEvent(CustomerNumber, SalesOrderNumber, SalesOrderLineNumber, EventSequence DESC);
END;
GO
