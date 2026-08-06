SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRANSACTION;

IF SCHEMA_ID(N'security') IS NULL
    EXEC(N'CREATE SCHEMA security AUTHORIZATION dbo;');

IF OBJECT_ID(N'security.[User]', N'U') IS NULL
BEGIN
    CREATE TABLE security.[User]
    (
        UserId uniqueidentifier NOT NULL,
        UserName nvarchar(100) NOT NULL,
        NormalizedUserName AS UPPER(LTRIM(RTRIM(UserName))) PERSISTED,
        DisplayName nvarchar(200) NOT NULL,
        AccountStatus varchar(16) NOT NULL,
        IsSystemAccount bit NOT NULL CONSTRAINT DF_SecurityUser_IsSystemAccount DEFAULT(0),
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_SecurityUser_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        CreatedBy nvarchar(256) NOT NULL,
        ModifiedAtUtc datetime2(3) NULL,
        ModifiedByUserId uniqueidentifier NULL,
        ModifiedByActor nvarchar(256) NULL,
        CONSTRAINT PK_SecurityUser PRIMARY KEY (UserId),
        CONSTRAINT CK_SecurityUser_UserName CHECK (LEN(LTRIM(RTRIM(UserName))) > 0),
        CONSTRAINT CK_SecurityUser_DisplayName CHECK (LEN(LTRIM(RTRIM(DisplayName))) > 0),
        CONSTRAINT CK_SecurityUser_Status CHECK (AccountStatus IN ('ACTIVE','DISABLED','LOCKED','PENDING')),
        CONSTRAINT CK_SecurityUser_ModificationAttribution CHECK
            ((ModifiedAtUtc IS NULL AND ModifiedByUserId IS NULL AND ModifiedByActor IS NULL) OR
             (ModifiedAtUtc IS NOT NULL AND ModifiedByActor IS NOT NULL)),
        CONSTRAINT FK_SecurityUser_ModifiedByUser FOREIGN KEY (ModifiedByUserId)
            REFERENCES security.[User](UserId)
    );
    CREATE UNIQUE INDEX UX_SecurityUser_NormalizedUserName
        ON security.[User](NormalizedUserName);
END;

IF OBJECT_ID(N'security.ExternalIdentity', N'U') IS NULL
BEGIN
    CREATE TABLE security.ExternalIdentity
    (
        ExternalIdentityId uniqueidentifier NOT NULL,
        UserId uniqueidentifier NOT NULL,
        Provider varchar(32) NOT NULL,
        Subject nvarchar(256) NOT NULL,
        NormalizedSubject AS UPPER(LTRIM(RTRIM(Subject))) PERSISTED,
        IsActive bit NOT NULL CONSTRAINT DF_ExternalIdentity_IsActive DEFAULT(1),
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_ExternalIdentity_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        CreatedBy nvarchar(256) NOT NULL,
        DeactivatedAtUtc datetime2(3) NULL,
        DeactivatedByUserId uniqueidentifier NULL,
        DeactivatedByActor nvarchar(256) NULL,
        CONSTRAINT PK_ExternalIdentity PRIMARY KEY (ExternalIdentityId),
        CONSTRAINT FK_ExternalIdentity_User FOREIGN KEY (UserId)
            REFERENCES security.[User](UserId),
        CONSTRAINT FK_ExternalIdentity_DeactivatedByUser FOREIGN KEY (DeactivatedByUserId)
            REFERENCES security.[User](UserId),
        CONSTRAINT CK_ExternalIdentity_Provider CHECK (Provider IN ('WINDOWS')),
        CONSTRAINT CK_ExternalIdentity_Subject CHECK (LEN(LTRIM(RTRIM(Subject))) > 0),
        CONSTRAINT CK_ExternalIdentity_Deactivation CHECK
            ((IsActive=1 AND DeactivatedAtUtc IS NULL AND DeactivatedByUserId IS NULL AND DeactivatedByActor IS NULL) OR
             (IsActive=0 AND DeactivatedAtUtc IS NOT NULL AND DeactivatedByActor IS NOT NULL))
    );
    CREATE UNIQUE INDEX UX_ExternalIdentity_Provider_NormalizedSubject
        ON security.ExternalIdentity(Provider, NormalizedSubject);
    CREATE INDEX IX_ExternalIdentity_User
        ON security.ExternalIdentity(UserId, IsActive);
