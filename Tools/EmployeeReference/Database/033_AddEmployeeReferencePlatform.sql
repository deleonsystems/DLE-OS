USE [DLE_OS_CANONICAL_LIVE];
GO

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'platform.EmployeeReferenceImportRun', N'U') IS NULL
BEGIN
    CREATE TABLE platform.EmployeeReferenceImportRun
    (
        EmployeeReferenceImportRunId uniqueidentifier NOT NULL
            CONSTRAINT PK_EmployeeReferenceImportRun PRIMARY KEY,
        SourceQualificationRunId nvarchar(100) NOT NULL,
        PackageSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ManifestSha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        PackageSchema nvarchar(80) NOT NULL,
        PackageSchemaVersion nvarchar(20) NOT NULL,
        ContractVersion nvarchar(40) NOT NULL,
        StartedAtUtc datetime2(3) NOT NULL,
        CompletedAtUtc datetime2(3) NULL,
        ImportStatus nvarchar(20) NOT NULL,
        IsCommitted bit NOT NULL,
        IsNoOp bit NOT NULL,
        EmployeeCount int NOT NULL,
        OperationalCodeCount int NOT NULL,
        DepartmentCount int NOT NULL,
        JobTitleCount int NOT NULL,
        ActiveEmployeeCount int NOT NULL,
        InactiveEmployeeCount int NOT NULL,
        UnresolvedCodeCount int NOT NULL,
        AmbiguousCodeCount int NOT NULL,
        GenericSystemCodeCount int NOT NULL,
        CONSTRAINT CK_EmployeeReferenceImportRun_Status
            CHECK (ImportStatus IN (N'PENDING', N'SUCCESS', N'FAILED'))
    );
END;
GO

IF OBJECT_ID(N'canonical.DepartmentReference', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.DepartmentReference
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        DepartmentCode nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        DepartmentName nvarchar(20) NULL,
        SourceSystem nvarchar(32) NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2
            NOT NULL,
        EmployeeReferenceImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_DepartmentReference_ImportedAtUtc
            DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_DepartmentReference PRIMARY KEY
            (FirmId, DepartmentCode),
        CONSTRAINT FK_DepartmentReference_ImportRun FOREIGN KEY
            (EmployeeReferenceImportRunId)
            REFERENCES platform.EmployeeReferenceImportRun
                (EmployeeReferenceImportRunId)
    );
END;
GO

IF OBJECT_ID(N'canonical.JobTitleReference', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.JobTitleReference
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        JobTitleCode nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        JobTitle nvarchar(20) NULL,
        SourceSystem nvarchar(32) NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2
            NOT NULL,
        EmployeeReferenceImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_JobTitleReference_ImportedAtUtc
            DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_JobTitleReference PRIMARY KEY
            (FirmId, JobTitleCode),
        CONSTRAINT FK_JobTitleReference_ImportRun FOREIGN KEY
            (EmployeeReferenceImportRunId)
            REFERENCES platform.EmployeeReferenceImportRun
                (EmployeeReferenceImportRunId)
    );
END;
GO

