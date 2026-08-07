SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'DLE_OS_SECURITY_DEV'
    THROW 52200, 'Employee Directory migration requires DLE_OS_SECURITY_DEV.', 1;
GO

IF SCHEMA_ID(N'hr') IS NULL
    EXEC(N'CREATE SCHEMA hr AUTHORIZATION dbo;');
GO

IF OBJECT_ID(N'hr.EmployeeSyncRun', N'U') IS NULL
BEGIN
    CREATE TABLE hr.EmployeeSyncRun
    (
        EmployeeSyncRunId uniqueidentifier NOT NULL,
        SourceSystem varchar(32) NOT NULL,
        SourceQualificationRunId nvarchar(128) NOT NULL,
        SourcePackageSha256 char(64) NOT NULL,
        StartedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_EmployeeSyncRun_Started DEFAULT SYSUTCDATETIME(),
        CompletedAtUtc datetime2(3) NULL,
        SourceRecordCount int NOT NULL,
        InsertedCount int NULL,
        UpdatedCount int NULL,
        ReviewCount int NULL,
        SyncStatus varchar(16) NOT NULL,
        ExecutedBy nvarchar(256) NOT NULL,
        CONSTRAINT PK_EmployeeSyncRun PRIMARY KEY (EmployeeSyncRunId),
        CONSTRAINT CK_EmployeeSyncRun_Status CHECK (SyncStatus IN ('STARTED','SUCCESS','FAILED')),
        CONSTRAINT CK_EmployeeSyncRun_Hash CHECK
            (LEN(SourcePackageSha256)=64 AND SourcePackageSha256 NOT LIKE '%[^0-9A-F]%')
    );
END;
GO

IF OBJECT_ID(N'hr.Employee', N'U') IS NULL
BEGIN
    CREATE TABLE hr.Employee
    (
        EmployeeId uniqueidentifier NOT NULL,
        SourceSystem varchar(32) NOT NULL,
        FirmId char(2) NOT NULL,
        SourceEmployeeIdRaw varchar(32) NOT NULL,
        EmployeeNumber char(4) NULL,
        FirstName nvarchar(100) NOT NULL,
        LastName nvarchar(100) NOT NULL,
        DisplayName nvarchar(200) NOT NULL,
        DepartmentCode varchar(10) NULL,
        DepartmentName nvarchar(100) NULL,
        JobTitleCode varchar(10) NULL,
        JobTitle nvarchar(100) NULL,
        SourceEmploymentStatus varchar(20) NOT NULL,
        DleWorkforceStatus varchar(24) NOT NULL,
        ProvisioningStatus varchar(24) NOT NULL,
        ProposedUserName nvarchar(100) NULL,
        MissingFromSource bit NOT NULL CONSTRAINT DF_Employee_Missing DEFAULT(0),
        SourceReviewReason varchar(64) NULL,
        LastSourceSyncRunId uniqueidentifier NOT NULL,
        LastSourceSyncAtUtc datetime2(3) NOT NULL,
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_Employee_Created DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_Employee_Updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Employee PRIMARY KEY (EmployeeId),
        CONSTRAINT FK_Employee_LastSync FOREIGN KEY (LastSourceSyncRunId)
            REFERENCES hr.EmployeeSyncRun(EmployeeSyncRunId),
        CONSTRAINT CK_Employee_SourceStatus CHECK
            (SourceEmploymentStatus IN ('ACTIVE','INACTIVE','SOURCE_REVIEW')),
        CONSTRAINT CK_Employee_WorkforceStatus CHECK
            (DleWorkforceStatus IN ('CURRENT','HISTORICAL_RETAINED','INACTIVE','SOURCE_REVIEW')),
        CONSTRAINT CK_Employee_ProvisioningStatus CHECK
            (ProvisioningStatus IN ('NOT_PROVISIONED','PROPOSED','ACTIVE','DISABLED','BLOCKED')),
        CONSTRAINT CK_Employee_IdentityText CHECK
            (LEN(LTRIM(RTRIM(SourceEmployeeIdRaw)))>0 AND LEN(LTRIM(RTRIM(DisplayName)))>0),
        CONSTRAINT CK_Employee_NumberFormat CHECK
            (EmployeeNumber IS NULL OR
             (LEN(EmployeeNumber)=4 AND EmployeeNumber NOT LIKE '%[^0-9]%'))
    );
    CREATE UNIQUE INDEX UX_Employee_SourceIdentity
        ON hr.Employee(SourceSystem,FirmId,SourceEmployeeIdRaw);
    CREATE UNIQUE INDEX UX_Employee_BusinessNumber
        ON hr.Employee(FirmId,EmployeeNumber) WHERE EmployeeNumber IS NOT NULL;
    CREATE UNIQUE INDEX UX_Employee_ProposedUserName
        ON hr.Employee(ProposedUserName) WHERE ProposedUserName IS NOT NULL;
    CREATE INDEX IX_Employee_WorkforceDirectory
        ON hr.Employee(DleWorkforceStatus,EmployeeNumber);
