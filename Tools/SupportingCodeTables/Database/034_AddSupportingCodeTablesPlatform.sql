SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'DLE_OS_CANONICAL_LIVE'
    THROW 51000, 'Supporting Code Tables schema targets DLE_OS_CANONICAL_LIVE only.', 1;

IF OBJECT_ID(N'platform.ReferenceCodeImportRun', N'U') IS NULL
BEGIN
    CREATE TABLE platform.ReferenceCodeImportRun
    (
        ReferenceCodeImportRunId uniqueidentifier NOT NULL
            CONSTRAINT PK_ReferenceCodeImportRun PRIMARY KEY,
        SourceQualificationRunId nvarchar(160) NOT NULL,
        PackageSha256 char(64) NOT NULL,
        ManifestSha256 char(64) NOT NULL,
        PackageSchema nvarchar(80) NOT NULL,
        PackageSchemaVersion nvarchar(20) NOT NULL,
        ContractVersion nvarchar(40) NOT NULL,
        StartedAtUtc datetime2(3) NOT NULL,
        CompletedAtUtc datetime2(3) NULL,
        ImportStatus nvarchar(30) NOT NULL,
        IsCommitted bit NOT NULL,
        IsNoOp bit NOT NULL,
        ReferenceCodeCount int NOT NULL,
        RelationshipCount int NOT NULL,
        UsageEvidenceCount int NOT NULL,
        ResolvedCount int NOT NULL,
        UnresolvedCount int NOT NULL,
        AmbiguousCount int NOT NULL,
        GenericSystemCount int NOT NULL,
        CanonicalEnumCount int NOT NULL,
        RestrictedSourceRecordCount int NOT NULL
    );
END;

