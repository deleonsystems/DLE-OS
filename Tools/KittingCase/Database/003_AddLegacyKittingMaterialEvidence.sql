USE [DLE_OS_OPERATIONAL_DEV];
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'operational') IS NULL EXEC(N'CREATE SCHEMA operational AUTHORIZATION dbo;');

IF OBJECT_ID(N'operational.LegacyKittingMaterialEvidence', N'U') IS NULL
BEGIN
    CREATE TABLE operational.LegacyKittingMaterialEvidence
    (
        EvidenceId uniqueidentifier NOT NULL,
        EvidenceSequence bigint IDENTITY(1,1) NOT NULL,
        WorkOrderNumber varchar(7) NOT NULL,
        MaterialStatus varchar(24) NOT NULL,
        EvidenceSource varchar(48) NOT NULL,
        CompleteEvidencePath nvarchar(512) NULL,
        CompleteEvidenceLastWriteUtc datetime2(3) NULL,
        ShortageEvidencePath nvarchar(512) NULL,
        ShortageEvidenceLastWriteUtc datetime2(3) NULL,
        SupportingDispositionEventId uniqueidentifier NULL,
        ReconciliationClassification varchar(64) NOT NULL,
        AssessmentCorrelationId uniqueidentifier NOT NULL,
        BackfilledBy nvarchar(256) NOT NULL,
        BackfilledAtUtc datetime2(3) NOT NULL CONSTRAINT DF_LegacyKittingMaterialEvidence_BackfilledAtUtc DEFAULT SYSUTCDATETIME(),
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_LegacyKittingMaterialEvidence_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_LegacyKittingMaterialEvidence PRIMARY KEY (EvidenceId),
        CONSTRAINT UQ_LegacyKittingMaterialEvidence_Sequence UNIQUE (EvidenceSequence),
        CONSTRAINT UQ_LegacyKittingMaterialEvidence_WorkOrder UNIQUE (WorkOrderNumber),
        CONSTRAINT CK_LegacyKittingMaterialEvidence_WorkOrder CHECK
            (WorkOrderNumber NOT LIKE '%[^0-9]%' AND LEN(WorkOrderNumber)=7),
        CONSTRAINT CK_LegacyKittingMaterialEvidence_Status CHECK
            (MaterialStatus IN ('KIT_SHORT','KIT_COMPLETE')),
        CONSTRAINT CK_LegacyKittingMaterialEvidence_Source CHECK
            (EvidenceSource IN ('LEGACY_KITTING_PDF','LEGACY_KITTING_PDF_WITH_VERIFIED_DISPOSITION')),
        CONSTRAINT CK_LegacyKittingMaterialEvidence_Paths CHECK
            ((MaterialStatus='KIT_SHORT' AND ShortageEvidencePath IS NOT NULL) OR
             (MaterialStatus='KIT_COMPLETE' AND CompleteEvidencePath IS NOT NULL)),
        CONSTRAINT FK_LegacyKittingMaterialEvidence_Disposition FOREIGN KEY (SupportingDispositionEventId)
            REFERENCES operational.KittingDispositionEvent(EventId)
    );
    CREATE INDEX IX_LegacyKittingMaterialEvidence_Status
        ON operational.LegacyKittingMaterialEvidence(MaterialStatus, WorkOrderNumber);
END;

COMMIT;
GO

CREATE OR ALTER TRIGGER operational.tr_LegacyKittingMaterialEvidence_Immutable
ON operational.LegacyKittingMaterialEvidence
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52612, 'Legacy Kitting Material evidence is immutable.', 1;
END;
GO
