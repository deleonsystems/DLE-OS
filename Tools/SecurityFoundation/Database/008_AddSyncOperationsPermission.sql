USE [DLE_OS_SECURITY_DEV];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @PermissionId uniqueidentifier = '8A6B59BF-FF52-4B37-98C7-45833C50B5EA';

IF NOT EXISTS (SELECT 1 FROM security.Permission WHERE PermissionCode = N'sync.operations')
BEGIN
    INSERT security.Permission
        (PermissionId, PermissionCode, DisplayName, Description, Category, IsActive, CreatedBy)
    VALUES
        (@PermissionId, N'sync.operations', N'Sync Operations',
         N'View and start the governed focused operational synchronization.',
         'sync', 1, N'SYNC_OPERATIONS_MIGRATION');
END;
ELSE
BEGIN
    SELECT @PermissionId = PermissionId
    FROM security.Permission WHERE PermissionCode = N'sync.operations';
END;

INSERT security.RolePermission
    (RolePermissionId, RoleId, PermissionId, IsActive, GrantedByActor)
SELECT NEWID(), role.RoleId, @PermissionId, 1, N'SYNC_OPERATIONS_MIGRATION'
FROM security.[Role] role
WHERE role.RoleCode = N'SUPER_ADMIN'
  AND NOT EXISTS
      (SELECT 1 FROM security.RolePermission existing
       WHERE existing.RoleId = role.RoleId AND existing.PermissionId = @PermissionId
         AND existing.IsActive = 1);
