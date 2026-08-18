SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'DLE_OS_SECURITY_DEV'
    THROW 52300, 'Daniel pilot provisioning requires DLE_OS_SECURITY_DEV.', 1;
GO

BEGIN TRANSACTION;

DECLARE @Now datetime2(3)=SYSUTCDATETIME();
DECLARE @Actor nvarchar(256)=N'PHASE_5_2C_MIGUEL';
DECLARE @Reason varchar(64)='PILOT_KITTING_USER_PROVISIONING';
DECLARE @MiguelUserId uniqueidentifier;
DECLARE @DanielEmployeeId uniqueidentifier;
DECLARE @DanielUserId uniqueidentifier='52000000-0000-4000-8000-000000000001';
DECLARE @KittingPilotRoleId uniqueidentifier='52000000-0000-4000-8000-000000000002';
DECLARE @PickListPermissionId uniqueidentifier='52000000-0000-4000-8000-000000000003';

SELECT @MiguelUserId=users.UserId
FROM security.[User] AS users
JOIN security.ExternalIdentity AS identityMap
  ON identityMap.UserId=users.UserId AND identityMap.IsActive=1
JOIN security.UserRole AS userRole
  ON userRole.UserId=users.UserId AND userRole.IsActive=1
JOIN security.[Role] AS role
  ON role.RoleId=userRole.RoleId AND role.IsActive=1 AND role.RoleCode='SUPER_ADMIN'
WHERE users.NormalizedUserName=N'MIGUEL' AND users.AccountStatus='ACTIVE'
  AND identityMap.Provider='WINDOWS'
  AND identityMap.NormalizedSubject=N'DLE-OS-HOST\MIGUEL';

IF @MiguelUserId IS NULL
    THROW 52301, 'The explicit active Miguel SUPER_ADMIN identity is required.', 1;

SELECT @DanielEmployeeId=EmployeeId
FROM hr.Employee
WHERE SourceSystem='VPRO5_PRM01' AND FirmId='01'
  AND SourceEmployeeIdRaw='008300000' AND EmployeeNumber='0083'
  AND DleWorkforceStatus='CURRENT' AND SourceEmploymentStatus='ACTIVE'
  AND ProposedUserName=N'daniel';

IF @DanielEmployeeId IS NULL
    THROW 52302, 'Qualified employee 0083 Daniel Miranda is absent or contradictory.', 1;

IF EXISTS
(
    SELECT 1 FROM security.Permission
    WHERE PermissionCode='pick_list.view' AND PermissionId<>@PickListPermissionId
)
    THROW 52303, 'pick_list.view has a contradictory immutable ID.', 1;

IF NOT EXISTS (SELECT 1 FROM security.Permission WHERE PermissionId=@PickListPermissionId)
BEGIN
    INSERT security.Permission
    (
        PermissionId,PermissionCode,DisplayName,Description,Category,IsActive,CreatedBy
    )
    VALUES
    (
        @PickListPermissionId,'pick_list.view',N'View Pick Lists',
        N'View governed Kitting Pick List output without changing operational state.',
        'pick_list',1,@Actor
    );
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    VALUES
        (NEWID(),'PERMISSION_CREATED',@MiguelUserId,@Actor,'PERMISSION',@PickListPermissionId,
         'pick_list.view',N'{"phase":"5.2C","reason":"PILOT_KITTING_USER_PROVISIONING"}');
END;

IF EXISTS
(
    SELECT 1 FROM security.[Role]
    WHERE RoleCode='KITTING_PILOT' AND
          (RoleId<>@KittingPilotRoleId OR DisplayName<>N'Kitting Pilot' OR IsSuperAdmin<>0)
)
    THROW 52304, 'KITTING_PILOT has a contradictory governed definition.', 1;

IF NOT EXISTS (SELECT 1 FROM security.[Role] WHERE RoleId=@KittingPilotRoleId)
BEGIN
    INSERT security.[Role]
    (
        RoleId,RoleCode,DisplayName,Description,IsSystemRole,IsSuperAdmin,IsActive,CreatedBy
    )
    VALUES
    (
        @KittingPilotRoleId,'KITTING_PILOT',N'Kitting Pilot',
        N'Read-only Kitting and Pick List pilot role for employee 0083 Daniel Miranda.',
        1,0,1,@Actor
    );
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    VALUES
        (NEWID(),'ROLE_CREATED',@MiguelUserId,@Actor,'ROLE',@KittingPilotRoleId,
         'KITTING_PILOT',N'{"phase":"5.2C","reason":"PILOT_KITTING_USER_PROVISIONING","readOnly":true}');
END;

IF EXISTS
(
    SELECT 1 FROM security.[User]
    WHERE NormalizedUserName=N'DANIEL' AND
          (UserId<>@DanielUserId OR DisplayName<>N'Daniel Miranda' OR
           AccountStatus<>'PENDING' OR IsSystemAccount<>0)
)
    THROW 52305, 'User daniel has a contradictory governed definition.', 1;

