USE [DLE_OS_OPERATIONAL_DEV];
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'operational') IS NULL EXEC(N'CREATE SCHEMA operational AUTHORIZATION dbo;');

IF OBJECT_ID(N'operational.KittingCase', N'U') IS NULL
BEGIN
    CREATE TABLE operational.KittingCase
    (
        CaseId uniqueidentifier NOT NULL,
        WorkOrderNumber varchar(7) NOT NULL,
        RunNumber int NOT NULL CONSTRAINT DF_KittingCase_RunNumber DEFAULT (1),
        IsActive bit NOT NULL CONSTRAINT DF_KittingCase_IsActive DEFAULT (1),
        AssemblyItemNumber varchar(64) NOT NULL,
        Revision varchar(32) NULL,
        ReleasedBomIdentity varchar(128) NOT NULL,
        CaseState varchar(32) NOT NULL,
        StartedBy nvarchar(256) NOT NULL,
        StartedAtUtc datetime2(3) NOT NULL,
        LastOperator nvarchar(256) NOT NULL,
        LastWorkedAtUtc datetime2(3) NOT NULL,
        EditingSessionId uniqueidentifier NULL,
        EditingOwner nvarchar(256) NULL,
        EditingAcquiredAtUtc datetime2(3) NULL,
        EditingExpiresAtUtc datetime2(3) NULL,
        DraftJson nvarchar(max) NOT NULL,
        ActionableCount int NOT NULL,
        CompletedCount int NOT NULL,
        ShortRequirementCount int NOT NULL,
        TotalShortage decimal(19,4) NOT NULL,
        WorkingVersion bigint NOT NULL CONSTRAINT DF_KittingCase_WorkingVersion DEFAULT (1),
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_KittingCase_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_KittingCase_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        ArchivedAtUtc datetime2(3) NULL,
        ArchivedBy nvarchar(256) NULL,
        ArchiveReason nvarchar(512) NULL,
        RowVersion rowversion NOT NULL,
        CONSTRAINT PK_KittingCase PRIMARY KEY (CaseId),
        CONSTRAINT UQ_KittingCase_WorkOrderRun UNIQUE (WorkOrderNumber,RunNumber),
        CONSTRAINT CK_KittingCase_WorkOrder CHECK (WorkOrderNumber NOT LIKE '%[^0-9]%' AND LEN(WorkOrderNumber)=7),
        CONSTRAINT CK_KittingCase_State CHECK (CaseState IN ('KITTING_IN_PROGRESS','KIT_SHORT','KIT_COMPLETE')),
        CONSTRAINT CK_KittingCase_RunNumber CHECK (RunNumber > 0),
        CONSTRAINT CK_KittingCase_DraftJson CHECK (ISJSON(DraftJson)=1),
        CONSTRAINT CK_KittingCase_Counts CHECK
            (ActionableCount > 0 AND CompletedCount BETWEEN 0 AND ActionableCount AND
             ShortRequirementCount BETWEEN 0 AND CompletedCount AND TotalShortage >= 0),
        CONSTRAINT CK_KittingCase_EditingLease CHECK
        (
            (EditingSessionId IS NULL AND EditingOwner IS NULL AND EditingAcquiredAtUtc IS NULL AND EditingExpiresAtUtc IS NULL)
            OR
            (EditingSessionId IS NOT NULL AND EditingOwner IS NOT NULL AND EditingAcquiredAtUtc IS NOT NULL AND EditingExpiresAtUtc IS NOT NULL)
        ),
        CONSTRAINT CK_KittingCase_Archive CHECK
        (
            (IsActive=1 AND ArchivedAtUtc IS NULL AND ArchivedBy IS NULL AND ArchiveReason IS NULL)
            OR
            (IsActive=0 AND ArchivedAtUtc IS NOT NULL AND ArchivedBy IS NOT NULL AND ArchiveReason IS NOT NULL
             AND EditingSessionId IS NULL AND EditingOwner IS NULL AND EditingAcquiredAtUtc IS NULL AND EditingExpiresAtUtc IS NULL)
        )
    );
    EXEC(N'CREATE UNIQUE INDEX UQ_KittingCase_ActiveWorkOrder
        ON operational.KittingCase(WorkOrderNumber) WHERE IsActive=1;');
END;

IF COL_LENGTH(N'operational.KittingCase', N'PoTraceabilityRequired') IS NULL
BEGIN
    ALTER TABLE operational.KittingCase ADD PoTraceabilityRequired bit NOT NULL
        CONSTRAINT DF_KittingCase_PoTraceabilityRequired DEFAULT (1) WITH VALUES;
END;

IF OBJECT_ID(N'operational.KittingCaseEvent', N'U') IS NOT NULL
BEGIN
    DECLARE @eventCheck sysname =
    (
        SELECT TOP (1) cc.name
        FROM sys.check_constraints cc
        WHERE cc.parent_object_id = OBJECT_ID(N'operational.KittingCaseEvent')
          AND cc.name = N'CK_KittingCaseEvent_Type'
    );
    IF @eventCheck IS NOT NULL
        ALTER TABLE operational.KittingCaseEvent DROP CONSTRAINT CK_KittingCaseEvent_Type;
    ALTER TABLE operational.KittingCaseEvent WITH CHECK ADD CONSTRAINT CK_KittingCaseEvent_Type CHECK
        (EventType IN ('STARTED','EDITING_ACQUIRED','AUTOSAVED','SAVE_EXIT','STALE_LEASE_RECOVERED',
                       'PO_TRACEABILITY_CHANGED','SUBMITTED_KIT_SHORT','SUBMITTED_KIT_COMPLETE',
                       'QUALIFICATION_RUN_ARCHIVED'));

END;

IF OBJECT_ID(N'operational.KittingCaseEvent', N'U') IS NULL
BEGIN
    CREATE TABLE operational.KittingCaseEvent
    (
        EventId uniqueidentifier NOT NULL,
        EventSequence bigint IDENTITY(1,1) NOT NULL,
        CaseId uniqueidentifier NOT NULL,
        EventType varchar(32) NOT NULL,
        Actor nvarchar(256) NOT NULL,
        EventAtUtc datetime2(3) NOT NULL CONSTRAINT DF_KittingCaseEvent_EventAtUtc DEFAULT SYSUTCDATETIME(),
        WorkingVersion bigint NOT NULL,
        DetailJson nvarchar(max) NULL,
        CONSTRAINT PK_KittingCaseEvent PRIMARY KEY (EventId),
        CONSTRAINT UQ_KittingCaseEvent_Sequence UNIQUE (EventSequence),
        CONSTRAINT FK_KittingCaseEvent_Case FOREIGN KEY (CaseId) REFERENCES operational.KittingCase(CaseId),
        CONSTRAINT CK_KittingCaseEvent_Type CHECK (EventType IN
            ('STARTED','EDITING_ACQUIRED','AUTOSAVED','SAVE_EXIT','STALE_LEASE_RECOVERED',
             'PO_TRACEABILITY_CHANGED','SUBMITTED_KIT_SHORT','SUBMITTED_KIT_COMPLETE',
             'QUALIFICATION_RUN_ARCHIVED')),
        CONSTRAINT CK_KittingCaseEvent_DetailJson CHECK (DetailJson IS NULL OR ISJSON(DetailJson)=1)
    );
    CREATE INDEX IX_KittingCaseEvent_CaseHistory
        ON operational.KittingCaseEvent(CaseId, EventSequence DESC);
END;

IF OBJECT_ID(N'operational.KittingSubmission', N'U') IS NULL
BEGIN
    CREATE TABLE operational.KittingSubmission
    (
        SubmissionId uniqueidentifier NOT NULL,
        CaseId uniqueidentifier NOT NULL,
        SubmissionType varchar(16) NOT NULL,
        VersionNumber int NOT NULL,
        SnapshotJson nvarchar(max) NOT NULL,
        SubmittedBy nvarchar(256) NOT NULL,
        SubmittedAtUtc datetime2(3) NOT NULL,
        PdfFileName varchar(128) NOT NULL,
        PdfPath nvarchar(512) NOT NULL,
        PdfSha256 char(64) NOT NULL,
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_KittingSubmission_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_KittingSubmission PRIMARY KEY (SubmissionId),
        CONSTRAINT FK_KittingSubmission_Case FOREIGN KEY (CaseId) REFERENCES operational.KittingCase(CaseId),
        CONSTRAINT UQ_KittingSubmission_Version UNIQUE (CaseId, SubmissionType, VersionNumber),
        CONSTRAINT CK_KittingSubmission_Type CHECK (SubmissionType IN ('KIT_SHORT','KIT_COMPLETE')),
        CONSTRAINT CK_KittingSubmission_Version CHECK (VersionNumber > 0),
        CONSTRAINT CK_KittingSubmission_SnapshotJson CHECK (ISJSON(SnapshotJson)=1),
        CONSTRAINT CK_KittingSubmission_PdfHash CHECK (PdfSha256 NOT LIKE '%[^0-9A-F]%')
    );
    CREATE INDEX IX_KittingSubmission_CaseHistory
        ON operational.KittingSubmission(CaseId, SubmittedAtUtc DESC);
END;

COMMIT;
GO

CREATE OR ALTER TRIGGER operational.tr_KittingCaseEvent_AppendOnly
ON operational.KittingCaseEvent
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    THROW 52610, 'Kitting Case history is append-only.', 1;
END;
GO

CREATE OR ALTER TRIGGER operational.tr_KittingSubmission_Immutable
ON operational.KittingSubmission
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    THROW 52611, 'Submitted Kitting evidence is immutable.', 1;
END;
GO