IF OBJECT_ID(N'canonical.EmployeeReference', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.EmployeeReference
    (
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NOT NULL,
        EmployeeNumber nvarchar(9) COLLATE Latin1_General_100_BIN2 NOT NULL,
        DisplayName nvarchar(64) NOT NULL,
        FirstName nvarchar(14) NULL,
        LastName nvarchar(16) NULL,
        DepartmentCode nvarchar(2) COLLATE Latin1_General_100_BIN2 NULL,
        DepartmentName nvarchar(20) NULL,
        JobTitleCode nvarchar(2) COLLATE Latin1_General_100_BIN2 NULL,
        JobTitle nvarchar(20) NULL,
        EmployeeStatus nvarchar(20) NOT NULL,
        IsActive bit NOT NULL,
        SourceSystem nvarchar(32) NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2
            NOT NULL,
        EmployeeReferenceImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_EmployeeReference_ImportedAtUtc
            DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_EmployeeReference PRIMARY KEY
            (FirmId, EmployeeNumber),
        CONSTRAINT CK_EmployeeReference_Status
            CHECK (EmployeeStatus IN (N'Active', N'Inactive')),
        CONSTRAINT FK_EmployeeReference_ImportRun FOREIGN KEY
            (EmployeeReferenceImportRunId)
            REFERENCES platform.EmployeeReferenceImportRun
                (EmployeeReferenceImportRunId)
    );
END;
GO

IF OBJECT_ID(N'canonical.EmployeeOperationalCode', N'U') IS NULL
BEGIN
    CREATE TABLE canonical.EmployeeOperationalCode
    (
        CodeScope nvarchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,
        FirmId nvarchar(2) COLLATE Latin1_General_100_BIN2 NULL,
        EmployeeNumber nvarchar(9) COLLATE Latin1_General_100_BIN2 NULL,
        CodeType nvarchar(20) COLLATE Latin1_General_100_BIN2 NOT NULL,
        OperationalCode nvarchar(10) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CodeDescription nvarchar(24) NULL,
        ResolutionStatus nvarchar(20) NOT NULL,
        IsActive bit NULL,
        SourceSystem nvarchar(32) NOT NULL,
        SourceRecordIdentity nvarchar(64) COLLATE Latin1_General_100_BIN2
            NOT NULL,
        EmployeeReferenceImportRunId uniqueidentifier NOT NULL,
        ImportedAtUtc datetime2(3) NOT NULL
            CONSTRAINT DF_EmployeeOperationalCode_ImportedAtUtc
            DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_EmployeeOperationalCode PRIMARY KEY
            (CodeScope, CodeType, OperationalCode),
        CONSTRAINT CK_EmployeeOperationalCode_Resolution
            CHECK (ResolutionStatus IN
                (N'ResolvedUnique', N'Unresolved', N'Ambiguous',
                 N'GenericSystem')),
        CONSTRAINT CK_EmployeeOperationalCode_Scope
            CHECK (
                CodeScope = N'GLOBAL'
                OR (CodeScope = N'FIRM' AND FirmId IS NOT NULL)
            ),
        CONSTRAINT FK_EmployeeOperationalCode_Employee FOREIGN KEY
            (FirmId, EmployeeNumber)
            REFERENCES canonical.EmployeeReference (FirmId, EmployeeNumber),
        CONSTRAINT FK_EmployeeOperationalCode_ImportRun FOREIGN KEY
            (EmployeeReferenceImportRunId)
            REFERENCES platform.EmployeeReferenceImportRun
                (EmployeeReferenceImportRunId)
    );
END;
GO

CREATE OR ALTER VIEW canonical.EmployeeReferenceViewer
AS
SELECT
    CONCAT(employee.FirmId, employee.EmployeeNumber) AS EmployeeReferenceId,
    employee.FirmId,
    employee.EmployeeNumber,
    employee.DisplayName,
    employee.FirstName,
    employee.LastName,
    employee.DepartmentCode,
    employee.DepartmentName,
    employee.JobTitleCode,
    employee.JobTitle,
    employee.EmployeeStatus,
    employee.IsActive,
    (
        SELECT COUNT_BIG(*)
        FROM canonical.EmployeeOperationalCode AS code
        WHERE code.FirmId = employee.FirmId
          AND code.EmployeeNumber = employee.EmployeeNumber
    ) AS OperationalCodeCount,
    employee.SourceSystem,
    employee.SourceRecordIdentity,
    employee.EmployeeReferenceImportRunId,
    employee.ImportedAtUtc
FROM canonical.EmployeeReference AS employee;
GO

CREATE OR ALTER VIEW liveapi.EmployeeReferenceMetadata
AS
SELECT TOP (1)
    EmployeeReferenceImportRunId,
    SourceQualificationRunId,
    PackageSha256,
    ContractVersion,
    CompletedAtUtc AS SnapshotAsOfUtc,
    EmployeeCount,
    OperationalCodeCount,
    DepartmentCount,
    JobTitleCount,
    ActiveEmployeeCount,
    InactiveEmployeeCount,
    UnresolvedCodeCount,
    AmbiguousCodeCount,
    GenericSystemCodeCount,
    ImportStatus
FROM platform.EmployeeReferenceImportRun
WHERE ImportStatus = N'SUCCESS'
  AND IsCommitted = 1
  AND IsNoOp = 0
ORDER BY CompletedAtUtc DESC;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_live_api_reader') IS NOT NULL
BEGIN
    GRANT SELECT ON OBJECT::canonical.EmployeeReferenceViewer
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::canonical.EmployeeOperationalCode
        TO [dle_live_api_reader];
    GRANT SELECT ON OBJECT::liveapi.EmployeeReferenceMetadata
        TO [dle_live_api_reader];
END;
GO