IF EXISTS
(
    SELECT 1 FROM security.[User]
    WHERE UserId=@DanielUserId AND NormalizedUserName<>N'DANIEL'
)
    THROW 52306, 'The governed Daniel UserId is already occupied.', 1;

IF NOT EXISTS (SELECT 1 FROM security.[User] WHERE UserId=@DanielUserId)
BEGIN
    INSERT security.[User]
        (UserId,UserName,DisplayName,AccountStatus,IsSystemAccount,CreatedBy)
    VALUES
        (@DanielUserId,N'daniel',N'Daniel Miranda','PENDING',0,@Actor);
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    VALUES
        (NEWID(),'USER_CREATED',@MiguelUserId,@Actor,'USER',@DanielUserId,N'daniel',
         N'{"phase":"5.2C","reason":"PILOT_KITTING_USER_PROVISIONING","accountStatus":"PENDING","externalIdentity":false}');
END;

DECLARE @DesiredPermissions TABLE
(
    PermissionCode varchar(160) NOT NULL PRIMARY KEY,
    RolePermissionId uniqueidentifier NOT NULL
);
INSERT @DesiredPermissions(PermissionCode,RolePermissionId) VALUES
('kitting.view','52000000-0000-4000-8000-000000000010'),
('work_orders.view','52000000-0000-4000-8000-000000000011'),
('pick_list.view','52000000-0000-4000-8000-000000000012'),
('rma_rework.view','52000000-0000-4000-8000-000000000013');

IF EXISTS
(
    SELECT 1 FROM @DesiredPermissions desired
    LEFT JOIN security.Permission permission
      ON permission.PermissionCode=desired.PermissionCode AND permission.IsActive=1
    WHERE permission.PermissionId IS NULL
)
    THROW 52307, 'A required Kitting pilot read permission is absent or inactive.', 1;

IF EXISTS
(
    SELECT 1
    FROM security.RolePermission grantRow
    JOIN security.Permission permission ON permission.PermissionId=grantRow.PermissionId
    WHERE grantRow.RoleId=@KittingPilotRoleId AND grantRow.IsActive=1
      AND NOT EXISTS
          (SELECT 1 FROM @DesiredPermissions desired WHERE desired.PermissionCode=permission.PermissionCode)
)
    THROW 52308, 'KITTING_PILOT contains an unrelated active permission.', 1;

DECLARE @CreatedGrants TABLE(RolePermissionId uniqueidentifier,PermissionId uniqueidentifier);
INSERT security.RolePermission
(
    RolePermissionId,RoleId,PermissionId,IsActive,GrantedByUserId,GrantedByActor
)
OUTPUT inserted.RolePermissionId,inserted.PermissionId
INTO @CreatedGrants(RolePermissionId,PermissionId)
SELECT desired.RolePermissionId,@KittingPilotRoleId,permission.PermissionId,1,@MiguelUserId,@Actor
FROM @DesiredPermissions AS desired
JOIN security.Permission AS permission ON permission.PermissionCode=desired.PermissionCode
WHERE NOT EXISTS
(
    SELECT 1 FROM security.RolePermission AS existing
    WHERE existing.RoleId=@KittingPilotRoleId
      AND existing.PermissionId=permission.PermissionId AND existing.IsActive=1
);

