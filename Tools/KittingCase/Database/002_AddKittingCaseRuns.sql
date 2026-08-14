USE [DLE_OS_OPERATIONAL_DEV];
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'operational.KittingCase', N'RunNumber') IS NULL
    ALTER TABLE operational.KittingCase ADD RunNumber int NOT NULL
        CONSTRAINT DF_KittingCase_RunNumber DEFAULT (1) WITH VALUES;
IF COL_LENGTH(N'operational.KittingCase', N'IsActive') IS NULL
    ALTER TABLE operational.KittingCase ADD IsActive bit NOT NULL
        CONSTRAINT DF_KittingCase_IsActive DEFAULT (1) WITH VALUES;
IF COL_LENGTH(N'operational.KittingCase', N'ArchivedAtUtc') IS NULL
    ALTER TABLE operational.KittingCase ADD ArchivedAtUtc datetime2(3) NULL;
IF COL_LENGTH(N'operational.KittingCase', N'ArchivedBy') IS NULL
    ALTER TABLE operational.KittingCase ADD ArchivedBy nvarchar(256) NULL;
IF COL_LENGTH(N'operational.KittingCase', N'ArchiveReason') IS NULL
    ALTER TABLE operational.KittingCase ADD ArchiveReason nvarchar(512) NULL;

-- Deliberate batch boundary: existing databases must compile later index/check
-- statements only after the additive columns are physically present.
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID(N'operational.KittingCase') AND name=N'UQ_KittingCase_WorkOrder')
    ALTER TABLE operational.KittingCase DROP CONSTRAINT UQ_KittingCase_WorkOrder;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'operational.KittingCase') AND name=N'UQ_KittingCase_WorkOrderRun')
    CREATE UNIQUE INDEX UQ_KittingCase_WorkOrderRun ON operational.KittingCase(WorkOrderNumber,RunNumber);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'operational.KittingCase') AND name=N'UQ_KittingCase_ActiveWorkOrder')
    CREATE UNIQUE INDEX UQ_KittingCase_ActiveWorkOrder ON operational.KittingCase(WorkOrderNumber) WHERE IsActive=1;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.KittingCase') AND name=N'CK_KittingCase_RunNumber')
    ALTER TABLE operational.KittingCase WITH CHECK ADD CONSTRAINT CK_KittingCase_RunNumber CHECK (RunNumber > 0);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.KittingCase') AND name=N'CK_KittingCase_Archive')
    ALTER TABLE operational.KittingCase WITH CHECK ADD CONSTRAINT CK_KittingCase_Archive CHECK
    (
        (IsActive=1 AND ArchivedAtUtc IS NULL AND ArchivedBy IS NULL AND ArchiveReason IS NULL)
        OR
        (IsActive=0 AND ArchivedAtUtc IS NOT NULL AND ArchivedBy IS NOT NULL AND ArchiveReason IS NOT NULL
         AND EditingSessionId IS NULL AND EditingOwner IS NULL AND EditingAcquiredAtUtc IS NULL AND EditingExpiresAtUtc IS NULL)
    );

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'operational.KittingCaseEvent') AND name=N'CK_KittingCaseEvent_Type')
    ALTER TABLE operational.KittingCaseEvent DROP CONSTRAINT CK_KittingCaseEvent_Type;
ALTER TABLE operational.KittingCaseEvent WITH CHECK ADD CONSTRAINT CK_KittingCaseEvent_Type CHECK
    (EventType IN ('STARTED','EDITING_ACQUIRED','AUTOSAVED','SAVE_EXIT','STALE_LEASE_RECOVERED',
                   'PO_TRACEABILITY_CHANGED','SUBMITTED_KIT_SHORT','SUBMITTED_KIT_COMPLETE',
                   'QUALIFICATION_RUN_ARCHIVED'));

COMMIT;
GO