END;

IF OBJECT_ID(N'security.[Role]', N'U') IS NULL
BEGIN
    CREATE TABLE security.[Role]
    (
        RoleId uniqueidentifier NOT NULL,
        RoleCode varchar(100) NOT NULL,
        DisplayName nvarchar(200) NOT NULL,
        Description nvarchar(1000) NULL,
        IsSystemRole bit NOT NULL CONSTRAINT DF_SecurityRole_IsSystemRole DEFAULT(0),
        IsSuperAdmin bit NOT NULL CONSTRAINT DF_SecurityRole_IsSuperAdmin DEFAULT(0),
        IsActive bit NOT NULL CONSTRAINT DF_SecurityRole_IsActive DEFAULT(1),
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_SecurityRole_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        CreatedBy nvarchar(256) NOT NULL,
        CONSTRAINT PK_SecurityRole PRIMARY KEY (RoleId),
        CONSTRAINT UQ_SecurityRole_RoleCode UNIQUE (RoleCode),
        CONSTRAINT CK_SecurityRole_RoleCode CHECK
            (LEN(LTRIM(RTRIM(RoleCode))) > 0 AND RoleCode=UPPER(RoleCode)),
        CONSTRAINT CK_SecurityRole_SuperAdminSystem CHECK
            (IsSuperAdmin=0 OR IsSystemRole=1)
    );
END;

IF OBJECT_ID(N'security.Permission', N'U') IS NULL
BEGIN
    CREATE TABLE security.Permission
    (
        PermissionId uniqueidentifier NOT NULL,
        PermissionCode varchar(160) NOT NULL,
        DisplayName nvarchar(200) NOT NULL,
        Description nvarchar(1000) NULL,
        Category varchar(100) NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_SecurityPermission_IsActive DEFAULT(1),
        CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_SecurityPermission_CreatedAtUtc DEFAULT(SYSUTCDATETIME()),
        CreatedBy nvarchar(256) NOT NULL,
        CONSTRAINT PK_SecurityPermission PRIMARY KEY (PermissionId),
        CONSTRAINT UQ_SecurityPermission_Code UNIQUE (PermissionCode),
        CONSTRAINT CK_SecurityPermission_Code CHECK
            (LEN(PermissionCode) >= 3 AND PermissionCode=LOWER(PermissionCode) AND PermissionCode LIKE '%.%'),
        CONSTRAINT CK_SecurityPermission_Category CHECK (LEN(LTRIM(RTRIM(Category))) > 0)
    );
END;

IF OBJECT_ID(N'security.UserRole', N'U') IS NULL
BEGIN
    CREATE TABLE security.UserRole
    (
        UserRoleId uniqueidentifier NOT NULL,
        UserId uniqueidentifier NOT NULL,
        RoleId uniqueidentifier NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_UserRole_IsActive DEFAULT(1),
        AssignedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_UserRole_AssignedAtUtc DEFAULT(SYSUTCDATETIME()),
        AssignedByUserId uniqueidentifier NULL,
        AssignedByActor nvarchar(256) NOT NULL,
        RevokedAtUtc datetime2(3) NULL,
        RevokedByUserId uniqueidentifier NULL,
        RevokedByActor nvarchar(256) NULL,
        CONSTRAINT PK_UserRole PRIMARY KEY (UserRoleId),
        CONSTRAINT FK_UserRole_User FOREIGN KEY (UserId) REFERENCES security.[User](UserId),
        CONSTRAINT FK_UserRole_Role FOREIGN KEY (RoleId) REFERENCES security.[Role](RoleId),
        CONSTRAINT FK_UserRole_AssignedByUser FOREIGN KEY (AssignedByUserId) REFERENCES security.[User](UserId),
        CONSTRAINT FK_UserRole_RevokedByUser FOREIGN KEY (RevokedByUserId) REFERENCES security.[User](UserId),
        CONSTRAINT CK_UserRole_State CHECK
            ((IsActive=1 AND RevokedAtUtc IS NULL AND RevokedByUserId IS NULL AND RevokedByActor IS NULL) OR
             (IsActive=0 AND RevokedAtUtc IS NOT NULL AND RevokedByActor IS NOT NULL))
    );
    CREATE UNIQUE INDEX UX_UserRole_ActiveAssignment
        ON security.UserRole(UserId, RoleId) WHERE IsActive=1;
    CREATE INDEX IX_UserRole_Role ON security.UserRole(RoleId, IsActive);
