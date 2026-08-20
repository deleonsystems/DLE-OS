USE [DLE_OS_SECURITY_DEV];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @PermissionId uniqueidentifier = 'FE1BA6DC-21EF-4F42-905F-4AF05C56E527';

IF NOT EXISTS (SELECT 1 FROM security.Permission WHERE PermissionCode = N'operations-center.verified-status.write')
BEGIN
    INSERT security.Permission
        (PermissionId, PermissionCode, DisplayName, Description, Category, IsActive, CreatedBy)
    VALUES
        (@PermissionId, N'operations-center.verified-status.write',
         N'Log Operations Center Verified Status',
         N'Append governed Operations Center Last Verified Status events.',
         'operations-center', 1, N'OPERATIONS_CENTER_VERIFIED_STATUS_MIGRATION');
END;
ELSE
BEGIN
    SELECT @PermissionId = PermissionId
    FROM security.Permission WHERE PermissionCode = N'operations-center.verified-status.write';
END;

INSERT security.RolePermission
    (RolePermissionId, RoleId, PermissionId, IsActive, GrantedByActor)
SELECT NEWID(), role.RoleId, @PermissionId, 1, N'OPERATIONS_CENTER_VERIFIED_STATUS_MIGRATION'
FROM security.[Role] role
WHERE role.RoleCode = N'SUPER_ADMIN'
  AND NOT EXISTS
      (SELECT 1 FROM security.RolePermission existing
       WHERE existing.RoleId = role.RoleId AND existing.PermissionId = @PermissionId
         AND existing.IsActive = 1);
