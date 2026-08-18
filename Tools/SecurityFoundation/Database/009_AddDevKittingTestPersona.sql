SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'DLE_OS_SECURITY_DEV'
    THROW 52600, 'DEV test personas require DLE_OS_SECURITY_DEV.', 1;
GO

CREATE OR ALTER PROCEDURE security.usp_ProvisionDevKittingTestPersona
    @KeycloakSubject nvarchar(256)
AS
BEGIN
    SET XACT_ABORT ON;
    SET NOCOUNT ON;

    IF DB_NAME() <> N'DLE_OS_SECURITY_DEV'
        THROW 52601, 'DEV test personas require DLE_OS_SECURITY_DEV.', 1;

    DECLARE @Actor nvarchar(256)=N'DEV_TEST_IDENTITY_PROVISIONER';
    DECLARE @UserId uniqueidentifier='90000000-0000-4000-8000-000000000001';
    DECLARE @RoleId uniqueidentifier='90000000-0000-4000-8000-000000000002';
    DECLARE @UserRoleId uniqueidentifier='90000000-0000-4000-8000-000000000003';
    DECLARE @ExternalIdentityId uniqueidentifier='90000000-0000-4000-8000-000000000004';
    DECLARE @Subject nvarchar(256)=LTRIM(RTRIM(@KeycloakSubject));

    IF LEN(@Subject)=0 THROW 52602, 'The dev.kitting Keycloak subject is required.', 1;

    BEGIN TRANSACTION;

    IF EXISTS
    (
        SELECT 1 FROM security.[Role]
        WHERE RoleCode='DEV_KITTING_OPERATOR' AND
              (RoleId<>@RoleId OR DisplayName<>N'DEV Kitting Operator' OR
               IsSystemRole<>1 OR IsSuperAdmin<>0 OR IsActive<>1)
    ) THROW 52603, 'DEV_KITTING_OPERATOR has a contradictory definition.', 1;

    IF NOT EXISTS (SELECT 1 FROM security.[Role] WHERE RoleId=@RoleId)
    BEGIN
        INSERT security.[Role]
            (RoleId,RoleCode,DisplayName,Description,IsSystemRole,IsSuperAdmin,IsActive,CreatedBy)
        VALUES
            (@RoleId,'DEV_KITTING_OPERATOR',N'DEV Kitting Operator',
             N'Synthetic DEV-only floor operator for normal Kitting workflow qualification.',1,0,1,@Actor);
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'ROLE_CREATED',@Actor,'ROLE',@RoleId,'DEV_KITTING_OPERATOR',
             N'{"environment":"DEVELOPMENT","persona":"dev.kitting","synthetic":true}');
    END;

    DECLARE @DesiredPermissions TABLE
    (
        PermissionCode varchar(160) NOT NULL PRIMARY KEY,
        RolePermissionId uniqueidentifier NOT NULL
    );
    INSERT @DesiredPermissions(PermissionCode,RolePermissionId) VALUES
        ('kitting.view','90000000-0000-4000-8000-000000000010'),
        ('kitting.disposition','90000000-0000-4000-8000-000000000011'),
        ('work_orders.view','90000000-0000-4000-8000-000000000012'),
        ('pick_list.view','90000000-0000-4000-8000-000000000013'),
        ('rma_rework.view','90000000-0000-4000-8000-000000000014');

    IF EXISTS
    (
        SELECT 1 FROM @DesiredPermissions desired
        LEFT JOIN security.Permission permission
          ON permission.PermissionCode=desired.PermissionCode AND permission.IsActive=1
        WHERE permission.PermissionId IS NULL
    ) THROW 52604, 'A required DEV Kitting permission is absent or inactive.', 1;

    IF EXISTS
    (
        SELECT 1 FROM security.RolePermission grantRow
        JOIN security.Permission permission ON permission.PermissionId=grantRow.PermissionId
        WHERE grantRow.RoleId=@RoleId AND grantRow.IsActive=1 AND NOT EXISTS
          (SELECT 1 FROM @DesiredPermissions desired WHERE desired.PermissionCode=permission.PermissionCode)
    ) THROW 52605, 'DEV_KITTING_OPERATOR contains an unrelated active permission.', 1;

    DECLARE @CreatedGrants TABLE(RolePermissionId uniqueidentifier,PermissionId uniqueidentifier);
    INSERT security.RolePermission
        (RolePermissionId,RoleId,PermissionId,IsActive,GrantedByActor)
    OUTPUT inserted.RolePermissionId,inserted.PermissionId
      INTO @CreatedGrants(RolePermissionId,PermissionId)
    SELECT desired.RolePermissionId,@RoleId,permission.PermissionId,1,@Actor
    FROM @DesiredPermissions desired
    JOIN security.Permission permission ON permission.PermissionCode=desired.PermissionCode
    WHERE NOT EXISTS
    (
        SELECT 1 FROM security.RolePermission existing
        WHERE existing.RoleId=@RoleId AND existing.PermissionId=permission.PermissionId AND existing.IsActive=1
    );

    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'ROLE_PERMISSION_GRANTED',@Actor,'ROLE_PERMISSION',created.RolePermissionId,permission.PermissionCode,
           N'{"environment":"DEVELOPMENT","role":"DEV_KITTING_OPERATOR","synthetic":true}'
    FROM @CreatedGrants created
    JOIN security.Permission permission ON permission.PermissionId=created.PermissionId;

    IF EXISTS
    (
        SELECT 1 FROM security.[User]
        WHERE NormalizedUserName=N'DEV.KITTING' AND
              (UserId<>@UserId OR DisplayName<>N'Kitting Operator' OR
               AccountStatus<>'ACTIVE' OR IsSystemAccount<>0)
    ) THROW 52606, 'dev.kitting has a contradictory DLE-OS user definition.', 1;

    IF EXISTS
        (SELECT 1 FROM security.[User] WHERE UserId=@UserId AND NormalizedUserName<>N'DEV.KITTING')
        THROW 52607, 'The governed dev.kitting UserId is occupied.', 1;

    IF NOT EXISTS (SELECT 1 FROM security.[User] WHERE UserId=@UserId)
    BEGIN
        INSERT security.[User]
            (UserId,UserName,DisplayName,AccountStatus,IsSystemAccount,CreatedBy)
        VALUES
            (@UserId,N'dev.kitting',N'Kitting Operator','ACTIVE',0,@Actor);
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'USER_CREATED',@Actor,'USER',@UserId,N'dev.kitting',
             N'{"environment":"DEVELOPMENT","type":"DEV_TEST_PERSONA","employee":false}');
    END;

    IF EXISTS
    (
        SELECT 1 FROM security.UserRole assignment
        JOIN security.[Role] role ON role.RoleId=assignment.RoleId
        WHERE assignment.UserId=@UserId AND assignment.IsActive=1 AND role.RoleCode<>'DEV_KITTING_OPERATOR'
    ) THROW 52608, 'dev.kitting has an unrelated active role.', 1;

    IF NOT EXISTS
        (SELECT 1 FROM security.UserRole WHERE UserId=@UserId AND RoleId=@RoleId AND IsActive=1)
    BEGIN
        INSERT security.UserRole
            (UserRoleId,UserId,RoleId,IsActive,AssignedByActor)
        VALUES
            (@UserRoleId,@UserId,@RoleId,1,@Actor);
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'USER_ROLE_ASSIGNED',@Actor,'USER_ROLE',@UserRoleId,
             N'dev.kitting:DEV_KITTING_OPERATOR',
             N'{"environment":"DEVELOPMENT","type":"DEV_TEST_PERSONA"}');
    END;

    IF EXISTS (SELECT 1 FROM security.UserEmployeeLink WHERE UserId=@UserId)
        THROW 52609, 'A DEV test persona must not be linked to an employee.', 1;

    IF EXISTS
    (
        SELECT 1 FROM security.ExternalIdentity
        WHERE Provider='KEYCLOAK' AND NormalizedSubject=UPPER(@Subject) AND UserId<>@UserId
    ) THROW 52610, 'The Keycloak subject is already mapped to another DLE-OS user.', 1;

    IF EXISTS
    (
        SELECT 1 FROM security.ExternalIdentity
        WHERE UserId=@UserId AND Provider='KEYCLOAK' AND
              (NormalizedSubject<>UPPER(@Subject) OR IsActive<>1)
    ) THROW 52611, 'dev.kitting has a contradictory Keycloak mapping.', 1;

    IF NOT EXISTS
    (
        SELECT 1 FROM security.ExternalIdentity
        WHERE UserId=@UserId AND Provider='KEYCLOAK' AND NormalizedSubject=UPPER(@Subject) AND IsActive=1
    )
    BEGIN
        INSERT security.ExternalIdentity
            (ExternalIdentityId,UserId,Provider,Subject,IsActive,CreatedBy)
        VALUES
            (@ExternalIdentityId,@UserId,'KEYCLOAK',@Subject,1,@Actor);
        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'EXTERNAL_IDENTITY_LINKED',@Actor,'EXTERNAL_IDENTITY',@ExternalIdentityId,
             N'dev.kitting:KEYCLOAK',
             N'{"environment":"DEVELOPMENT","purpose":"DEV_TEST_PERSONA_OIDC_SUB"}');
    END;

    IF EXISTS
    (
        SELECT 1 FROM security.UserRole assignment
        JOIN security.[Role] role ON role.RoleId=assignment.RoleId
        WHERE assignment.UserId=@UserId AND assignment.IsActive=1 AND role.IsSuperAdmin=1
    ) THROW 52612, 'dev.kitting must not receive SUPER_ADMIN.', 1;

    COMMIT TRANSACTION;
END;
GO
