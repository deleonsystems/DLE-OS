USE [DLE_OS_CANONICAL_LIVE];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'platform.LiveSnapshotOperationalStatus', N'U') IS NULL
BEGIN
    CREATE TABLE platform.LiveSnapshotOperationalStatus
    (
        StatusId tinyint NOT NULL
            CONSTRAINT PK_LiveSnapshotOperationalStatus PRIMARY KEY
            CONSTRAINT CK_LiveSnapshotOperationalStatus_Singleton
                CHECK (StatusId = 1),
        ImportRunId uniqueidentifier NOT NULL,
        MirrorRunId nvarchar(128) NOT NULL,
        PackageHash char(64) NOT NULL,
        SnapshotAsOfUtc datetime2(7) NOT NULL,
        SourceCheckedAtUtc datetime2(7) NOT NULL,
        QualificationCompletedAtUtc datetime2(7) NOT NULL,
        LastSourceCheckResult nvarchar(64) NOT NULL,
        SourceChangeStatus nvarchar(32) NOT NULL,
        SourceIndicatorFingerprint char(64) NOT NULL,
        LastFullExtractionRunId nvarchar(128) NOT NULL,
        LastForceFullIntent bit NOT NULL,
        UpdatedAtUtc datetime2(7) NOT NULL,
        CONSTRAINT FK_LiveSnapshotOperationalStatus_ImportRun
            FOREIGN KEY (ImportRunId)
            REFERENCES platform.ImportRun(ImportRunId),
        CONSTRAINT CK_LiveSnapshotOperationalStatus_PackageHash
            CHECK (PackageHash NOT LIKE '%[^0-9A-F]%'),
        CONSTRAINT CK_LiveSnapshotOperationalStatus_Fingerprint
            CHECK (SourceIndicatorFingerprint NOT LIKE '%[^0-9A-F]%'),
        CONSTRAINT CK_LiveSnapshotOperationalStatus_SourceStatus
            CHECK (SourceChangeStatus IN
                (N'Unchanged', N'Changed', N'Qualified', N'Unknown'))
    );
END;
GO

CREATE OR ALTER VIEW liveapi.SnapshotOperationalStatus
AS
    SELECT
        ImportRunId,
        MirrorRunId,
        PackageHash,
        SnapshotAsOfUtc,
        SourceCheckedAtUtc,
        QualificationCompletedAtUtc,
        LastSourceCheckResult,
        SourceChangeStatus,
        SourceIndicatorFingerprint,
        LastFullExtractionRunId,
        LastForceFullIntent,
        UpdatedAtUtc
    FROM platform.LiveSnapshotOperationalStatus
    WHERE StatusId = 1;
GO

CREATE OR ALTER PROCEDURE platform.RecordLiveSourceCheck
    @ImportRunId uniqueidentifier,
    @CheckedAtUtc datetime2(7),
    @Result nvarchar(64),
    @IndicatorFingerprint char(64),
    @IndicatorsUnchanged bit
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @CheckedAtUtc > DATEADD(MINUTE, 5, SYSUTCDATETIME())
        THROW 51320, 'Source check timestamp is in the future.', 1;

    IF @IndicatorFingerprint LIKE '%[^0-9A-F]%'
        THROW 51321, 'Source indicator fingerprint is invalid.', 1;

    BEGIN TRANSACTION;

    IF NOT EXISTS
    (
        SELECT 1
        FROM platform.LiveSnapshotOperationalStatus WITH (UPDLOCK, HOLDLOCK)
        WHERE StatusId = 1
          AND ImportRunId = @ImportRunId
    )
        THROW 51322, 'Source check does not target the active snapshot.', 1;

    IF @IndicatorsUnchanged = 1
    BEGIN
        UPDATE platform.LiveSnapshotOperationalStatus
        SET SourceCheckedAtUtc = @CheckedAtUtc,
            LastSourceCheckResult = @Result,
            SourceChangeStatus = N'Unchanged',
            SourceIndicatorFingerprint = @IndicatorFingerprint,
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE StatusId = 1;
    END
    ELSE
    BEGIN
        UPDATE platform.LiveSnapshotOperationalStatus
        SET LastSourceCheckResult = @Result,
            SourceChangeStatus = N'Changed',
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE StatusId = 1;
    END;

    COMMIT TRANSACTION;
END;
GO

