-- REVIEW ONLY. No connection/bootstrap/creation path. Never execute as supplied.
THROW 52990, 'Review-only resolver grant proposal; separate approval and validated connection required.', 1;
/*
USE [DLE_OS_SECURITY_DEV];
GO
-- Preconditions: exact HOST/SQLEXPRESS, valid encrypted connection, verified schema,
-- dedicated virtual-service login/user already explicitly approved and provisioned,
-- no unexpected existing server/database roles or grants. No db_owner/db_datareader.
-- These column grants match SqlUserAuthorizationResolver; no write or secret access.
GRANT SELECT (UserId,UserName,DisplayName,AccountStatus) ON OBJECT::security.[User] TO [NT SERVICE\DleOsDevelopmentQuoting];
GRANT SELECT (UserId,RoleId,IsActive) ON OBJECT::security.UserRole TO [NT SERVICE\DleOsDevelopmentQuoting];
GRANT SELECT (RoleId,RoleCode,IsSuperAdmin,IsActive) ON OBJECT::security.[Role] TO [NT SERVICE\DleOsDevelopmentQuoting];
GRANT SELECT (RoleId,PermissionId,IsActive) ON OBJECT::security.RolePermission TO [NT SERVICE\DleOsDevelopmentQuoting];
GRANT SELECT (PermissionId,PermissionCode,IsActive) ON OBJECT::security.Permission TO [NT SERVICE\DleOsDevelopmentQuoting];
-- No Employee/ExternalIdentity/password/session access and no CREATE LOGIN statement.
-- Revocation is a later receipt-scoped proposal, not automatic rollback of prior grants.

*/
