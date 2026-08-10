USE [DLE_OS_SECURITY_DEV];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name=N'DLE-OS-HOST\DLE-OS-DEV-FRONTEND')
    THROW 51701, 'The existing DLE-OS Development database user is absent.', 1;

DECLARE @ServicePrincipalId int = DATABASE_PRINCIPAL_ID(N'DLE-OS-HOST\DLE-OS-DEV-FRONTEND');
IF EXISTS (SELECT 1 FROM sys.database_role_members WHERE member_principal_id=@ServicePrincipalId)
    THROW 51716, 'The dedicated DEV frontend user must not belong to a database role.', 1;

IF EXISTS
(
    SELECT 1
    FROM sys.database_permissions permission
    LEFT JOIN sys.objects object_value ON object_value.object_id=permission.major_id
    LEFT JOIN sys.schemas schema_value ON schema_value.schema_id=object_value.schema_id
    WHERE permission.grantee_principal_id=@ServicePrincipalId
      AND NOT
      (
          permission.state_desc = N'GRANT'
          AND permission.class_desc = N'DATABASE'
          AND permission.major_id = 0
          AND permission.minor_id = 0
          AND permission.permission_name = N'CONNECT'
      )
      AND
      (
          permission.state_desc <> N'GRANT'
          OR permission.class_desc <> N'OBJECT_OR_COLUMN'
          OR CONCAT
          (
              schema_value.name COLLATE DATABASE_DEFAULT,
              N'.',
              object_value.name COLLATE DATABASE_DEFAULT,
              N':',
              permission.permission_name COLLATE DATABASE_DEFAULT
          ) COLLATE DATABASE_DEFAULT NOT IN
          (
              N'security.ExternalIdentity:SELECT',
              N'security.User:SELECT',
              N'security.UserRole:SELECT',
              N'security.Role:SELECT',
              N'security.RolePermission:SELECT',
              N'security.Permission:SELECT',
              N'hr.EmployeeDirectoryView:SELECT',
              N'security.usp_PrepareEmployeeUserProvisioning:EXECUTE',
              N'security.usp_AbortEmployeeUserProvisioning:EXECUTE',
              N'security.usp_ActivateProvisionedUser:EXECUTE',
              N'security.usp_SetUserEnabledState:EXECUTE',
              N'security.usp_RecordUserSecurityAction:EXECUTE',
              N'security.usp_SetUserRoles:EXECUTE',
              N'security.usp_GetEmployeeUserAdministration:EXECUTE'
          )
      )
)
    THROW 51717, 'The dedicated DEV frontend user has an unapproved direct database permission.', 1;

EXECUTE AS USER = N'DLE-OS-HOST\DLE-OS-DEV-FRONTEND';
BEGIN TRY
    IF HAS_PERMS_BY_NAME(N'security.ExternalIdentity', N'OBJECT', N'SELECT') <> 1
        THROW 51702, 'DLE-OS lacks SELECT on security.ExternalIdentity.', 1;
    IF HAS_PERMS_BY_NAME(N'security.User', N'OBJECT', N'SELECT') <> 1
        THROW 51703, 'DLE-OS lacks SELECT on security.User.', 1;
    IF HAS_PERMS_BY_NAME(N'security.UserRole', N'OBJECT', N'SELECT') <> 1
        THROW 51704, 'DLE-OS lacks SELECT on security.UserRole.', 1;
    IF HAS_PERMS_BY_NAME(N'security.Role', N'OBJECT', N'SELECT') <> 1
        THROW 51705, 'DLE-OS lacks SELECT on security.Role.', 1;
    IF HAS_PERMS_BY_NAME(N'security.RolePermission', N'OBJECT', N'SELECT') <> 1
        THROW 51706, 'DLE-OS lacks SELECT on security.RolePermission.', 1;
    IF HAS_PERMS_BY_NAME(N'security.Permission', N'OBJECT', N'SELECT') <> 1
        THROW 51707, 'DLE-OS lacks SELECT on security.Permission.', 1;
    IF HAS_PERMS_BY_NAME(N'hr.EmployeeDirectoryView', N'OBJECT', N'SELECT') <> 1
        THROW 51708, 'DLE-OS lacks SELECT on hr.EmployeeDirectoryView.', 1;

    IF HAS_PERMS_BY_NAME(N'security.usp_PrepareEmployeeUserProvisioning', N'OBJECT', N'EXECUTE') <> 1
        THROW 51709, 'DLE-OS lacks EXECUTE on usp_PrepareEmployeeUserProvisioning.', 1;
    IF HAS_PERMS_BY_NAME(N'security.usp_AbortEmployeeUserProvisioning', N'OBJECT', N'EXECUTE') <> 1
        THROW 51710, 'DLE-OS lacks EXECUTE on usp_AbortEmployeeUserProvisioning.', 1;
    IF HAS_PERMS_BY_NAME(N'security.usp_ActivateProvisionedUser', N'OBJECT', N'EXECUTE') <> 1
        THROW 51711, 'DLE-OS lacks EXECUTE on usp_ActivateProvisionedUser.', 1;
    IF HAS_PERMS_BY_NAME(N'security.usp_SetUserEnabledState', N'OBJECT', N'EXECUTE') <> 1
        THROW 51712, 'DLE-OS lacks EXECUTE on usp_SetUserEnabledState.', 1;
    IF HAS_PERMS_BY_NAME(N'security.usp_RecordUserSecurityAction', N'OBJECT', N'EXECUTE') <> 1
        THROW 51713, 'DLE-OS lacks EXECUTE on usp_RecordUserSecurityAction.', 1;
    IF HAS_PERMS_BY_NAME(N'security.usp_SetUserRoles', N'OBJECT', N'EXECUTE') <> 1
        THROW 51714, 'DLE-OS lacks EXECUTE on usp_SetUserRoles.', 1;
    IF HAS_PERMS_BY_NAME(N'security.usp_GetEmployeeUserAdministration', N'OBJECT', N'EXECUTE') <> 1
        THROW 51715, 'DLE-OS lacks EXECUTE on usp_GetEmployeeUserAdministration.', 1;
END TRY
BEGIN CATCH
    REVERT;
    THROW;
END CATCH;
REVERT;
GO