END;

IF OBJECT_ID(N'security.RolePermission', N'U') IS NULL
BEGIN
    CREATE TABLE security.RolePermission
    (
        RolePermissionId uniqueidentifier NOT NULL,
        RoleId uniqueidentifier NOT NULL,
        PermissionId uniqueidentifier NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_RolePermission_IsActive DEFAULT(1),
        GrantedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_RolePermission_GrantedAtUtc DEFAULT(SYSUTCDATETIME()),
        GrantedByUserId uniqueidentifier NULL,
        GrantedByActor nvarchar(256) NOT NULL,
        RevokedAtUtc datetime2(3) NULL,
        RevokedByUserId uniqueidentifier NULL,
        RevokedByActor nvarchar(256) NULL,
        CONSTRAINT PK_RolePermission PRIMARY KEY (RolePermissionId),
        CONSTRAINT FK_RolePermission_Role FOREIGN KEY (RoleId) REFERENCES security.[Role](RoleId),
        CONSTRAINT FK_RolePermission_Permission FOREIGN KEY (PermissionId) REFERENCES security.Permission(PermissionId),
        CONSTRAINT FK_RolePermission_GrantedByUser FOREIGN KEY (GrantedByUserId) REFERENCES security.[User](UserId),
        CONSTRAINT FK_RolePermission_RevokedByUser FOREIGN KEY (RevokedByUserId) REFERENCES security.[User](UserId),
        CONSTRAINT CK_RolePermission_State CHECK
            ((IsActive=1 AND RevokedAtUtc IS NULL AND RevokedByUserId IS NULL AND RevokedByActor IS NULL) OR
             (IsActive=0 AND RevokedAtUtc IS NOT NULL AND RevokedByActor IS NOT NULL))
    );
    CREATE UNIQUE INDEX UX_RolePermission_ActiveGrant
        ON security.RolePermission(RoleId, PermissionId) WHERE IsActive=1;
    CREATE INDEX IX_RolePermission_Permission
        ON security.RolePermission(PermissionId, IsActive);
END;

IF OBJECT_ID(N'security.AuditEvent', N'U') IS NULL
BEGIN
    CREATE TABLE security.AuditEvent
    (
        AuditEventId uniqueidentifier NOT NULL,
        EventSequence bigint IDENTITY(1,1) NOT NULL,
        EventType varchar(80) NOT NULL,
        ActorUserId uniqueidentifier NULL,
        ActorIdentity nvarchar(256) NOT NULL,
        TargetType varchar(80) NOT NULL,
        TargetId uniqueidentifier NULL,
        TargetIdentity nvarchar(256) NULL,
        EventDataJson nvarchar(max) NULL,
        RecordedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_SecurityAuditEvent_RecordedAtUtc DEFAULT(SYSUTCDATETIME()),
        CONSTRAINT PK_SecurityAuditEvent PRIMARY KEY (AuditEventId),
        CONSTRAINT UQ_SecurityAuditEvent_Sequence UNIQUE (EventSequence),
        CONSTRAINT FK_SecurityAuditEvent_ActorUser FOREIGN KEY (ActorUserId) REFERENCES security.[User](UserId),
        CONSTRAINT CK_SecurityAuditEvent_DataJson CHECK (EventDataJson IS NULL OR ISJSON(EventDataJson)=1)
    );
    CREATE INDEX IX_SecurityAuditEvent_Target
        ON security.AuditEvent(TargetType, TargetId, EventSequence);
END;

COMMIT TRANSACTION;
GO

CREATE OR ALTER TRIGGER security.TR_SecurityAuditEvent_AppendOnly
ON security.AuditEvent INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 52020, 'Security audit events are append-only.', 1;
END;
GO