END;
GO

IF OBJECT_ID(N'hr.EmployeeWorkforceDisposition', N'U') IS NULL
BEGIN
    CREATE TABLE hr.EmployeeWorkforceDisposition
    (
        EmployeeWorkforceDispositionId uniqueidentifier NOT NULL,
        EmployeeId uniqueidentifier NOT NULL,
        DispositionCode varchar(24) NOT NULL,
        ReasonCode varchar(64) NOT NULL,
        EffectiveAtUtc datetime2(3) NOT NULL,
        EndedAtUtc datetime2(3) NULL,
        SetByUserId uniqueidentifier NOT NULL,
        SetAtUtc datetime2(3) NOT NULL CONSTRAINT DF_EmployeeDisposition_SetAt DEFAULT SYSUTCDATETIME(),
        Note nvarchar(1000) NULL,
        CONSTRAINT PK_EmployeeWorkforceDisposition PRIMARY KEY (EmployeeWorkforceDispositionId),
        CONSTRAINT FK_EmployeeDisposition_Employee FOREIGN KEY (EmployeeId)
            REFERENCES hr.Employee(EmployeeId),
        CONSTRAINT FK_EmployeeDisposition_SetBy FOREIGN KEY (SetByUserId)
            REFERENCES security.[User](UserId),
        CONSTRAINT CK_EmployeeDisposition_Code CHECK
            (DispositionCode IN ('HISTORICAL_RETAINED')),
        CONSTRAINT CK_EmployeeDisposition_Effective CHECK
            (EndedAtUtc IS NULL OR EndedAtUtc >= EffectiveAtUtc)
    );
    CREATE UNIQUE INDEX UX_EmployeeDisposition_Active
        ON hr.EmployeeWorkforceDisposition(EmployeeId) WHERE EndedAtUtc IS NULL;
END;
GO

IF OBJECT_ID(N'security.UserEmployeeLink', N'U') IS NULL
BEGIN
    CREATE TABLE security.UserEmployeeLink
    (
        UserEmployeeLinkId uniqueidentifier NOT NULL,
        UserId uniqueidentifier NOT NULL,
        EmployeeId uniqueidentifier NOT NULL,
        IsActive bit NOT NULL,
        LinkEvidenceCode varchar(64) NOT NULL,
        LinkedByUserId uniqueidentifier NOT NULL,
        LinkedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_UserEmployeeLink_LinkedAt DEFAULT SYSUTCDATETIME(),
        DeactivatedAtUtc datetime2(3) NULL,
        DeactivatedByUserId uniqueidentifier NULL,
        CONSTRAINT PK_UserEmployeeLink PRIMARY KEY (UserEmployeeLinkId),
        CONSTRAINT FK_UserEmployeeLink_User FOREIGN KEY (UserId)
            REFERENCES security.[User](UserId),
        CONSTRAINT FK_UserEmployeeLink_Employee FOREIGN KEY (EmployeeId)
            REFERENCES hr.Employee(EmployeeId),
        CONSTRAINT FK_UserEmployeeLink_LinkedBy FOREIGN KEY (LinkedByUserId)
            REFERENCES security.[User](UserId),
        CONSTRAINT FK_UserEmployeeLink_DeactivatedBy FOREIGN KEY (DeactivatedByUserId)
            REFERENCES security.[User](UserId),
        CONSTRAINT CK_UserEmployeeLink_Lifecycle CHECK
            ((IsActive=1 AND DeactivatedAtUtc IS NULL AND DeactivatedByUserId IS NULL) OR
             (IsActive=0 AND DeactivatedAtUtc IS NOT NULL AND DeactivatedByUserId IS NOT NULL))
    );
    CREATE UNIQUE INDEX UX_UserEmployeeLink_ActiveUser
        ON security.UserEmployeeLink(UserId) WHERE IsActive=1;
    CREATE UNIQUE INDEX UX_UserEmployeeLink_ActiveEmployee
        ON security.UserEmployeeLink(EmployeeId) WHERE IsActive=1;
