SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'DLE_OS_SECURITY_DEV'
    THROW 52600, 'User lifecycle migration requires DLE_OS_SECURITY_DEV.', 1;
GO

CREATE OR ALTER PROCEDURE security.usp_PrepareEmployeeUserProvisioning
    @EmployeeId uniqueidentifier,
    @UserName nvarchar(100),
    @KeycloakSubject nvarchar(256),
    @RoleCodesJson nvarchar(max),
    @ActorUserId uniqueidentifier,
    @ActorIdentity nvarchar(256),
    @CorrelationId uniqueidentifier,
    @UserId uniqueidentifier OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @UserName=LTRIM(RTRIM(@UserName));
    SET @KeycloakSubject=LTRIM(RTRIM(@KeycloakSubject));
    IF LEN(@UserName)<3 OR LEN(@UserName)>100 OR @UserName LIKE N'%[^a-zA-Z0-9._-]%'
        THROW 52601, 'Username must be 3-100 letters, numbers, periods, underscores, or hyphens.', 1;
    IF LEN(@KeycloakSubject)=0 OR ISJSON(@RoleCodesJson)<>1
        THROW 52602, 'Provisioning identity or role contract is invalid.', 1;
    IF NOT EXISTS (SELECT 1 FROM OPENJSON(@RoleCodesJson))
        THROW 52603, 'At least one active role is required.', 1;
    IF EXISTS (SELECT value FROM OPENJSON(@RoleCodesJson) GROUP BY value HAVING COUNT(*)>1)
        THROW 52604, 'Duplicate role codes are not allowed.', 1;

    BEGIN TRANSACTION;
    IF NOT EXISTS
    (
        SELECT 1 FROM security.[User] u
        JOIN security.UserRole ur ON ur.UserId=u.UserId AND ur.IsActive=1
        JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsActive=1 AND r.IsSuperAdmin=1
        WHERE u.UserId=@ActorUserId AND u.AccountStatus='ACTIVE'
    ) THROW 52605, 'An active SUPER_ADMIN actor is required.', 1;
    DECLARE @ActorEmployeeNumber char(4)=(SELECT TOP (1) e.EmployeeNumber FROM security.UserEmployeeLink l JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE l.UserId=@ActorUserId AND l.IsActive=1);

    DECLARE @EmployeeNumber char(4),@DisplayName nvarchar(200),@ProvisioningStatus varchar(32);
    SELECT @EmployeeNumber=EmployeeNumber,@DisplayName=DisplayName,@ProvisioningStatus=ProvisioningStatus
    FROM hr.Employee WITH (UPDLOCK,HOLDLOCK)
    WHERE EmployeeId=@EmployeeId AND SourceEmploymentStatus='ACTIVE'
      AND DleWorkforceStatus='CURRENT' AND MissingFromSource=0;
    IF @EmployeeNumber IS NULL THROW 52606, 'Employee is not eligible for DLE-OS access.', 1;

    IF EXISTS
    (
        SELECT 1 FROM OPENJSON(@RoleCodesJson) requested
        LEFT JOIN security.[Role] r ON r.RoleCode=UPPER(CONVERT(varchar(100),requested.value)) AND r.IsActive=1
        WHERE r.RoleId IS NULL
    ) THROW 52607, 'One or more requested roles are invalid or inactive.', 1;

    DECLARE @LinkedUserId uniqueidentifier;
    SELECT @LinkedUserId=UserId FROM security.UserEmployeeLink WITH (UPDLOCK,HOLDLOCK)
    WHERE EmployeeId=@EmployeeId AND IsActive=1;
    IF @LinkedUserId IS NOT NULL
    BEGIN
        SELECT @UserId=UserId FROM security.[User] WITH (UPDLOCK,HOLDLOCK)
        WHERE UserId=@LinkedUserId AND NormalizedUserName=UPPER(@UserName) AND AccountStatus='PENDING';
        IF @UserId IS NULL THROW 52608, 'Employee already has a different or non-pending DLE-OS user.', 1;
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM security.[User] WITH (UPDLOCK,HOLDLOCK) WHERE NormalizedUserName=UPPER(@UserName))
            THROW 52609, 'Username already exists.', 1;
        SET @UserId=NEWID();
        INSERT security.[User](UserId,UserName,DisplayName,AccountStatus,IsSystemAccount,CreatedBy)
        VALUES(@UserId,@UserName,@DisplayName,'PENDING',0,@ActorIdentity);
        INSERT security.UserEmployeeLink
            (UserEmployeeLinkId,UserId,EmployeeId,IsActive,LinkEvidenceCode,LinkedByUserId)
        VALUES(NEWID(),@UserId,@EmployeeId,1,'SUPER_ADMIN_PROVISIONING',@ActorUserId);
    END;

    IF EXISTS
    (
        SELECT 1 FROM security.ExternalIdentity WITH (UPDLOCK,HOLDLOCK)
        WHERE Provider='KEYCLOAK' AND NormalizedSubject=UPPER(@KeycloakSubject) AND UserId<>@UserId
    ) THROW 52610, 'Keycloak subject is already mapped to another user.', 1;
    IF EXISTS
    (
        SELECT 1 FROM security.ExternalIdentity WITH (UPDLOCK,HOLDLOCK)
        WHERE UserId=@UserId AND Provider='KEYCLOAK' AND IsActive=1
          AND NormalizedSubject<>UPPER(@KeycloakSubject)
    ) THROW 52611, 'The pending user already has a different active Keycloak subject.', 1;
    IF NOT EXISTS
        (SELECT 1 FROM security.ExternalIdentity WHERE UserId=@UserId AND Provider='KEYCLOAK' AND IsActive=1)
        INSERT security.ExternalIdentity
            (ExternalIdentityId,UserId,Provider,Subject,IsActive,CreatedBy)
        VALUES(NEWID(),@UserId,'KEYCLOAK',@KeycloakSubject,1,@ActorIdentity);

    DECLARE @RoleId uniqueidentifier,@RoleCode varchar(100);
    DECLARE roles CURSOR LOCAL FAST_FORWARD FOR
        SELECT r.RoleId,r.RoleCode FROM security.[Role] r
        JOIN OPENJSON(@RoleCodesJson) j ON r.RoleCode=UPPER(CONVERT(varchar(100),j.value))
        WHERE r.IsActive=1;
    OPEN roles; FETCH NEXT FROM roles INTO @RoleId,@RoleCode;
    WHILE @@FETCH_STATUS=0
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM security.UserRole WHERE UserId=@UserId AND RoleId=@RoleId AND IsActive=1)
        BEGIN
            INSERT security.UserRole(UserRoleId,UserId,RoleId,IsActive,AssignedByUserId,AssignedByActor)
            VALUES(NEWID(),@UserId,@RoleId,1,@ActorUserId,@ActorIdentity);
            INSERT security.AuditEvent
                (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
            VALUES(NEWID(),'ROLE_ASSIGNED',@ActorUserId,@ActorIdentity,'USER',@UserId,@UserName,
                JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'employeeNumber':@EmployeeNumber,'role':@RoleCode,'correlationId':CONVERT(varchar(36),@CorrelationId)));
        END;
        ELSE
            INSERT security.AuditEvent
                (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
            VALUES(NEWID(),'ROLE_ASSIGNED',@ActorUserId,@ActorIdentity,'USER',@UserId,@UserName,
                JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'employeeNumber':@EmployeeNumber,'role':@RoleCode,'existingAssignmentConfirmed':CAST(1 AS bit),'correlationId':CONVERT(varchar(36),@CorrelationId)));
        FETCH NEXT FROM roles INTO @RoleId,@RoleCode;
    END;
    CLOSE roles; DEALLOCATE roles;

    UPDATE hr.Employee SET ProvisioningStatus='PROVISIONED_PENDING_AUTH',ProposedUserName=@UserName,
        UpdatedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@EmployeeId;
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    VALUES(NEWID(),'USER_PROVISIONED',@ActorUserId,@ActorIdentity,'USER',@UserId,@UserName,
        JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'employeeNumber':@EmployeeNumber,'status':'PENDING','correlationId':CONVERT(varchar(36),@CorrelationId)));
    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE security.usp_AbortEmployeeUserProvisioning
    @UserId uniqueidentifier,@KeycloakSubject nvarchar(256),@ActorUserId uniqueidentifier,
    @ActorIdentity nvarchar(256),@CorrelationId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
    IF NOT EXISTS (SELECT 1 FROM security.[User] u JOIN security.UserRole ur ON ur.UserId=u.UserId AND ur.IsActive=1
        JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsSuperAdmin=1 AND r.IsActive=1
        WHERE u.UserId=@ActorUserId AND u.AccountStatus='ACTIVE') THROW 52615, 'An active SUPER_ADMIN actor is required.', 1;
    DECLARE @ActorEmployeeNumber char(4)=(SELECT TOP (1) e.EmployeeNumber FROM security.UserEmployeeLink l JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE l.UserId=@ActorUserId AND l.IsActive=1);
    UPDATE security.ExternalIdentity SET IsActive=0,DeactivatedAtUtc=SYSUTCDATETIME(),
        DeactivatedByUserId=@ActorUserId,DeactivatedByActor=@ActorIdentity
    WHERE UserId=@UserId AND Provider='KEYCLOAK' AND NormalizedSubject=UPPER(LTRIM(RTRIM(@KeycloakSubject))) AND IsActive=1;
    IF @@ROWCOUNT<>1 THROW 52616, 'The prepared Keycloak subject could not be deactivated.', 1;
    UPDATE security.[User] SET AccountStatus='PENDING',ModifiedAtUtc=SYSUTCDATETIME(),
        ModifiedByUserId=@ActorUserId,ModifiedByActor=@ActorIdentity WHERE UserId=@UserId;
    UPDATE e SET ProvisioningStatus='PROVISIONED_PENDING_AUTH',UpdatedAtUtc=SYSUTCDATETIME()
    FROM hr.Employee e JOIN security.UserEmployeeLink l ON l.EmployeeId=e.EmployeeId AND l.UserId=@UserId AND l.IsActive=1;
    INSERT security.AuditEvent(AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'USER_PROVISIONING_ABORTED',@ActorUserId,@ActorIdentity,'USER',u.UserId,u.UserName,
        JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'employeeNumber':e.EmployeeNumber,'status':'PENDING','correlationId':CONVERT(varchar(36),@CorrelationId))
    FROM security.[User] u JOIN security.UserEmployeeLink l ON l.UserId=u.UserId AND l.IsActive=1 JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE u.UserId=@UserId;
    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE security.usp_ActivateProvisionedUser
    @UserId uniqueidentifier,@ActorUserId uniqueidentifier,@ActorIdentity nvarchar(256),@CorrelationId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
    IF NOT EXISTS (SELECT 1 FROM security.[User] u JOIN security.UserRole ur ON ur.UserId=u.UserId AND ur.IsActive=1
        JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsSuperAdmin=1 AND r.IsActive=1
        WHERE u.UserId=@ActorUserId AND u.AccountStatus='ACTIVE') THROW 52620, 'An active SUPER_ADMIN actor is required.', 1;
    DECLARE @ActorEmployeeNumber char(4)=(SELECT TOP (1) e.EmployeeNumber FROM security.UserEmployeeLink l JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE l.UserId=@ActorUserId AND l.IsActive=1);
    IF NOT EXISTS (SELECT 1 FROM security.[User] WHERE UserId=@UserId AND AccountStatus='PENDING')
        THROW 52621, 'Only a pending provisioned user can be activated.', 1;
    IF NOT EXISTS (SELECT 1 FROM security.ExternalIdentity WHERE UserId=@UserId AND Provider='KEYCLOAK' AND IsActive=1)
        THROW 52622, 'An active Keycloak identity is required.', 1;
    UPDATE security.[User] SET AccountStatus='ACTIVE',ModifiedAtUtc=SYSUTCDATETIME(),ModifiedByUserId=@ActorUserId,ModifiedByActor=@ActorIdentity WHERE UserId=@UserId;
    UPDATE e SET ProvisioningStatus='ACTIVE',UpdatedAtUtc=SYSUTCDATETIME()
    FROM hr.Employee e JOIN security.UserEmployeeLink l ON l.EmployeeId=e.EmployeeId AND l.UserId=@UserId AND l.IsActive=1;
    INSERT security.AuditEvent(AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'USER_ACTIVATED',@ActorUserId,@ActorIdentity,'USER',u.UserId,u.UserName,
        JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'employeeNumber':e.EmployeeNumber,'status':'ACTIVE','correlationId':CONVERT(varchar(36),@CorrelationId))
    FROM security.[User] u JOIN security.UserEmployeeLink l ON l.UserId=u.UserId AND l.IsActive=1 JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE u.UserId=@UserId;
    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE security.usp_SetUserEnabledState
    @UserId uniqueidentifier,@Enable bit,@ActorUserId uniqueidentifier,@ActorIdentity nvarchar(256),@CorrelationId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION;
    IF @UserId=@ActorUserId THROW 52630, 'A SUPER_ADMIN cannot change their own enabled state.', 1;
    IF NOT EXISTS (SELECT 1 FROM security.[User] u JOIN security.UserRole ur ON ur.UserId=u.UserId AND ur.IsActive=1
        JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsSuperAdmin=1 AND r.IsActive=1
        WHERE u.UserId=@ActorUserId AND u.AccountStatus='ACTIVE') THROW 52631, 'An active SUPER_ADMIN actor is required.', 1;
    DECLARE @ActorEmployeeNumber char(4)=(SELECT TOP (1) e.EmployeeNumber FROM security.UserEmployeeLink l JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE l.UserId=@ActorUserId AND l.IsActive=1);
    DECLARE @Before varchar(16),@UserName nvarchar(100),@EmployeeNumber char(4);
    SELECT @Before=u.AccountStatus,@UserName=u.UserName,@EmployeeNumber=e.EmployeeNumber
    FROM security.[User] u JOIN security.UserEmployeeLink l ON l.UserId=u.UserId AND l.IsActive=1
    JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE u.UserId=@UserId;
    IF (@Enable=1 AND @Before<>'DISABLED') OR (@Enable=0 AND @Before<>'ACTIVE') THROW 52632, 'User state transition is invalid.', 1;
    UPDATE security.[User] SET AccountStatus=CASE WHEN @Enable=1 THEN 'ACTIVE' ELSE 'DISABLED' END,
        ModifiedAtUtc=SYSUTCDATETIME(),ModifiedByUserId=@ActorUserId,ModifiedByActor=@ActorIdentity WHERE UserId=@UserId;
    UPDATE e SET ProvisioningStatus=CASE WHEN @Enable=1 THEN 'ACTIVE' ELSE 'DISABLED' END,UpdatedAtUtc=SYSUTCDATETIME()
    FROM hr.Employee e JOIN security.UserEmployeeLink l ON l.EmployeeId=e.EmployeeId AND l.UserId=@UserId AND l.IsActive=1;
    INSERT security.AuditEvent(AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    VALUES(NEWID(),CASE WHEN @Enable=1 THEN 'USER_REENABLED' ELSE 'USER_DISABLED' END,@ActorUserId,@ActorIdentity,'USER',@UserId,@UserName,
        JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'employeeNumber':@EmployeeNumber,'before':@Before,'after':CASE WHEN @Enable=1 THEN 'ACTIVE' ELSE 'DISABLED' END,'correlationId':CONVERT(varchar(36),@CorrelationId)));
    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE security.usp_RecordUserSecurityAction
    @UserId uniqueidentifier,@EventType varchar(80),@ActorUserId uniqueidentifier,@ActorIdentity nvarchar(256),@CorrelationId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    IF @EventType NOT IN ('CREDENTIAL_RESET','SESSIONS_REVOKED') THROW 52640, 'Security action event type is invalid.', 1;
    IF NOT EXISTS (SELECT 1 FROM security.[User] u JOIN security.UserRole ur ON ur.UserId=u.UserId AND ur.IsActive=1
        JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsSuperAdmin=1 AND r.IsActive=1
        WHERE u.UserId=@ActorUserId AND u.AccountStatus='ACTIVE') THROW 52641, 'An active SUPER_ADMIN actor is required.', 1;
    DECLARE @ActorEmployeeNumber char(4)=(SELECT TOP (1) e.EmployeeNumber FROM security.UserEmployeeLink l JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE l.UserId=@ActorUserId AND l.IsActive=1);
    INSERT security.AuditEvent(AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),@EventType,@ActorUserId,@ActorIdentity,'USER',u.UserId,u.UserName,
        JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'employeeNumber':e.EmployeeNumber,'correlationId':CONVERT(varchar(36),@CorrelationId))
    FROM security.[User] u JOIN security.UserEmployeeLink l ON l.UserId=u.UserId AND l.IsActive=1 JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE u.UserId=@UserId;
    IF @@ROWCOUNT<>1 THROW 52642, 'Target user is not linked to an employee.', 1;