CREATE OR ALTER PROCEDURE security.usp_BootstrapMiguelSuperAdmin
AS
BEGIN
    SET XACT_ABORT ON;
    SET NOCOUNT ON;

    DECLARE @ExpectedWindowsIdentity nvarchar(256)=N'DLE-OS-HOST\Miguel';
    DECLARE @BootstrapActor nvarchar(256)=N'SYSTEM_BOOTSTRAP';
    DECLARE @UserId uniqueidentifier;
    DECLARE @RoleId uniqueidentifier;
    DECLARE @MappingUserId uniqueidentifier;

    IF SUSER_SNAME() <> @ExpectedWindowsIdentity
        THROW 52001, 'Miguel bootstrap requires the exact Miguel Windows SQL identity.', 1;

    BEGIN TRANSACTION;

    SELECT @RoleId=RoleId FROM security.[Role] WITH (UPDLOCK,HOLDLOCK)
    WHERE RoleCode='SUPER_ADMIN';
    IF @RoleId IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM security.[Role] WHERE RoleId=@RoleId AND IsSystemRole=1 AND IsSuperAdmin=1 AND IsActive=1)
        THROW 52002, 'The existing SUPER_ADMIN role contradicts the governed bootstrap definition.', 1;
    IF @RoleId IS NULL
    BEGIN
        SET @RoleId=NEWID();
        INSERT security.[Role]
            (RoleId,RoleCode,DisplayName,Description,IsSystemRole,IsSuperAdmin,IsActive,CreatedBy)
        VALUES
            (@RoleId,'SUPER_ADMIN',N'Super Administrator',
             N'Unrestricted DLE-OS application administrator.',1,1,1,@BootstrapActor);
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'ROLE_CREATED',@BootstrapActor,'ROLE',@RoleId,'SUPER_ADMIN',N'{"bootstrap":true}');
    END;

    SELECT @UserId=UserId FROM security.[User] WITH (UPDLOCK,HOLDLOCK)
    WHERE NormalizedUserName='MIGUEL';
    IF @UserId IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM security.[User] WHERE UserId=@UserId AND UserName=N'Miguel'
         AND DisplayName=N'Miguel De Leon' AND AccountStatus='ACTIVE' AND IsSystemAccount=0)
        THROW 52003, 'The existing Miguel user contradicts the governed bootstrap definition.', 1;
    IF @UserId IS NULL
    BEGIN
        SET @UserId=NEWID();
        INSERT security.[User]
            (UserId,UserName,DisplayName,AccountStatus,IsSystemAccount,CreatedBy)
        VALUES
            (@UserId,N'Miguel',N'Miguel De Leon','ACTIVE',0,@BootstrapActor);
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'USER_CREATED',@BootstrapActor,'USER',@UserId,N'Miguel',N'{"bootstrap":true}');
    END;

    SELECT @MappingUserId=UserId FROM security.ExternalIdentity WITH (UPDLOCK,HOLDLOCK)
    WHERE Provider='WINDOWS' AND NormalizedSubject=UPPER(@ExpectedWindowsIdentity);
    IF @MappingUserId IS NOT NULL AND @MappingUserId<>@UserId
        THROW 52004, 'The Miguel Windows identity is already mapped to another DLE-OS user.', 1;
    IF @MappingUserId IS NULL
    BEGIN
        INSERT security.ExternalIdentity
            (ExternalIdentityId,UserId,Provider,Subject,IsActive,CreatedBy)
        VALUES
            (NEWID(),@UserId,'WINDOWS',@ExpectedWindowsIdentity,1,@BootstrapActor);
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'EXTERNAL_IDENTITY_MAPPED',@BootstrapActor,'USER',@UserId,
             @ExpectedWindowsIdentity,N'{"provider":"WINDOWS","bootstrap":true}');
    END;

    IF EXISTS
    (
        SELECT 1 FROM security.UserRole ur
        JOIN security.[Role] r ON r.RoleId=ur.RoleId
        WHERE r.IsSuperAdmin=1 AND r.IsActive=1 AND ur.IsActive=1 AND ur.UserId<>@UserId
    )
        THROW 52005, 'A different active SUPER_ADMIN already exists; bootstrap is closed.', 1;

    IF NOT EXISTS
        (SELECT 1 FROM security.UserRole WHERE UserId=@UserId AND RoleId=@RoleId AND IsActive=1)
    BEGIN
        INSERT security.UserRole
            (UserRoleId,UserId,RoleId,IsActive,AssignedByActor)
        VALUES
            (NEWID(),@UserId,@RoleId,1,@BootstrapActor);
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'ROLE_ASSIGNED',@BootstrapActor,'USER',@UserId,N'Miguel',
             N'{"role":"SUPER_ADMIN","bootstrap":true}');
    END;
    ELSE
    BEGIN
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'BOOTSTRAP_REPLAY_VERIFIED',@BootstrapActor,'USER',@UserId,N'Miguel',
             N'{"role":"SUPER_ADMIN","idempotent":true}');
    END;

    DECLARE @CreatedPermissions TABLE
    (
        PermissionId uniqueidentifier NOT NULL,
        PermissionCode varchar(160) NOT NULL
    );

    MERGE security.Permission AS target
    USING (VALUES
        ('system.manage',N'Manage system',N'Administer governed DLE-OS system settings.','system'),
        ('users.manage',N'Manage users',N'Administer DLE-OS application users.','security'),
        ('roles.manage',N'Manage roles',N'Administer DLE-OS roles and grants.','security'),
        ('security.view',N'View security',N'View governed security state.','security')
    ) AS source(PermissionCode,DisplayName,Description,Category)
    ON target.PermissionCode=source.PermissionCode
    WHEN NOT MATCHED THEN INSERT
        (PermissionId,PermissionCode,DisplayName,Description,Category,IsActive,CreatedBy)
        VALUES (NEWID(),source.PermissionCode,source.DisplayName,source.Description,source.Category,1,@BootstrapActor)
    OUTPUT inserted.PermissionId,inserted.PermissionCode
        INTO @CreatedPermissions(PermissionId,PermissionCode);

    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'PERMISSION_CREATED',@BootstrapActor,'PERMISSION',PermissionId,PermissionCode,
           N'{"bootstrap":true}'
    FROM @CreatedPermissions;

    COMMIT TRANSACTION;

    SELECT @UserId AS UserId,@RoleId AS RoleId,@ExpectedWindowsIdentity AS ExternalIdentity,
           CAST(1 AS bit) AS IsSuperAdmin;