CREATE OR ALTER PROCEDURE platform.RecordLiveFullQualification
    @ImportRunId uniqueidentifier,
    @MirrorRunId nvarchar(128),
    @PackageHash char(64),
    @SnapshotAsOfUtc datetime2(7),
    @SourceCheckedAtUtc datetime2(7),
    @QualificationCompletedAtUtc datetime2(7),
    @SourceIndicatorFingerprint char(64),
    @FullExtractionRunId nvarchar(128),
    @ForceFullIntent bit
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @PackageHash LIKE '%[^0-9A-F]%' OR
       @SourceIndicatorFingerprint LIKE '%[^0-9A-F]%'
        THROW 51323, 'Qualification hash input is invalid.', 1;

    BEGIN TRANSACTION;

    IF NOT EXISTS
    (
        SELECT 1
        FROM liveapi.SnapshotMetadata
        WHERE ImportRunId = @ImportRunId
          AND MirrorRunId = @MirrorRunId
          AND PackageHash = @PackageHash
          AND SnapshotTimestampUtc = @SnapshotAsOfUtc
    )
        THROW 51324, 'Full qualification does not match active SQL metadata.', 1;

    UPDATE platform.LiveSnapshotOperationalStatus WITH (UPDLOCK, HOLDLOCK)
    SET ImportRunId = @ImportRunId,
        MirrorRunId = @MirrorRunId,
        PackageHash = @PackageHash,
        SnapshotAsOfUtc = @SnapshotAsOfUtc,
        SourceCheckedAtUtc = @SourceCheckedAtUtc,
        QualificationCompletedAtUtc = @QualificationCompletedAtUtc,
        LastSourceCheckResult = N'FULL_EXTRACTION_QUALIFIED',
        SourceChangeStatus = N'Qualified',
        SourceIndicatorFingerprint = @SourceIndicatorFingerprint,
        LastFullExtractionRunId = @FullExtractionRunId,
        LastForceFullIntent = @ForceFullIntent,
        UpdatedAtUtc = SYSUTCDATETIME()
    WHERE StatusId = 1;

    IF @@ROWCOUNT = 0
    BEGIN
        INSERT platform.LiveSnapshotOperationalStatus
        (
            StatusId,
            ImportRunId,
            MirrorRunId,
            PackageHash,
            SnapshotAsOfUtc,
            SourceCheckedAtUtc,
            QualificationCompletedAtUtc,
            LastSourceCheckResult,
            SourceChangeStatus,
            SourceIndicatorFingerprint,
            LastFullExtractionRunId,
            LastForceFullIntent,
            UpdatedAtUtc
        )
        VALUES
        (
            1,
            @ImportRunId,
            @MirrorRunId,
            @PackageHash,
            @SnapshotAsOfUtc,
            @SourceCheckedAtUtc,
            @QualificationCompletedAtUtc,
            N'FULL_EXTRACTION_QUALIFIED',
            N'Qualified',
            @SourceIndicatorFingerprint,
            @FullExtractionRunId,
            @ForceFullIntent,
            SYSUTCDATETIME()
        );
    END;

    COMMIT TRANSACTION;
END;
GO

IF DATABASE_PRINCIPAL_ID(N'dle_live_api_reader') IS NULL
    THROW 51325, 'Qualified LIVE API reader role is absent.', 1;

GRANT SELECT ON OBJECT::liveapi.SnapshotOperationalStatus
    TO dle_live_api_reader;

IF SUSER_ID(N'DLE-OS-HOST\DLE-OS') IS NULL
    THROW 51326, 'Approved refresh SQL login is absent.', 1;

DECLARE @ApprovedRefreshUser sysname =
(
    SELECT TOP (1) name
    FROM sys.database_principals
    WHERE sid = SUSER_SID(N'DLE-OS-HOST\DLE-OS')
);

IF @ApprovedRefreshUser IS NULL
BEGIN
    CREATE USER [DLE-OS-HOST\DLE-OS]
        FOR LOGIN [DLE-OS-HOST\DLE-OS];
    SET @ApprovedRefreshUser = N'DLE-OS-HOST\DLE-OS';
END;

DECLARE @PermissionStatement nvarchar(max);

SET @PermissionStatement =
    N'GRANT EXECUTE ON OBJECT::platform.RecordLiveSourceCheck TO ' +
    QUOTENAME(@ApprovedRefreshUser) + N';';
EXEC sys.sp_executesql @PermissionStatement;

SET @PermissionStatement =
    N'GRANT EXECUTE ON OBJECT::platform.RecordLiveFullQualification TO ' +
    QUOTENAME(@ApprovedRefreshUser) + N';';
EXEC sys.sp_executesql @PermissionStatement;
GO