END;
GO

CREATE OR ALTER VIEW hr.EmployeeDirectoryView
AS
SELECT
    employee.EmployeeId,
    employee.SourceSystem,
    employee.FirmId,
    employee.SourceEmployeeIdRaw,
    employee.EmployeeNumber,
    employee.DisplayName,
    employee.FirstName,
    employee.LastName,
    employee.DepartmentCode,
    employee.DepartmentName,
    employee.JobTitleCode,
    employee.JobTitle,
    employee.SourceEmploymentStatus,
    employee.DleWorkforceStatus,
    employee.ProvisioningStatus,
    employee.ProposedUserName,
    CAST(CASE WHEN employee.SourceEmploymentStatus='ACTIVE'
                   AND employee.DleWorkforceStatus='CURRENT' THEN 1 ELSE 0 END AS bit)
        AS AccessEligible,
    CAST(CASE WHEN employee.SourceEmploymentStatus='ACTIVE'
                   AND employee.DleWorkforceStatus='CURRENT' THEN 1 ELSE 0 END AS bit)
        AS TrainingEligible,
    linked.UserId,
    linked.UserName AS DleOsUserName,
    linked.DisplayName AS DleOsUserDisplayName,
    linked.AccountStatus AS DleOsAccountStatus,
    CAST(CASE WHEN linked.AccountStatus='ACTIVE' THEN 1 ELSE 0 END AS bit) AS HasDleOsAccess,
    employee.MissingFromSource,
    employee.SourceReviewReason,
    employee.LastSourceSyncAtUtc,
    employee.CreatedAtUtc,
    employee.UpdatedAtUtc
FROM hr.Employee AS employee
OUTER APPLY
(
    SELECT TOP (1) users.UserId,users.UserName,users.DisplayName,users.AccountStatus
    FROM security.UserEmployeeLink AS link
    JOIN security.[User] AS users ON users.UserId=link.UserId
    WHERE link.EmployeeId=employee.EmployeeId AND link.IsActive=1
) AS linked;
GO