END;
GO

CREATE OR ALTER TRIGGER security.TR_SecurityUser_StatusAudit
ON security.[User] AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN deleted d ON d.UserId=i.UserId
        WHERE i.AccountStatus<>d.AccountStatus
          AND (i.ModifiedAtUtc IS NULL OR i.ModifiedByActor IS NULL)
    )
        THROW 52021, 'User status changes require modification actor and timestamp.', 1;

    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'USER_STATUS_CHANGED',i.ModifiedByUserId,i.ModifiedByActor,'USER',i.UserId,i.UserName,
           CONCAT(N'{"from":"',d.AccountStatus,N'","to":"',i.AccountStatus,N'"}')
    FROM inserted i JOIN deleted d ON d.UserId=i.UserId
    WHERE i.AccountStatus<>d.AccountStatus;
END;
GO

CREATE OR ALTER TRIGGER security.TR_ExternalIdentity_DeactivationAudit
ON security.ExternalIdentity AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'EXTERNAL_IDENTITY_DEACTIVATED',i.DeactivatedByUserId,i.DeactivatedByActor,
           'EXTERNAL_IDENTITY',i.ExternalIdentityId,i.Subject,
           CONCAT(N'{"provider":"',i.Provider,N'"}')
    FROM inserted i JOIN deleted d ON d.ExternalIdentityId=i.ExternalIdentityId
    WHERE d.IsActive=1 AND i.IsActive=0;
END;
GO

CREATE OR ALTER TRIGGER security.TR_UserRole_RevocationAudit
ON security.UserRole AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'ROLE_REVOKED',i.RevokedByUserId,i.RevokedByActor,'USER_ROLE',i.UserRoleId,NULL,
           CONCAT(N'{"userId":"',CONVERT(nvarchar(36),i.UserId),N'","roleId":"',
                  CONVERT(nvarchar(36),i.RoleId),N'"}')
    FROM inserted i JOIN deleted d ON d.UserRoleId=i.UserRoleId
    WHERE d.IsActive=1 AND i.IsActive=0;
END;
GO

CREATE OR ALTER TRIGGER security.TR_RolePermission_RevocationAudit
ON security.RolePermission AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'PERMISSION_REVOKED',i.RevokedByUserId,i.RevokedByActor,
           'ROLE_PERMISSION',i.RolePermissionId,NULL,
           CONCAT(N'{"roleId":"',CONVERT(nvarchar(36),i.RoleId),N'","permissionId":"',
                  CONVERT(nvarchar(36),i.PermissionId),N'"}')
    FROM inserted i JOIN deleted d ON d.RolePermissionId=i.RolePermissionId
    WHERE d.IsActive=1 AND i.IsActive=0;
END;
GO
