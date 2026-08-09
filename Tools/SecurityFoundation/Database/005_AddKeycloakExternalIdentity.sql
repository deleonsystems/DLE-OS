SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRANSACTION;

IF OBJECT_ID(N'security.ExternalIdentity', N'U') IS NULL
    THROW 52400, 'The security.ExternalIdentity foundation is absent.', 1;

IF EXISTS
(
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'security.ExternalIdentity')
      AND name=N'CK_ExternalIdentity_Provider'
)
    ALTER TABLE security.ExternalIdentity DROP CONSTRAINT CK_ExternalIdentity_Provider;

ALTER TABLE security.ExternalIdentity WITH CHECK ADD CONSTRAINT CK_ExternalIdentity_Provider
    CHECK (Provider IN ('WINDOWS','KEYCLOAK'));
ALTER TABLE security.ExternalIdentity CHECK CONSTRAINT CK_ExternalIdentity_Provider;

COMMIT TRANSACTION;
GO

CREATE OR ALTER PROCEDURE security.usp_LinkMiguelKeycloakIdentity
    @Subject nvarchar(256),
    @Actor nvarchar(256)
AS
BEGIN
    SET XACT_ABORT ON;
    SET NOCOUNT ON;

    DECLARE @MiguelUserId uniqueidentifier='7cceaf7a-191a-452a-95ff-f9ab636ec5c4';
    DECLARE @NormalizedSubject nvarchar(256)=UPPER(LTRIM(RTRIM(@Subject)));
    DECLARE @ExternalIdentityId uniqueidentifier;

    IF LEN(@NormalizedSubject)=0
        THROW 52401, 'The Keycloak subject is required.', 1;
    IF LEN(LTRIM(RTRIM(@Actor)))=0
        THROW 52402, 'The provisioning actor is required.', 1;

    BEGIN TRANSACTION;

    IF NOT EXISTS
    (
        SELECT 1
        FROM security.[User] AS users
        JOIN security.UserRole AS assignment
          ON assignment.UserId=users.UserId AND assignment.IsActive=1
        JOIN security.[Role] AS roles
          ON roles.RoleId=assignment.RoleId AND roles.IsActive=1 AND roles.IsSuperAdmin=1
        JOIN security.UserEmployeeLink AS employeeLink
          ON employeeLink.UserId=users.UserId AND employeeLink.IsActive=1
        JOIN hr.Employee AS employee
          ON employee.EmployeeId=employeeLink.EmployeeId
        WHERE users.UserId=@MiguelUserId
          AND users.NormalizedUserName=N'MIGUEL'
          AND users.AccountStatus='ACTIVE'
          AND employee.EmployeeNumber='0054'
    )
        THROW 52403, 'The governed Miguel SUPER_ADMIN/0054 identity is not qualified.', 1;

    IF EXISTS
    (
        SELECT 1 FROM security.ExternalIdentity WITH (UPDLOCK,HOLDLOCK)
        WHERE Provider='KEYCLOAK' AND NormalizedSubject=@NormalizedSubject
          AND UserId<>@MiguelUserId
    )
        THROW 52404, 'The Keycloak subject is already linked to another DLE-OS user.', 1;

    SELECT @ExternalIdentityId=ExternalIdentityId
    FROM security.ExternalIdentity WITH (UPDLOCK,HOLDLOCK)
    WHERE Provider='KEYCLOAK' AND NormalizedSubject=@NormalizedSubject;

    IF @ExternalIdentityId IS NULL
    BEGIN
        SET @ExternalIdentityId=NEWID();
        INSERT security.ExternalIdentity
            (ExternalIdentityId,UserId,Provider,Subject,IsActive,CreatedBy)
        VALUES
            (@ExternalIdentityId,@MiguelUserId,'KEYCLOAK',LTRIM(RTRIM(@Subject)),1,@Actor);

        INSERT security.AuditEvent
            (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,
             TargetIdentity,EventDataJson)
        VALUES
            (NEWID(),'EXTERNAL_IDENTITY_LINKED',@MiguelUserId,@Actor,
             'EXTERNAL_IDENTITY',@ExternalIdentityId,N'KEYCLOAK',
             N'{"provider":"KEYCLOAK","purpose":"OIDC_SUB"}');
    END
    ELSE IF EXISTS
    (
        SELECT 1 FROM security.ExternalIdentity
        WHERE ExternalIdentityId=@ExternalIdentityId
          AND (UserId<>@MiguelUserId OR IsActive<>1)
    )
        THROW 52405, 'The existing Keycloak identity mapping is not the active Miguel mapping.', 1;

    IF EXISTS
    (
        SELECT 1 FROM security.ExternalIdentity
        WHERE Provider='KEYCLOAK' AND UserId<>@MiguelUserId
    )
        THROW 52406, 'Only Miguel may have a Keycloak identity during Phase 6.2C.', 1;

    COMMIT TRANSACTION;

    SELECT @ExternalIdentityId AS ExternalIdentityId,
           @MiguelUserId AS UserId,
           LTRIM(RTRIM(@Subject)) AS Subject,
           CAST(1 AS bit) AS IsActive;
END;
GO