CREATE OR ALTER PROCEDURE hr.usp_SyncEmployeeDirectory
    @SourceSystem varchar(32),
    @SourceQualificationRunId nvarchar(128),
    @SourcePackageSha256 char(64),
    @SourceRowsJson nvarchar(max),
    @MiguelUserId uniqueidentifier,
    @ExecutedBy nvarchar(256)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF DB_NAME() <> N'DLE_OS_SECURITY_DEV'
        THROW 52201, 'Employee sync requires DLE_OS_SECURITY_DEV.', 1;
    IF @SourceSystem <> 'VPRO5_PRM01' OR ISJSON(@SourceRowsJson)<>1
        THROW 52202, 'Employee sync source contract is invalid.', 1;
    IF UPPER(@SourcePackageSha256) LIKE '%[^0-9A-F]%' OR LEN(@SourcePackageSha256)<>64
        THROW 52203, 'Employee sync package hash is invalid.', 1;
    IF NOT EXISTS
    (
        SELECT 1
        FROM security.[User] AS users
        JOIN security.ExternalIdentity AS identityMap
          ON identityMap.UserId=users.UserId AND identityMap.IsActive=1
        JOIN security.UserRole AS userRole
          ON userRole.UserId=users.UserId AND userRole.IsActive=1
        JOIN security.[Role] AS role
          ON role.RoleId=userRole.RoleId AND role.IsActive=1 AND role.IsSuperAdmin=1
        WHERE users.UserId=@MiguelUserId AND users.UserName=N'Miguel'
          AND users.AccountStatus='ACTIVE' AND identityMap.Provider='WINDOWS'
          AND identityMap.NormalizedSubject=N'DLE-OS-HOST\MIGUEL'
    ) THROW 52204, 'The explicit Miguel security identity is not qualified.', 1;

    CREATE TABLE #Source
    (
        FirmId char(2) NOT NULL,
        SourceEmployeeIdRaw varchar(32) NOT NULL,
        EmployeeNumber char(4) NULL,
        FirstName nvarchar(100) NOT NULL,
        LastName nvarchar(100) NOT NULL,
        DisplayName nvarchar(200) NOT NULL,
        DepartmentCode varchar(10) NULL,
        DepartmentName nvarchar(100) NULL,
        JobTitleCode varchar(10) NULL,
        JobTitle nvarchar(100) NULL,
        SourceEmploymentStatus varchar(20) NOT NULL,
        ProposedUserName nvarchar(100) NULL,
        ReviewReason varchar(64) NULL
    );

    INSERT #Source
    (
        FirmId,SourceEmployeeIdRaw,EmployeeNumber,FirstName,LastName,DisplayName,
        DepartmentCode,DepartmentName,JobTitleCode,JobTitle,SourceEmploymentStatus,
        ProposedUserName,ReviewReason
    )
    SELECT
        FirmId,SourceEmployeeIdRaw,
        CASE WHEN LEN(SourceEmployeeIdRaw)=9
                   AND SourceEmployeeIdRaw NOT LIKE '%[^0-9]%'
                   AND RIGHT(SourceEmployeeIdRaw,5)='00000'
             THEN LEFT(SourceEmployeeIdRaw,4) END,
        FirstName,LastName,DisplayName,DepartmentCode,DepartmentName,JobTitleCode,JobTitle,
        CASE WHEN LEN(SourceEmployeeIdRaw)<>9
                    OR SourceEmployeeIdRaw LIKE '%[^0-9]%'
                    OR RIGHT(SourceEmployeeIdRaw,5)<>'00000' THEN 'SOURCE_REVIEW'
             WHEN UPPER(EmployeeStatus)='ACTIVE' THEN 'ACTIVE'
             WHEN UPPER(EmployeeStatus)='INACTIVE' THEN 'INACTIVE'
             ELSE 'SOURCE_REVIEW' END,
        NULLIF(ProposedUserName,N''),
        CASE WHEN LEN(SourceEmployeeIdRaw)<>9
                    OR SourceEmployeeIdRaw LIKE '%[^0-9]%'
                    OR RIGHT(SourceEmployeeIdRaw,5)<>'00000' THEN 'INVALID_RAW_EMPLOYEE_ID'
             WHEN UPPER(EmployeeStatus) NOT IN ('ACTIVE','INACTIVE') THEN 'UNKNOWN_SOURCE_STATUS' END
    FROM OPENJSON(@SourceRowsJson)
    WITH
    (
        FirmId char(2) '$.FirmId',
        SourceEmployeeIdRaw varchar(32) '$.SourceEmployeeIdRaw',
        FirstName nvarchar(100) '$.FirstName',
        LastName nvarchar(100) '$.LastName',
        DisplayName nvarchar(200) '$.DisplayName',
        DepartmentCode varchar(10) '$.DepartmentCode',
        DepartmentName nvarchar(100) '$.DepartmentName',
        JobTitleCode varchar(10) '$.JobTitleCode',
        JobTitle nvarchar(100) '$.JobTitle',
        EmployeeStatus varchar(20) '$.EmployeeStatus',
        ProposedUserName nvarchar(100) '$.ProposedUserName'
    );

    IF NOT EXISTS (SELECT 1 FROM #Source)
        THROW 52205, 'Employee sync source contains no records.', 1;
    IF EXISTS
    (
        SELECT FirmId,SourceEmployeeIdRaw FROM #Source
        GROUP BY FirmId,SourceEmployeeIdRaw HAVING COUNT(*)>1
    ) THROW 52206, 'Employee sync contains duplicate raw source identities.', 1;
    IF EXISTS
    (
        SELECT FirmId,EmployeeNumber FROM #Source WHERE EmployeeNumber IS NOT NULL
        GROUP BY FirmId,EmployeeNumber HAVING COUNT(*)>1
    ) THROW 52207, 'Employee normalization produced a collision.', 1;
    IF EXISTS
    (
        SELECT ProposedUserName FROM #Source WHERE ProposedUserName IS NOT NULL
        GROUP BY ProposedUserName HAVING COUNT(*)>1
    ) THROW 52208, 'Employee username proposals contain a collision.', 1;

    DECLARE @RunId uniqueidentifier=NEWID(),@Now datetime2(3)=SYSUTCDATETIME();
    DECLARE @Inserted int=0,@Updated int=0;
    BEGIN TRANSACTION;
    BEGIN TRY
        INSERT hr.EmployeeSyncRun
        (
            EmployeeSyncRunId,SourceSystem,SourceQualificationRunId,SourcePackageSha256,
            StartedAtUtc,SourceRecordCount,SyncStatus,ExecutedBy
        )
        SELECT @RunId,@SourceSystem,@SourceQualificationRunId,UPPER(@SourcePackageSha256),
               @Now,COUNT(*),'STARTED',@ExecutedBy FROM #Source;

        UPDATE employee
        SET EmployeeNumber=source.EmployeeNumber,
            FirstName=source.FirstName,LastName=source.LastName,DisplayName=source.DisplayName,
            DepartmentCode=source.DepartmentCode,DepartmentName=source.DepartmentName,
            JobTitleCode=source.JobTitleCode,JobTitle=source.JobTitle,
            SourceEmploymentStatus=source.SourceEmploymentStatus,
            ProposedUserName=COALESCE(employee.ProposedUserName,source.ProposedUserName),
            MissingFromSource=0,SourceReviewReason=source.ReviewReason,
            LastSourceSyncRunId=@RunId,LastSourceSyncAtUtc=@Now,UpdatedAtUtc=@Now
        FROM hr.Employee AS employee
        JOIN #Source AS source
          ON source.FirmId=employee.FirmId
         AND source.SourceEmployeeIdRaw=employee.SourceEmployeeIdRaw
        WHERE employee.SourceSystem=@SourceSystem;
        SET @Updated=@@ROWCOUNT;

        INSERT hr.Employee
        (
            EmployeeId,SourceSystem,FirmId,SourceEmployeeIdRaw,EmployeeNumber,
            FirstName,LastName,DisplayName,DepartmentCode,DepartmentName,JobTitleCode,JobTitle,
            SourceEmploymentStatus,DleWorkforceStatus,ProvisioningStatus,ProposedUserName,
            MissingFromSource,SourceReviewReason,LastSourceSyncRunId,LastSourceSyncAtUtc,
            CreatedAtUtc,UpdatedAtUtc
        )
        SELECT
            NEWID(),@SourceSystem,source.FirmId,source.SourceEmployeeIdRaw,source.EmployeeNumber,
            source.FirstName,source.LastName,source.DisplayName,source.DepartmentCode,
            source.DepartmentName,source.JobTitleCode,source.JobTitle,source.SourceEmploymentStatus,
            CASE source.SourceEmploymentStatus WHEN 'ACTIVE' THEN 'CURRENT'
                 WHEN 'INACTIVE' THEN 'INACTIVE' ELSE 'SOURCE_REVIEW' END,
            CASE source.SourceEmployeeIdRaw WHEN '000100000' THEN 'BLOCKED'
                 WHEN '005400000' THEN 'ACTIVE' ELSE 'NOT_PROVISIONED' END,
            source.ProposedUserName,0,source.ReviewReason,@RunId,@Now,@Now,@Now
        FROM #Source AS source
        WHERE NOT EXISTS
        (
            SELECT 1 FROM hr.Employee AS employee
            WHERE employee.SourceSystem=@SourceSystem AND employee.FirmId=source.FirmId
              AND employee.SourceEmployeeIdRaw=source.SourceEmployeeIdRaw
        );
        SET @Inserted=@@ROWCOUNT;

        UPDATE employee
        SET DleWorkforceStatus='SOURCE_REVIEW',MissingFromSource=1,
            SourceReviewReason='MISSING_FROM_SOURCE',UpdatedAtUtc=@Now
        FROM hr.Employee AS employee
        WHERE employee.SourceSystem=@SourceSystem
          AND NOT EXISTS
          (
              SELECT 1 FROM #Source AS source
              WHERE source.FirmId=employee.FirmId
                AND source.SourceEmployeeIdRaw=employee.SourceEmployeeIdRaw
          );

        DECLARE @FounderEmployeeId uniqueidentifier=
        (
            SELECT EmployeeId FROM hr.Employee
            WHERE SourceSystem=@SourceSystem AND FirmId='01'
              AND SourceEmployeeIdRaw='000100000'
        );
        DECLARE @MiguelEmployeeId uniqueidentifier=
        (
            SELECT EmployeeId FROM hr.Employee
            WHERE SourceSystem=@SourceSystem AND FirmId='01'
              AND SourceEmployeeIdRaw='005400000'
        );
        IF @FounderEmployeeId IS NULL OR @MiguelEmployeeId IS NULL
            THROW 52209, 'Required governed Miguel identity records are absent.', 1;

        IF NOT EXISTS
        (
            SELECT 1 FROM hr.EmployeeWorkforceDisposition
            WHERE EmployeeId=@FounderEmployeeId AND EndedAtUtc IS NULL
        )
            INSERT hr.EmployeeWorkforceDisposition
            (
                EmployeeWorkforceDispositionId,EmployeeId,DispositionCode,ReasonCode,
                EffectiveAtUtc,SetByUserId,SetAtUtc,Note
            )
            VALUES
            (
                NEWID(),@FounderEmployeeId,'HISTORICAL_RETAINED','HISTORICAL_FOUNDER_RETAINED',
                @Now,@MiguelUserId,@Now,
                N'Founder/father retained as ACTIVE in VPro5; excluded from current DLE workforce.'
            );

        UPDATE employee
        SET DleWorkforceStatus=
            CASE WHEN employee.SourceEmploymentStatus='INACTIVE' THEN 'INACTIVE'
                 WHEN employee.SourceEmploymentStatus='SOURCE_REVIEW' THEN 'SOURCE_REVIEW'
                 WHEN disposition.DispositionCode='HISTORICAL_RETAINED'
                      THEN 'HISTORICAL_RETAINED'
                 ELSE 'CURRENT' END,
            ProvisioningStatus=CASE WHEN employee.EmployeeId=@FounderEmployeeId
                                    THEN 'BLOCKED' ELSE employee.ProvisioningStatus END,
            ProposedUserName=CASE WHEN employee.EmployeeId=@FounderEmployeeId
                                  THEN NULL ELSE employee.ProposedUserName END,
            UpdatedAtUtc=@Now
        FROM hr.Employee AS employee
        JOIN #Source AS source
          ON source.FirmId=employee.FirmId
         AND source.SourceEmployeeIdRaw=employee.SourceEmployeeIdRaw
        OUTER APPLY
        (
            SELECT TOP (1) activeDisposition.DispositionCode
            FROM hr.EmployeeWorkforceDisposition AS activeDisposition
            WHERE activeDisposition.EmployeeId=employee.EmployeeId
              AND activeDisposition.EndedAtUtc IS NULL
            ORDER BY activeDisposition.SetAtUtc DESC
        ) AS disposition
        WHERE employee.SourceSystem=@SourceSystem;

        IF EXISTS
        (
            SELECT 1 FROM security.UserEmployeeLink
            WHERE EmployeeId=@FounderEmployeeId AND IsActive=1
        ) THROW 52210, 'Employee 0001 must never have an active user link.', 1;
        IF EXISTS
        (
            SELECT 1 FROM security.UserEmployeeLink
            WHERE EmployeeId=@MiguelEmployeeId AND IsActive=1 AND UserId<>@MiguelUserId
        ) THROW 52211, 'Employee 0054 has a contradictory active user link.', 1;
        IF EXISTS
        (
            SELECT 1 FROM security.UserEmployeeLink
            WHERE UserId=@MiguelUserId AND IsActive=1 AND EmployeeId<>@MiguelEmployeeId
        ) THROW 52212, 'User Miguel has a contradictory active employee link.', 1;

        IF NOT EXISTS
        (
            SELECT 1 FROM security.UserEmployeeLink
            WHERE UserId=@MiguelUserId AND EmployeeId=@MiguelEmployeeId AND IsActive=1
        )
            INSERT security.UserEmployeeLink
            (
                UserEmployeeLinkId,UserId,EmployeeId,IsActive,LinkEvidenceCode,
                LinkedByUserId,LinkedAtUtc
            )
            VALUES
            (
                NEWID(),@MiguelUserId,@MiguelEmployeeId,1,
                'OWNER_CONFIRMED_EMPLOYEE_0054',@MiguelUserId,@Now
            );

        UPDATE hr.Employee
        SET ProvisioningStatus='ACTIVE',ProposedUserName=N'miguel',UpdatedAtUtc=@Now
        WHERE EmployeeId=@MiguelEmployeeId;

        UPDATE hr.EmployeeSyncRun
        SET CompletedAtUtc=SYSUTCDATETIME(),InsertedCount=@Inserted,UpdatedCount=@Updated,
            ReviewCount=(SELECT COUNT(*) FROM hr.Employee WHERE DleWorkforceStatus='SOURCE_REVIEW'),
            SyncStatus='SUCCESS'
        WHERE EmployeeSyncRunId=@RunId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT @RunId AS EmployeeSyncRunId,@Inserted AS InsertedCount,@Updated AS UpdatedCount,
           (SELECT COUNT(*) FROM hr.Employee) AS EmployeeCount,
           (SELECT COUNT(*) FROM hr.Employee WHERE DleWorkforceStatus='SOURCE_REVIEW') AS ReviewCount;
END;
GO