INSERT security.AuditEvent
    (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
SELECT NEWID(),'ROLE_PERMISSION_GRANTED',@MiguelUserId,@Actor,'ROLE_PERMISSION',RolePermissionId,
       permission.PermissionCode,
       N'{"phase":"5.2C","role":"KITTING_PILOT","reason":"PILOT_KITTING_USER_PROVISIONING"}'
FROM @CreatedGrants created
JOIN security.Permission permission ON permission.PermissionId=created.PermissionId;

IF EXISTS
(
    SELECT 1 FROM security.UserRole assignment
    JOIN security.[Role] role ON role.RoleId=assignment.RoleId
    WHERE assignment.UserId=@DanielUserId AND assignment.IsActive=1
      AND role.RoleCode<>'KITTING_PILOT'
)
    THROW 52309, 'Daniel has an unrelated active role assignment.', 1;

IF NOT EXISTS
(
    SELECT 1 FROM security.UserRole
    WHERE UserId=@DanielUserId AND RoleId=@KittingPilotRoleId AND IsActive=1
)
BEGIN
    DECLARE @DanielAssignmentId uniqueidentifier='52000000-0000-4000-8000-000000000020';
    INSERT security.UserRole
        (UserRoleId,UserId,RoleId,IsActive,AssignedByUserId,AssignedByActor)
    VALUES
        (@DanielAssignmentId,@DanielUserId,@KittingPilotRoleId,1,@MiguelUserId,@Actor);
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    VALUES
        (NEWID(),'USER_ROLE_ASSIGNED',@MiguelUserId,@Actor,'USER_ROLE',@DanielAssignmentId,
         N'daniel:KITTING_PILOT',N'{"phase":"5.2C","reason":"PILOT_KITTING_USER_PROVISIONING"}');
END;

IF EXISTS
(
    SELECT 1 FROM security.UserEmployeeLink
    WHERE IsActive=1 AND
          ((UserId=@DanielUserId AND EmployeeId<>@DanielEmployeeId) OR
           (EmployeeId=@DanielEmployeeId AND UserId<>@DanielUserId))
)
    THROW 52310, 'Daniel has a contradictory active employee/user link.', 1;

IF NOT EXISTS
(
    SELECT 1 FROM security.UserEmployeeLink
    WHERE UserId=@DanielUserId AND EmployeeId=@DanielEmployeeId AND IsActive=1
)
BEGIN
    DECLARE @DanielLinkId uniqueidentifier='52000000-0000-4000-8000-000000000021';
    INSERT security.UserEmployeeLink
    (
        UserEmployeeLinkId,UserId,EmployeeId,IsActive,LinkEvidenceCode,
        LinkedByUserId,LinkedAtUtc
    )
    VALUES
    (
        @DanielLinkId,@DanielUserId,@DanielEmployeeId,1,@Reason,@MiguelUserId,@Now
    );
    INSERT security.AuditEvent
        (AuditEventId,EventType,ActorUserId,ActorIdentity,TargetType,TargetId,TargetIdentity,EventDataJson)
    VALUES
        (NEWID(),'USER_EMPLOYEE_LINKED',@MiguelUserId,@Actor,'USER_EMPLOYEE_LINK',@DanielLinkId,
         N'0083:daniel',N'{"phase":"5.2C","reason":"PILOT_KITTING_USER_PROVISIONING","employeeNumber":"0083"}');
END;

IF EXISTS
(
    SELECT 1 FROM security.ExternalIdentity WHERE UserId=@DanielUserId
)
    THROW 52311, 'Daniel must not have an external identity during Phase 5.2C.', 1;

IF EXISTS
(
    SELECT 1 FROM security.UserRole assignment
    JOIN security.[Role] role ON role.RoleId=assignment.RoleId
    WHERE assignment.UserId=@DanielUserId AND assignment.IsActive=1 AND role.IsSuperAdmin=1
)
    THROW 52312, 'Daniel must never receive SUPER_ADMIN during pilot provisioning.', 1;

IF EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'hr.Employee')
      AND name=N'CK_Employee_ProvisioningStatus'
      AND definition NOT LIKE '%PROVISIONED_PENDING_AUTH%'
)
BEGIN
    ALTER TABLE hr.Employee DROP CONSTRAINT CK_Employee_ProvisioningStatus;
    ALTER TABLE hr.Employee WITH CHECK ADD CONSTRAINT CK_Employee_ProvisioningStatus CHECK
    (
        ProvisioningStatus IN
        ('NOT_PROVISIONED','PROPOSED','PROVISIONED_PENDING_AUTH','ACTIVE','DISABLED','BLOCKED')
    );
END;

UPDATE hr.Employee
SET ProvisioningStatus='PROVISIONED_PENDING_AUTH',ProposedUserName=N'daniel',UpdatedAtUtc=@Now
WHERE EmployeeId=@DanielEmployeeId AND ProvisioningStatus<>'PROVISIONED_PENDING_AUTH';

COMMIT TRANSACTION;
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
    linked.RoleCode AS DleOsRoleCode,
    CAST(CASE WHEN linked.AccountStatus='ACTIVE' AND linked.HasExternalIdentity=1
              THEN 1 ELSE 0 END AS bit) AS HasDleOsAccess,
    CASE WHEN linked.UserId IS NULL THEN 'NOT_PROVISIONED'
         WHEN linked.AccountStatus='PENDING' AND linked.HasExternalIdentity=0
              THEN 'NOT_YET_SIGN_IN_READY'
         WHEN linked.AccountStatus='ACTIVE' AND linked.HasExternalIdentity=1
              THEN 'SIGN_IN_READY'
         ELSE 'NOT_SIGN_IN_READY' END AS AccessReadiness,
    employee.MissingFromSource,
    employee.SourceReviewReason,
    employee.LastSourceSyncAtUtc,
    employee.CreatedAtUtc,
    employee.UpdatedAtUtc
FROM hr.Employee AS employee
OUTER APPLY
(
    SELECT TOP (1) users.UserId,users.UserName,users.DisplayName,users.AccountStatus,
           roles.RoleCode,
           CAST(CASE WHEN EXISTS
           (
               SELECT 1 FROM security.ExternalIdentity identityMap
               WHERE identityMap.UserId=users.UserId AND identityMap.IsActive=1
           ) THEN 1 ELSE 0 END AS bit) AS HasExternalIdentity
    FROM security.UserEmployeeLink AS link
    JOIN security.[User] AS users ON users.UserId=link.UserId
    OUTER APPLY
    (
        SELECT TOP (1) role.RoleCode
        FROM security.UserRole assignment
        JOIN security.[Role] role ON role.RoleId=assignment.RoleId
        WHERE assignment.UserId=users.UserId AND assignment.IsActive=1 AND role.IsActive=1
        ORDER BY role.IsSuperAdmin DESC,role.RoleCode
    ) AS roles
    WHERE link.EmployeeId=employee.EmployeeId AND link.IsActive=1
) AS linked;
GO