END;
GO

CREATE OR ALTER PROCEDURE security.usp_SetUserRoles
    @UserId uniqueidentifier,@RoleCodesJson nvarchar(max),@ActorUserId uniqueidentifier,
    @ActorIdentity nvarchar(256),@CorrelationId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @UserId=@ActorUserId THROW 52650, 'A SUPER_ADMIN cannot change their own roles.', 1;
    IF ISJSON(@RoleCodesJson)<>1 OR NOT EXISTS (SELECT 1 FROM OPENJSON(@RoleCodesJson))
        THROW 52651, 'At least one role is required.', 1;
    BEGIN TRANSACTION;
    IF NOT EXISTS (SELECT 1 FROM security.[User] u JOIN security.UserRole ur ON ur.UserId=u.UserId AND ur.IsActive=1
        JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsSuperAdmin=1 AND r.IsActive=1
        WHERE u.UserId=@ActorUserId AND u.AccountStatus='ACTIVE') THROW 52652, 'An active SUPER_ADMIN actor is required.', 1;
    DECLARE @ActorEmployeeNumber char(4)=(SELECT TOP (1) e.EmployeeNumber FROM security.UserEmployeeLink l JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId WHERE l.UserId=@ActorUserId AND l.IsActive=1);
    IF NOT EXISTS (SELECT 1 FROM security.[User] WHERE UserId=@UserId) THROW 52653, 'Target user does not exist.', 1;
    IF EXISTS (SELECT 1 FROM OPENJSON(@RoleCodesJson) j LEFT JOIN security.[Role] r
        ON r.RoleCode=UPPER(CONVERT(varchar(100),j.value)) AND r.IsActive=1 WHERE r.RoleId IS NULL)
        THROW 52654, 'One or more requested roles are invalid or inactive.', 1;

    DECLARE @Removed TABLE(UserId uniqueidentifier NOT NULL,RoleId uniqueidentifier NOT NULL);
    UPDATE ur SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@ActorUserId,RevokedByActor=@ActorIdentity
    OUTPUT inserted.UserId,inserted.RoleId INTO @Removed(UserId,RoleId)
    FROM security.UserRole ur JOIN security.[Role] r ON r.RoleId=ur.RoleId
    WHERE ur.UserId=@UserId AND ur.IsActive=1 AND NOT EXISTS
        (SELECT 1 FROM OPENJSON(@RoleCodesJson) j WHERE UPPER(CONVERT(varchar(100),j.value))=r.RoleCode);
    INSERT security.AuditEvent(AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'ROLE_REMOVED',@ActorUserId,@ActorIdentity,'USER',removed.UserId,u.UserName,
        JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'role':r.RoleCode,'correlationId':CONVERT(varchar(36),@CorrelationId))
    FROM @Removed removed JOIN security.[Role] r ON r.RoleId=removed.RoleId JOIN security.[User] u ON u.UserId=removed.UserId;

    DECLARE @Added TABLE(UserId uniqueidentifier NOT NULL,RoleId uniqueidentifier NOT NULL);
    INSERT security.UserRole(UserRoleId,UserId,RoleId,IsActive,AssignedByUserId,AssignedByActor)
    OUTPUT inserted.UserId,inserted.RoleId INTO @Added(UserId,RoleId)
    SELECT NEWID(),@UserId,r.RoleId,1,@ActorUserId,@ActorIdentity FROM security.[Role] r
    JOIN OPENJSON(@RoleCodesJson) j ON r.RoleCode=UPPER(CONVERT(varchar(100),j.value))
    WHERE r.IsActive=1 AND NOT EXISTS
        (SELECT 1 FROM security.UserRole ur WHERE ur.UserId=@UserId AND ur.RoleId=r.RoleId AND ur.IsActive=1);
    INSERT security.AuditEvent(AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    SELECT NEWID(),'ROLE_ASSIGNED',@ActorUserId,@ActorIdentity,'USER',added.UserId,u.UserName,
        JSON_OBJECT('actorEmployeeNumber':@ActorEmployeeNumber,'role':r.RoleCode,'correlationId':CONVERT(varchar(36),@CorrelationId))
    FROM @Added added JOIN security.[Role] r ON r.RoleId=added.RoleId JOIN security.[User] u ON u.UserId=added.UserId;
    COMMIT;
END;
GO

CREATE OR ALTER PROCEDURE security.usp_GetEmployeeUserAdministration
    @EmployeeId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT e.EmployeeId,e.EmployeeNumber,e.DisplayName,e.ProposedUserName,e.ProvisioningStatus,
           u.UserId,u.UserName,u.AccountStatus,ei.Subject AS KeycloakSubject
    FROM hr.Employee e LEFT JOIN security.UserEmployeeLink l ON l.EmployeeId=e.EmployeeId AND l.IsActive=1
    LEFT JOIN security.[User] u ON u.UserId=l.UserId
    LEFT JOIN security.ExternalIdentity ei ON ei.UserId=u.UserId AND ei.Provider='KEYCLOAK' AND ei.IsActive=1
    WHERE e.EmployeeId=@EmployeeId;
    SELECT r.RoleCode,r.DisplayName,r.Description,r.IsSuperAdmin,
           STRING_AGG(CONVERT(nvarchar(max),p.PermissionCode),N',') WITHIN GROUP (ORDER BY p.PermissionCode) AS Permissions
    FROM security.[Role] r LEFT JOIN security.RolePermission rp ON rp.RoleId=r.RoleId AND rp.IsActive=1
    LEFT JOIN security.Permission p ON p.PermissionId=rp.PermissionId AND p.IsActive=1
    WHERE r.IsActive=1 GROUP BY r.RoleCode,r.DisplayName,r.Description,r.IsSuperAdmin ORDER BY r.IsSuperAdmin,r.RoleCode;
    SELECT r.RoleCode FROM security.UserEmployeeLink l JOIN security.UserRole ur ON ur.UserId=l.UserId AND ur.IsActive=1
    JOIN security.[Role] r ON r.RoleId=ur.RoleId AND r.IsActive=1 WHERE l.EmployeeId=@EmployeeId AND l.IsActive=1 ORDER BY r.RoleCode;
    SELECT TOP (100) a.EventType,a.ActorIdentity,a.EventDataJson,a.RecordedAtUtc
    FROM security.UserEmployeeLink l JOIN security.AuditEvent a ON a.TargetId=l.UserId AND a.TargetType='USER'
    WHERE l.EmployeeId=@EmployeeId AND l.IsActive=1 ORDER BY a.EventSequence DESC;
END;
GO