IF OBJECT_ID(N'canonical.ReferenceCode', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.ReferenceCode
    (
        ReferenceCodeId bigint IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_ReferenceCode PRIMARY KEY,
        FirmId nvarchar(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CodeDomain nvarchar(40) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CodeType nvarchar(80) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CodeValue nvarchar(160) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CodeDescription nvarchar(400) NULL,
        ShortDescription nvarchar(160) NULL,
        ParentCodeValue nvarchar(160) NULL,
        SortOrder int NULL,
        IsActive bit NULL,
        SourceType nvarchar(40) NOT NULL,
        AccessClassification nvarchar(60) NOT NULL,
        ResolutionStatus nvarchar(40) NOT NULL,
        SourceRecordIdentity nvarchar(400) NULL,
        UsageCount bigint NOT NULL,
        ReferenceCodeImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL,
        CONSTRAINT UQ_ReferenceCode_NaturalKey UNIQUE
            (FirmId, CodeDomain, CodeType, CodeValue),
        CONSTRAINT FK_ReferenceCode_ImportRun FOREIGN KEY
            (ReferenceCodeImportRunId)
            REFERENCES platform.ReferenceCodeImportRun
                (ReferenceCodeImportRunId),
        CONSTRAINT CK_ReferenceCode_SourceType CHECK
            (SourceType IN
                (N'SourceMaster', N'ProgramDefined', N'CanonicalEnum',
                 N'TransactionDerived', N'Unresolved')),
        CONSTRAINT CK_ReferenceCode_ResolutionStatus CHECK
            (ResolutionStatus IN
                (N'Resolved', N'Unresolved', N'Ambiguous',
                 N'GenericSystem', N'Deprecated', N'CanonicalEnum')),
        CONSTRAINT CK_ReferenceCode_Access CHECK
            (AccessClassification IN
                (N'GeneralOperational', N'SalesOperational',
                 N'PurchasingOperational', N'ReceivingOperational',
                 N'ProductionOperational', N'QualityOperational',
                 N'InternalOnly'))
    );
    CREATE INDEX IX_ReferenceCode_Filter
        ON canonical.ReferenceCode
            (CodeDomain, CodeType, ResolutionStatus, CodeValue)
        INCLUDE (CodeDescription, SourceType, AccessClassification, UsageCount);
END;

IF (
    SELECT collation_name
    FROM sys.columns
    WHERE object_id = OBJECT_ID(N'canonical.ReferenceCode')
      AND name = N'CodeValue'
) <> N'Latin1_General_100_BIN2'
BEGIN
    IF EXISTS (SELECT 1 FROM canonical.ReferenceCode)
        THROW 51001, 'Cannot change populated ReferenceCode key collation.', 1;
    DROP INDEX IF EXISTS IX_ReferenceCode_Filter
        ON canonical.ReferenceCode;
    IF EXISTS
    (
        SELECT 1
        FROM sys.key_constraints
        WHERE parent_object_id = OBJECT_ID(N'canonical.ReferenceCode')
          AND name = N'UQ_ReferenceCode_NaturalKey'
    )
        ALTER TABLE canonical.ReferenceCode
            DROP CONSTRAINT UQ_ReferenceCode_NaturalKey;
    ALTER TABLE canonical.ReferenceCode ALTER COLUMN
        FirmId nvarchar(20) COLLATE Latin1_General_100_BIN2 NOT NULL;
    ALTER TABLE canonical.ReferenceCode ALTER COLUMN
        CodeDomain nvarchar(40) COLLATE Latin1_General_100_BIN2 NOT NULL;
    ALTER TABLE canonical.ReferenceCode ALTER COLUMN
        CodeType nvarchar(80) COLLATE Latin1_General_100_BIN2 NOT NULL;
    ALTER TABLE canonical.ReferenceCode ALTER COLUMN
        CodeValue nvarchar(160) COLLATE Latin1_General_100_BIN2 NOT NULL;
    ALTER TABLE canonical.ReferenceCode ADD CONSTRAINT
        UQ_ReferenceCode_NaturalKey UNIQUE
            (FirmId, CodeDomain, CodeType, CodeValue);
    CREATE INDEX IX_ReferenceCode_Filter
        ON canonical.ReferenceCode
            (CodeDomain, CodeType, ResolutionStatus, CodeValue)
        INCLUDE (CodeDescription, SourceType, AccessClassification, UsageCount);
END;

GO

CREATE OR ALTER VIEW canonical.ReferenceCodeViewer
AS
SELECT
    ReferenceCodeId, FirmId, CodeDomain, CodeType, CodeValue,
    CodeDescription, ShortDescription, ParentCodeValue, SortOrder, IsActive,
    SourceType, AccessClassification, ResolutionStatus,
    SourceRecordIdentity, UsageCount, ReferenceCodeImportRunId, ImportedAtUtc
FROM canonical.ReferenceCode
WHERE AccessClassification IN
(
    N'GeneralOperational', N'SalesOperational', N'PurchasingOperational',
    N'ReceivingOperational', N'ProductionOperational', N'QualityOperational',
    N'InternalOnly'
);
GO

CREATE OR ALTER VIEW liveapi.ReferenceCodeMetadata
AS
SELECT TOP (1)
    ReferenceCodeImportRunId,
    SourceQualificationRunId,
    PackageSha256,
    ContractVersion,
    CompletedAtUtc AS SnapshotAsOfUtc,
    ReferenceCodeCount,
    RelationshipCount,
    UsageEvidenceCount,
    ResolvedCount,
    UnresolvedCount,
    AmbiguousCount,
    GenericSystemCount,
    CanonicalEnumCount,
    RestrictedSourceRecordCount,
    ImportStatus
FROM platform.ReferenceCodeImportRun
WHERE IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_live_api_reader') IS NOT NULL
BEGIN
    GRANT SELECT ON OBJECT::canonical.ReferenceCodeViewer
        TO dle_live_api_reader;
    GRANT SELECT ON OBJECT::platform.ReferenceCodeImportRun
        TO dle_live_api_reader;
    GRANT SELECT ON OBJECT::liveapi.ReferenceCodeMetadata
        TO dle_live_api_reader;
    DENY INSERT, UPDATE, DELETE ON OBJECT::canonical.ReferenceCode
        TO dle_live_api_reader;
    DENY ALTER, CONTROL ON OBJECT::canonical.ReferenceCode
        TO dle_live_api_reader;
END;
GO
