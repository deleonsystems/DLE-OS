IF SCHEMA_ID(N'operational') IS NULL
    EXEC(N'CREATE SCHEMA operational');
GO

IF OBJECT_ID(N'operational.OperationsCenterWorkOrderVerifiedStatusEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.OperationsCenterWorkOrderVerifiedStatusEvent
    (
        EventId uniqueidentifier NOT NULL CONSTRAINT DF_OperationsCenterWorkOrderVerifiedStatusEvent_EventId DEFAULT(NEWID()),
        EventSequence bigint IDENTITY(1,1) NOT NULL,
        WorkOrderNumber nvarchar(7) NOT NULL,
        StatusText nvarchar(1000) NOT NULL,
        EvidenceSnapshotJson nvarchar(max) NULL,
        RecordedBy nvarchar(256) NOT NULL,
        RecordedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_OperationsCenterWorkOrderVerifiedStatusEvent_RecordedAtUtc DEFAULT(SYSUTCDATETIME()),
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_OperationsCenterWorkOrderVerifiedStatusEvent_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        RequestCorrelationId uniqueidentifier NOT NULL,
        CONSTRAINT PK_OperationsCenterWorkOrderVerifiedStatusEvent PRIMARY KEY(EventId),
        CONSTRAINT UQ_OperationsCenterWorkOrderVerifiedStatusEvent_Sequence UNIQUE(EventSequence),
        CONSTRAINT UQ_OperationsCenterWorkOrderVerifiedStatusEvent_Correlation UNIQUE(RequestCorrelationId),
        CONSTRAINT CK_OperationsCenterWorkOrderVerifiedStatusEvent_WorkOrder CHECK (WorkOrderNumber NOT LIKE N'%[^0-9]%' AND LEN(WorkOrderNumber)=7),
        CONSTRAINT CK_OperationsCenterWorkOrderVerifiedStatusEvent_StatusText CHECK (LEN(LTRIM(RTRIM(StatusText))) BETWEEN 1 AND 1000)
    );

    CREATE INDEX IX_OperationsCenterWorkOrderVerifiedStatusEvent_WorkOrder
        ON operational.OperationsCenterWorkOrderVerifiedStatusEvent(WorkOrderNumber, EventSequence DESC);
END;
GO
